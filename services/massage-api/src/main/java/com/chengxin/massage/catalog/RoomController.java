package com.chengxin.massage.catalog;

import java.util.List;
import java.util.Objects;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.http.HttpHeaders;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@RestController
@RequestMapping("/api/v1/rooms")
@CrossOrigin(origins = "*")
public class RoomController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final Logger LOGGER = LoggerFactory.getLogger(RoomController.class);
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AuditService audits;
  RoomController(JdbcClient jdbc, StoreContextService storeContext, AuditService audits) { this.jdbc = jdbc; this.storeContext = storeContext; this.audits = audits; }

  @GetMapping
  List<Room> rooms(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("select id,code,name,room_type,bed_count,active from room where store_id=:store order by code")
      .param("store", storeId).query(Room.class).list();
  }

  @GetMapping("/beds")
  List<Bed> beds(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("select id,room_id,code,name,sort_order,active from room_bed where store_id=:store order by room_id,sort_order")
      .param("store", storeId).query(Bed.class).list();
  }

  @GetMapping("/statuses")
  List<RoomStatus> statuses(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("select distinct on (room_id) room_id,status,reason,occurred_at from room_status_event where store_id=:store order by room_id,occurred_at desc,id desc")
      .param("store",storeId).query(RoomStatus.class).list();
  }

  @PostMapping("/{roomId}/status")
  @Transactional
  void changeStatus(@PathVariable UUID roomId, @Valid @RequestBody StatusInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    lockRoom(storeId, roomId);
    StatusAudit before = latestStatus(storeId, roomId);
    boolean hasActiveService = jdbc.sql("select exists(select 1 from service_session where store_id=:store and room_id=:room and status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE'))")
      .param("store", storeId).param("room", roomId).query(Boolean.class).single();
    if (hasActiveService && !"IN_SERVICE".equals(input.status())) {
      LOGGER.warn("Room status change rejected: storeId={}, roomId={}, requestedStatus={}, currentStatus={}, activeService={}, reason={}",
        storeId, roomId, input.status(), before.status(), true, input.reason());
      throw new ResponseStatusException(HttpStatus.CONFLICT, "房间存在进行中的服务，请先为技师下钟");
    }
    if (before.status().equals(input.status()) && Objects.equals(before.reason(), input.reason())) return;
    jdbc.sql("insert into room_status_event(id,tenant_id,store_id,room_id,status,reason,source,occurred_at) values(:id,:tenant,:store,:room,:status,:reason,'FRONTDESK',clock_timestamp())")
      .param("id",UUID.randomUUID()).param("tenant",TENANT_ID).param("store",storeId).param("room",roomId).param("status",input.status()).param("reason",input.reason()).update();
    audits.record(authorization, storeId, "ROOM", "ROOM_STATUS_CHANGED", "room", roomId, "切换房间状态", before, new StatusAudit(input.status(), input.reason()));
  }

  @PostMapping("/{roomId}/complete-cleaning")
  @Transactional
  void completeCleaning(@PathVariable UUID roomId,
                        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                        @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Room room = lockRoom(storeId, roomId);
    StatusAudit before = latestStatus(storeId, roomId);
    if (!room.active()) {
      LOGGER.warn("Complete cleaning rejected: storeId={}, roomId={}, currentStatus={}, roomActive=false", storeId, roomId, before.status());
      throw new ResponseStatusException(HttpStatus.CONFLICT, "房间已停用");
    }
    boolean hasActiveService = jdbc.sql("select exists(select 1 from service_session where store_id=:store and room_id=:room and status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE'))")
      .param("store", storeId).param("room", roomId).query(Boolean.class).single();
    if (hasActiveService) {
      LOGGER.warn("Complete cleaning rejected: storeId={}, roomId={}, currentStatus={}, activeService=true", storeId, roomId, before.status());
      throw new ResponseStatusException(HttpStatus.CONFLICT, "房间存在进行中的服务，无法完成清洁");
    }
    if (isCleaningCompletionReplay(before.status(), before.reason())) return;
    if (!"CLEANING".equals(before.status())) {
      LOGGER.warn("Complete cleaning rejected: storeId={}, roomId={}, currentStatus={}, expectedStatus=CLEANING", storeId, roomId, before.status());
      throw new ResponseStatusException(HttpStatus.CONFLICT, "仅清洁中的房间可以完成清洁");
    }
    jdbc.sql("insert into room_status_event(id,tenant_id,store_id,room_id,status,reason,source,occurred_at) values(:id,:tenant,:store,:room,'IDLE','Cleaning completed','FRONTDESK',clock_timestamp())")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("room", roomId).update();
    audits.record(authorization, storeId, "ROOM", "ROOM_CLEANING_COMPLETED", "room", roomId, "完成房间清洁", before, new StatusAudit("IDLE", "Cleaning completed"));
  }

  @PostMapping("/{roomId}/confirm-payment")
  @Transactional
  void confirmPayment(@PathVariable UUID roomId,
                      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Room room = lockRoom(storeId, roomId);
    if (!room.active()) {
      LOGGER.warn("Confirm payment rejected: storeId={}, roomId={}, roomActive=false", storeId, roomId);
      throw new ResponseStatusException(HttpStatus.CONFLICT, "房间已停用");
    }
    String status = jdbc.sql("select status from room_status_event where store_id=:store and room_id=:room order by occurred_at desc,id desc limit 1")
      .param("store", storeId).param("room", roomId).query(String.class).optional().orElse("IDLE");
    if (!"PENDING_PAYMENT".equals(status)) {
      LOGGER.warn("Confirm payment rejected: storeId={}, roomId={}, currentStatus={}, expectedStatus=PENDING_PAYMENT", storeId, roomId, status);
      throw new ResponseStatusException(HttpStatus.CONFLICT, "仅待付款房间可以确认已付款");
    }
    boolean hasActiveService = jdbc.sql("select exists(select 1 from service_session where store_id=:store and room_id=:room and status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE'))")
      .param("store", storeId).param("room", roomId).query(Boolean.class).single();
    if (hasActiveService) {
      LOGGER.warn("Confirm payment rejected: storeId={}, roomId={}, currentStatus={}, activeService=true", storeId, roomId, status);
      throw new ResponseStatusException(HttpStatus.CONFLICT, "房间仍有进行中的服务，无法确认付款");
    }
    jdbc.sql("insert into room_status_event(id,tenant_id,store_id,room_id,status,reason,source,occurred_at) values(:id,:tenant,:store,:room,'CLEANING','Frontdesk payment confirmed; awaiting cleaning','FRONTDESK_PAYMENT_CONFIRM',clock_timestamp())")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("room", roomId).update();
    audits.record(authorization, storeId, "ROOM", "ROOM_PAYMENT_CONFIRMED", "room", roomId, "确认房间已付款", new StatusAudit(status, null), new StatusAudit("CLEANING", "Frontdesk payment confirmed; awaiting cleaning"));
  }

  @PostMapping
  @Transactional
  Room createRoom(@Valid @RequestBody RoomInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into room(id,tenant_id,store_id,code,name,room_type,bed_count) values(:id,:tenant,:store,:code,:name,:type,:beds)")
      .param("id",id).param("tenant",TENANT_ID).param("store",storeId).param("code",input.code()).param("name",input.name()).param("type",input.roomType()).param("beds",input.bedCount()).update();
    Room created = room(storeId, id);
    audits.record(authorization, storeId, "ROOM", "ROOM_CREATED", "room", id, "新增房间", null, created);
    return created;
  }

  @PutMapping("/{id}")
  @Transactional
  Room updateRoom(@PathVariable UUID id, @Valid @RequestBody RoomInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Room before = room(storeId, id);
    jdbc.sql("update room set code=:code,name=:name,room_type=:type,bed_count=:beds,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("id",id).param("store",storeId).param("code",input.code()).param("name",input.name()).param("type",input.roomType()).param("beds",input.bedCount()).update();
    Room updated = room(storeId, id);
    audits.record(authorization, storeId, "ROOM", "ROOM_UPDATED", "room", id, "修改房间资料", before, updated);
    return updated;
  }

  @PutMapping("/{id}/active")
  @Transactional
  void setRoomActive(@PathVariable UUID id, @RequestBody ActiveInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Room before = room(storeId, id);
    jdbc.sql("update room set active=:active,updated_at=now(),version=version+1 where id=:id and store_id=:store").param("active",input.active()).param("id",id).param("store",storeId).update();
    audits.record(authorization, storeId, "ROOM", input.active() ? "ROOM_ENABLED" : "ROOM_DISABLED", "room", id, input.active() ? "启用房间" : "停用房间", before, room(storeId, id));
  }

  @PostMapping("/{roomId}/beds")
  @Transactional
  Bed createBed(@PathVariable UUID roomId, @Valid @RequestBody BedInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    room(storeId, roomId);
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into room_bed(id,tenant_id,store_id,room_id,code,name,sort_order) values(:id,:tenant,:store,:room,:code,:name,:sort)")
      .param("id",id).param("tenant",TENANT_ID).param("store",storeId).param("room",roomId).param("code",input.code()).param("name",input.name()).param("sort",input.sortOrder()).update();
    Bed created = bed(storeId, id);
    audits.record(authorization, storeId, "ROOM", "BED_CREATED", "room_bed", id, "新增床位", null, created);
    return created;
  }

  @PutMapping("/beds/{id}")
  @Transactional
  Bed updateBed(@PathVariable UUID id, @Valid @RequestBody BedInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Bed before = bed(storeId, id);
    jdbc.sql("update room_bed set code=:code,name=:name,sort_order=:sort,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("id",id).param("store",storeId).param("code",input.code()).param("name",input.name()).param("sort",input.sortOrder()).update();
    Bed updated = bed(storeId, id);
    audits.record(authorization, storeId, "ROOM", "BED_UPDATED", "room_bed", id, "修改床位资料", before, updated);
    return updated;
  }

  @PutMapping("/beds/{id}/active")
  @Transactional
  void setBedActive(@PathVariable UUID id, @RequestBody ActiveInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Bed before = bed(storeId, id);
    jdbc.sql("update room_bed set active=:active,updated_at=now(),version=version+1 where id=:id and store_id=:store").param("active",input.active()).param("id",id).param("store",storeId).update();
    audits.record(authorization, storeId, "ROOM", input.active() ? "BED_ENABLED" : "BED_DISABLED", "room_bed", id, input.active() ? "启用床位" : "停用床位", before, bed(storeId, id));
  }

  private Room room(UUID storeId, UUID id) {
    return jdbc.sql("select id,code,name,room_type,bed_count,active from room where id=:id and store_id=:store").param("id",id).param("store",storeId).query(Room.class).single();
  }

  private Room lockRoom(UUID storeId, UUID id) {
    return jdbc.sql("select id,code,name,room_type,bed_count,active from room where id=:id and store_id=:store for update")
      .param("id", id).param("store", storeId).query(Room.class).single();
  }

  private Bed bed(UUID storeId, UUID id) {
    return jdbc.sql("select id,room_id,code,name,sort_order,active from room_bed where id=:id and store_id=:store").param("id",id).param("store",storeId).query(Bed.class).single();
  }

  private StatusAudit latestStatus(UUID storeId, UUID roomId) {
    return jdbc.sql("select status,reason from room_status_event where store_id=:store and room_id=:room order by occurred_at desc,id desc limit 1")
      .param("store", storeId).param("room", roomId).query(StatusAudit.class).optional().orElse(new StatusAudit("IDLE", null));
  }

  static boolean isCleaningCompletionReplay(String status, String reason) {
    return "IDLE".equals(status) && "Cleaning completed".equals(reason);
  }

  record Room(UUID id, String code, String name, String roomType, Short bedCount, Boolean active) {}
  record Bed(UUID id, UUID roomId, String code, String name, Integer sortOrder, Boolean active) {}
  record RoomInput(@NotBlank String code, @NotBlank String name, @NotBlank String roomType, @NotNull Short bedCount) {}
  record BedInput(@NotBlank String code, @NotBlank String name, @NotNull Integer sortOrder) {}
  record ActiveInput(boolean active) {}
  record RoomStatus(UUID roomId, String status, String reason, java.time.OffsetDateTime occurredAt) {}
  record StatusInput(@NotBlank @Pattern(regexp = "IDLE|IN_SERVICE|PENDING_PAYMENT|CLEANING|RESERVED|MAINTENANCE") String status, String reason) {}
  record StatusAudit(String status, String reason) {}
}
