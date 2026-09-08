package com.chengxin.massage.catalog;

import com.chengxin.massage.admin.AdminSessionService;
import java.io.ByteArrayOutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/service-change-history")
@CrossOrigin(origins = "*")
public class ServiceChangeHistoryQueryController {
  private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
  private final JdbcClient jdbc;
  private final AdminSessionService adminSessions;

  ServiceChangeHistoryQueryController(JdbcClient jdbc, AdminSessionService adminSessions) {
    this.jdbc = jdbc;
    this.adminSessions = adminSessions;
  }

  @GetMapping
  List<HistoryRow> search(@RequestParam(required = false) LocalDate from,
      @RequestParam(required = false) LocalDate to, @RequestParam(required = false) UUID storeId,
      @RequestParam(required = false) UUID technicianId, @RequestParam(required = false) String type,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Query query = query(from, to, storeId, technicianId, type, authorization);
    return rows(query, true);
  }

  @GetMapping("/export")
  ResponseEntity<byte[]> export(@RequestParam(required = false) LocalDate from,
      @RequestParam(required = false) LocalDate to, @RequestParam(required = false) UUID storeId,
      @RequestParam(required = false) UUID technicianId, @RequestParam(required = false) String type,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    Query query = query(from, to, storeId, technicianId, type, authorization);
    String filename = "服务变更记录_%s_至_%s.xlsx".formatted(query.from(), query.to());
    return ResponseEntity.ok()
      .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
      .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20"))
      .body(workbook(rows(query, false)));
  }

  private Query query(LocalDate from, LocalDate to, UUID storeId, UUID technicianId, String type, String authorization) {
    LocalDate end = to == null ? LocalDate.now(BUSINESS_ZONE) : to;
    LocalDate start = from == null ? end.minusDays(29) : from;
    if (end.isBefore(start) || start.plusYears(1).isBefore(end)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Date range must be within one year");
    List<AdminSessionService.AdminStore> stores = adminSessions.accessibleStores(authorization);
    if (stores.isEmpty()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "No accessible stores");
    List<UUID> storeIds = stores.stream().map(AdminSessionService.AdminStore::id).toList();
    if (storeId != null && !storeIds.contains(storeId)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Store access denied");
    String normalizedType = type == null || type.isBlank() || "ALL".equalsIgnoreCase(type) ? null : type.trim().toUpperCase();
    return new Query(start, end, storeId == null ? storeIds : List.of(storeId), technicianId, normalizedType);
  }

  private List<HistoryRow> rows(Query query, boolean pageLimit) {
    String sql = historySql() + " where events.store_id in (:stores) and events.changed_at>=:from and events.changed_at<:until" +
      (query.technicianId() == null ? "" : " and ss.technician_id=:technician") +
      (query.type() == null ? "" : " and events.event_type=:type") + " order by events.changed_at desc,events.id desc" + (pageLimit ? " limit 5000" : "");
    JdbcClient.StatementSpec statement = jdbc.sql(sql).param("stores", query.storeIds())
      .param("from", query.from().atStartOfDay(BUSINESS_ZONE).toOffsetDateTime())
      .param("until", query.to().plusDays(1).atStartOfDay(BUSINESS_ZONE).toOffsetDateTime());
    if (query.technicianId() != null) statement.param("technician", query.technicianId());
    if (query.type() != null) statement.param("type", query.type());
    return statement.query(HistoryRow.class).list();
  }

  private String historySql() {
    return """
      select events.id,events.event_type,events.store_id,store.name store_name,events.service_session_id,
        ss.technician_id,technician.name technician_name,ss.room_id,room.code room_code,ss.service_item_id,
        ss.service_name_snapshot,orders.order_no,events.actor_name,events.reason,events.detail,events.changed_at
      from (
        select id,store_id,service_session_id,'SERVICE_ITEM_CHANGED' event_type,actor_name_snapshot actor_name,reason,
          previous_service_name_snapshot || ' -> ' || new_service_name_snapshot || '；¥' || (previous_price_cents/100.0)::numeric(12,2) || ' -> ¥' || (new_price_cents/100.0)::numeric(12,2) detail,changed_at
          from service_session_item_change_log
        union all
        select id,store_id,service_session_id,case when source='TECHNICIAN_EXTENSION' or service_session_extension_id is not null then 'EXTENSION_ADDED' else 'DURATION_CHANGED' end,
          actor_name_snapshot,reason,previous_duration_minutes || ' -> ' || new_duration_minutes || ' 分钟',changed_at
          from service_session_duration_change_log where not (added_duration_minutes<0 and reason like 'Extension cancelled:%')
        union all
        select id,store_id,service_session_id,'EXTENSION_CANCELLED',actor_name_snapshot,reason,
          service_name_snapshot || ' · ¥' || (service_price_cents/100.0)::numeric(12,2) || ' · ' || planned_duration_minutes || ' 分钟',cancelled_at
          from service_session_extension_cancel_log
        union all
        select id,store_id,service_session_id,'ROOM_TRANSFER',coalesce(approved_by_name_snapshot,requested_by_name_snapshot,'系统'),reason,
          (select code from room where id=from_room_id) || ' 房 -> ' || (select code from room where id=to_room_id) || ' · ' || status,coalesce(approved_at,requested_at)
          from service_room_transfer
        union all
        select participant.id,participant.store_id,participant.service_session_id,'TECHNICIAN_CHANGED',coalesce((select audit.actor_name_snapshot from audit_log audit
            where audit.store_id=participant.store_id and audit.entity_id=participant.service_session_id and audit.action='SERVICE_TECHNICIAN_REPLACED'
            order by abs(extract(epoch from (audit.created_at-participant.joined_at))) limit 1),'系统'),participant.change_reason,
          previous_technician.name || ' -> ' || technician.name,coalesce(participant.service_started_at,participant.joined_at)
          from service_session_participant participant join technician technician on technician.id=participant.technician_id
          join service_session_participant previous_participant on previous_participant.id=participant.replaced_participant_id
          join technician previous_technician on previous_technician.id=previous_participant.technician_id
          where participant.replaced_participant_id is not null
      ) events join service_session ss on ss.id=events.service_session_id join store store on store.id=events.store_id
      join technician technician on technician.id=ss.technician_id join room room on room.id=ss.room_id
      left join lateral (select sales_order.order_no from sales_order_service_session link join sales_order sales_order on sales_order.id=link.order_id
        where link.service_session_id=ss.id order by link.created_at desc limit 1) orders on true
      """;
  }

  private byte[] workbook(List<HistoryRow> rows) {
    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      Sheet sheet = workbook.createSheet("服务变更记录");
      String[] headers = {"时间","门店","类型","技师","房间","项目","订单号","变更内容","原因","操作人"};
      Font font = workbook.createFont(); font.setBold(true); font.setFontName("Microsoft YaHei");
      CellStyle headerStyle = workbook.createCellStyle(); headerStyle.setFont(font);
      Row header = sheet.createRow(0);
      for (int i=0;i<headers.length;i++) { Cell cell=header.createCell(i); cell.setCellValue(headers[i]); cell.setCellStyle(headerStyle); }
      int index=1;
      for (HistoryRow item : rows) {
        Row row=sheet.createRow(index++);
        String[] values={item.changedAt().atZoneSameInstant(BUSINESS_ZONE).toLocalDateTime().toString(),item.storeName(),typeLabel(item.eventType()),
          item.technicianName(),item.roomCode(),item.serviceNameSnapshot(),item.orderNo()==null?"":item.orderNo(),item.detail(),item.reason(),item.actorName()};
        for(int i=0;i<values.length;i++) row.createCell(i).setCellValue(values[i]==null?"":values[i]);
      }
      sheet.createFreezePane(0,1); sheet.setAutoFilter(new CellRangeAddress(0,0,0,headers.length-1));
      int[] widths={22,18,15,15,10,22,20,36,36,18}; for(int i=0;i<widths.length;i++) sheet.setColumnWidth(i,widths[i]*256);
      workbook.write(output); return output.toByteArray();
    } catch (Exception exception) { throw new IllegalStateException("Unable to export service change history", exception); }
  }

  private String typeLabel(String type) { return switch(type) {
    case "SERVICE_ITEM_CHANGED" -> "更换项目"; case "EXTENSION_ADDED" -> "服务加钟"; case "EXTENSION_CANCELLED" -> "客人退钟";
    case "DURATION_CHANGED" -> "调整时长"; case "ROOM_TRANSFER" -> "更换房间"; case "TECHNICIAN_CHANGED" -> "更换技师"; default -> type;
  }; }

  record Query(LocalDate from, LocalDate to, List<UUID> storeIds, UUID technicianId, String type) {}
  public record HistoryRow(UUID id, String eventType, UUID storeId, String storeName, UUID serviceSessionId,
      UUID technicianId, String technicianName, UUID roomId, String roomCode, UUID serviceItemId,
      String serviceNameSnapshot, String orderNo, String actorName, String reason, String detail, OffsetDateTime changedAt) {}
}
