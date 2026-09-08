package com.chengxin.massage.catalog;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.admin.AdminSessionService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;

@RestController
@RequestMapping("/api/v1/foundation")
@CrossOrigin(origins = "*")
public class FoundationController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AdminSessionService adminSessions;
  private final AuditService audits;
  private final BusinessClockService businessClock;
  private final TechnicianQueueService queue;
  FoundationController(JdbcClient jdbc, StoreContextService storeContext, AdminSessionService adminSessions, AuditService audits, BusinessClockService businessClock, TechnicianQueueService queue) { this.jdbc = jdbc; this.storeContext = storeContext; this.adminSessions = adminSessions; this.audits = audits; this.businessClock = businessClock; this.queue = queue; }

  @GetMapping("/technicians")
  List<Technician> technicians(@RequestParam(defaultValue = "false") boolean includeInactive,
                               @RequestParam(defaultValue = "false") boolean includeQueueDisabled,
                               @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                               @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    if (!includeInactive && !includeQueueDisabled) {
      return queue.currentQueue(storeId).technicians().stream()
        .map(item -> new Technician(item.technicianId(), item.technicianCode(), item.technicianName(), null, item.queuePosition(), true, true)).toList();
    }
    String sql = includeInactive
      ? "select id, code, name, phone, queue_order, active, queue_enabled from technician where store_id=:store order by active desc, queue_enabled desc, queue_order"
      : "select id, code, name, phone, queue_order, active, queue_enabled from technician where store_id=:store and active=true order by queue_order";
    return jdbc.sql(sql)
      .param("store", storeId).query(Technician.class).list();
  }

  @PostMapping("/technicians")
  @Transactional
  Technician createTechnician(@Valid @RequestBody TechnicianInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    String code = input.code().trim();
    ensureActiveTechnicianCodeAvailable(storeId, code, null);
    UUID id = UUID.randomUUID(), employeeId = UUID.randomUUID(), assignmentId = UUID.randomUUID();
    jdbc.sql("insert into employee(id,tenant_id,full_name,phone) values(:id,:tenant,:name,:phone)")
      .param("id", employeeId).param("tenant", TENANT_ID).param("name", input.name()).param("phone", input.phone()).update();
    jdbc.sql("insert into employee_store_assignment(id,tenant_id,employee_id,store_id,employee_no,position_type,position_name) values(:id,:tenant,:employee,:store,:employeeNo,'TECHNICIAN','技师')")
      .param("id", assignmentId).param("tenant", TENANT_ID).param("employee", employeeId).param("store", storeId).param("employeeNo", code).update();
    jdbc.sql("insert into technician(id,tenant_id,store_id,employee_id,code,name,phone,queue_order) values(:id,:tenant,:store,:employee,:code,:name,:phone,:queue)")
      .param("id", id).param("tenant", TENANT_ID).param("store", storeId).param("employee", employeeId).param("code", code)
      .param("name", input.name()).param("phone", input.phone()).param("queue", input.queueOrder()).update();
    Technician created = technician(storeId, id);
    audits.record(authorization, storeId, "FOUNDATION", "TECHNICIAN_CREATED", "technician", id, "新增技师", null, created);
    audits.record(authorization, storeId, "EMPLOYEE", "EMPLOYEE_CREATED_FROM_TECHNICIAN", "employee", employeeId, "由技师档案创建员工", null, new EmployeeLink(employeeId, assignmentId, code, input.name(), input.phone(), true));
    return created;
  }

  @PutMapping("/technicians/{id}")
  @Transactional
  Technician updateTechnician(@PathVariable UUID id, @Valid @RequestBody TechnicianInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Technician before = technician(storeId, id);
    String code = input.code().trim();
    if (before.active()) ensureActiveTechnicianCodeAvailable(storeId, code, id);
    UUID employeeId = ensureTechnicianEmployee(storeId, before);
    jdbc.sql("update technician set code=:code,name=:name,phone=:phone,queue_order=:queue,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("id", id).param("store", storeId).param("code", code).param("name", input.name())
      .param("phone", input.phone()).param("queue", input.queueOrder()).update();
    jdbc.sql("update employee set full_name=:name,phone=:phone,updated_at=now(),version=version+1 where id=:id and tenant_id=:tenant")
      .param("id", employeeId).param("tenant", TENANT_ID).param("name", input.name()).param("phone", input.phone()).update();
    jdbc.sql("update employee_store_assignment set employee_no=:code,updated_at=now(),version=version+1 where employee_id=:employee and store_id=:store")
      .param("code", code).param("employee", employeeId).param("store", storeId).update();
    Technician updated = technician(storeId, id);
    audits.record(authorization, storeId, "FOUNDATION", "TECHNICIAN_UPDATED", "technician", id, "修改技师资料", before, updated);
    return updated;
  }

  @PutMapping("/technicians/{id}/active")
  @Transactional
  void setTechnicianActive(@PathVariable UUID id, @RequestBody ActiveInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Technician before = technician(storeId, id);
    if (input.active()) ensureActiveTechnicianCodeAvailable(storeId, before.code(), id);
    UUID employeeId = ensureTechnicianEmployee(storeId, before);
    jdbc.sql("update technician set active=:active,employment_status=:status,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("active", input.active()).param("status", input.active() ? "ACTIVE" : "LEFT").param("id", id).param("store", storeId).update();
    jdbc.sql("update employee_store_assignment set employment_status=:status,active=:active,left_on=:leftOn,updated_at=now(),version=version+1 where employee_id=:employee and store_id=:store")
      .param("employee", employeeId).param("store", storeId).param("active", input.active())
      .param("status", input.active() ? "ACTIVE" : "LEFT").param("leftOn", input.active() ? null : LocalDate.now()).update();
    if (input.active()) jdbc.sql("update employee set active=true,employment_status='ACTIVE',updated_at=now(),version=version+1 where id=:id")
      .param("id", employeeId).update();
    Technician after = technician(storeId, id);
    audits.record(authorization, storeId, "FOUNDATION", input.active() ? "TECHNICIAN_ENABLED" : "TECHNICIAN_DISABLED", "technician", id, input.active() ? "启用技师" : "停用技师", before, after);
    audits.record(authorization, storeId, "EMPLOYEE", "EMPLOYEE_STATUS_SYNCED_FROM_TECHNICIAN", "employee", employeeId, "技师状态已同步至员工任职", null, new EmployeeLink(employeeId, null, before.code(), before.name(), before.phone(), input.active()));
  }

  @PutMapping("/technicians/{id}/queue-enabled")
  @Transactional
  Technician setTechnicianQueueEnabled(@PathVariable UUID id, @RequestBody QueueEnabledInput input,
                                       @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                       @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Technician before = technician(storeId, id);
    if (!Boolean.TRUE.equals(before.active())) throw new ResponseStatusException(HttpStatus.CONFLICT, "离职技师不能加入前台队列");
    if (before.queueEnabled() == input.enabled()) return before;
    jdbc.sql("update technician set queue_enabled=:enabled,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("enabled", input.enabled()).param("id", id).param("store", storeId).update();
    if (!input.enabled()) {
      // Queue membership is a daily operational position, not historical data.
      // Removing it hides the technician without touching service or event history.
      jdbc.sql("delete from technician_queue_position where technician_id=:technician and queue_day_id in (select id from technician_queue_day where store_id=:store and business_date=:date)")
        .param("technician", id).param("store", storeId).param("date", businessClock.currentBusinessDate(storeId)).update();
    }
    Technician after = technician(storeId, id);
    if (input.enabled()) queue.currentQueue(storeId);
    audits.record(authorization, storeId, "FOUNDATION", input.enabled() ? "TECHNICIAN_QUEUE_ENABLED" : "TECHNICIAN_QUEUE_DISABLED",
      "technician", id, input.enabled() ? "启用前台技师队列" : "停用前台技师队列", before, after);
    return after;
  }

  @PutMapping("/technicians/order")
  @Transactional
  void reorderTechnicians(@Valid @RequestBody List<TechnicianOrder> orders, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    AdminSessionService.AuthenticatedIdentity actor = adminSessions.authenticatedIdentity(authorization);
    List<Technician> before = technicians(true, true, authorization, requestedStoreId);
    if (orders == null || orders.isEmpty() || orders.stream().map(TechnicianOrder::queueOrder).collect(java.util.stream.Collectors.toSet()).size() != orders.size()
      || !orders.stream().map(TechnicianOrder::queueOrder).collect(java.util.stream.Collectors.toSet()).containsAll(java.util.stream.IntStream.rangeClosed(1, orders.size()).boxed().toList())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Queue positions must be unique and start at 1");
    }
    try {
      queue.reorder(storeId, orders.stream().sorted(java.util.Comparator.comparingInt(TechnicianOrder::queueOrder)).map(order -> new TechnicianQueueService.QueueOrder(order.id())).toList(), actor.userId(), actor.displayName());
    } catch (IllegalArgumentException exception) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, exception.getMessage());
    }
    audits.record(authorization, storeId, "FOUNDATION", "TECHNICIAN_QUEUE_REORDERED", "technician_queue", storeId, "Adjusted today's technician queue", before, queue.currentQueue(storeId));
  }

  @GetMapping("/rooms")
  List<Room> rooms(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("select id, code, name, room_type, bed_count from room where store_id=:store and active=true order by code")
      .param("store", storeId).query(Room.class).list();
  }

  @GetMapping("/service-items")
  List<ServiceItem> services(@RequestParam(defaultValue = "false") boolean includeInactive, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate businessDate = businessClock.currentBusinessDate(storeId);
    String sql = includeInactive
      ? serviceItemSql("where item.store_id=:store order by item.active desc,item.code")
      : serviceItemSql("where item.store_id=:store and item.active=true order by item.code");
    return jdbc.sql(sql)
      .param("store", storeId).param("date", businessDate).query(ServiceItem.class).list();
  }

  @GetMapping("/service-items/{id}/price-versions")
  List<PriceVersion> priceVersions(@PathVariable UUID id, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    serviceItem(storeId, id);
    return jdbc.sql("select id,price_cents,effective_business_date,created_at from service_item_price_version where store_id=:store and service_item_id=:service order by effective_business_date desc")
      .param("store", storeId).param("service", id).query(PriceVersion.class).list();
  }

  @PostMapping("/service-items")
  @Transactional
  ServiceItem createServiceItem(@Valid @RequestBody ServiceItemInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate businessDate = businessClock.currentBusinessDate(storeId);
    LocalDate effectiveDate = effectiveDate(input.priceEffectiveBusinessDate(), businessDate);
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into service_item(id,tenant_id,store_id,code,name,category,category_id,default_duration_minutes,price_cents,requires_room,allows_extension,counts_as_clock) values(:id,:tenant,:store,:code,:name,:category,:categoryId,:duration,:price,:requiresRoom,:allowsExtension,:countsAsClock)")
      .param("id", id).param("tenant", TENANT_ID).param("store", storeId).param("code", input.code()).param("name", input.name()).param("category", input.category())
      .param("categoryId", input.categoryId())
      .param("duration", input.defaultDurationMinutes()).param("price", input.priceCents()).param("requiresRoom", input.requiresRoom()).param("allowsExtension", input.allowsExtension()).param("countsAsClock", countsAsClock(input.countsAsClock())).update();
    savePriceVersion(storeId, id, input.priceCents(), effectiveDate);
    if (!effectiveDate.equals(businessDate)) savePriceVersion(storeId, id, input.priceCents(), businessDate);
    seedCommissionVersion(storeId, id, businessDate);
    ServiceItem created = serviceItem(storeId, id);
    audits.record(authorization, storeId, "FOUNDATION", "SERVICE_ITEM_CREATED", "service_item", id, "新增服务项目", null, created);
    return created;
  }

  @PutMapping("/service-items/{id}")
  @Transactional
  ServiceItem updateServiceItem(@PathVariable UUID id, @Valid @RequestBody ServiceItemInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    ServiceItem before = serviceItem(storeId, id);
    LocalDate businessDate = businessClock.currentBusinessDate(storeId);
    LocalDate effectiveDate = effectiveDate(input.priceEffectiveBusinessDate(), businessDate);
    jdbc.sql("update service_item set code=:code,name=:name,category=:category,category_id=:categoryId,default_duration_minutes=:duration,price_cents=case when :effectiveDate=:businessDate then :price else price_cents end,requires_room=:requiresRoom,allows_extension=:allowsExtension,counts_as_clock=:countsAsClock,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("id", id).param("store", storeId).param("code", input.code()).param("name", input.name()).param("category", input.category())
      .param("categoryId", input.categoryId())
      .param("duration", input.defaultDurationMinutes()).param("price", input.priceCents()).param("effectiveDate", effectiveDate).param("businessDate", businessDate).param("requiresRoom", input.requiresRoom()).param("allowsExtension", input.allowsExtension()).param("countsAsClock", countsAsClock(input.countsAsClock())).update();
    savePriceVersion(storeId, id, input.priceCents(), effectiveDate);
    ServiceItem updated = serviceItem(storeId, id);
    audits.record(authorization, storeId, "FOUNDATION", "SERVICE_ITEM_UPDATED", "service_item", id, "修改服务项目", before, updated);
    return updated;
  }

  @PutMapping("/service-items/{id}/active")
  @Transactional
  void setServiceItemActive(@PathVariable UUID id, @RequestBody ActiveInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    ServiceItem before = serviceItem(storeId, id);
    jdbc.sql("update service_item set active=:active,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("active", input.active()).param("id", id).param("store", storeId).update();
    ServiceItem after = serviceItem(storeId, id);
    audits.record(authorization, storeId, "FOUNDATION", input.active() ? "SERVICE_ITEM_ENABLED" : "SERVICE_ITEM_DISABLED", "service_item", id, input.active() ? "启用服务项目" : "停用服务项目", before, after);
  }

  private Technician technician(UUID storeId, UUID id) {
    return jdbc.sql("select id, code, name, phone, queue_order, active, queue_enabled from technician where id=:id and store_id=:store")
      .param("id", id).param("store", storeId).query(Technician.class).single();
  }

  private void ensureActiveTechnicianCodeAvailable(UUID storeId, String code, UUID excludedTechnicianId) {
    JdbcClient.StatementSpec statement = excludedTechnicianId == null
      ? jdbc.sql("select exists(select 1 from technician where store_id=:store and code=:code and active=true)")
      : jdbc.sql("select exists(select 1 from technician where store_id=:store and code=:code and active=true and id<>:excluded)")
        .param("excluded", excludedTechnicianId);
    boolean exists = statement.param("store", storeId).param("code", code).query(Boolean.class).single();
    if (exists) throw new ResponseStatusException(HttpStatus.CONFLICT, "该技师编号已被在职技师使用");
  }

  private UUID ensureTechnicianEmployee(UUID storeId, Technician technician) {
    UUID employeeId = jdbc.sql("select employee_id from technician where id=:id and store_id=:store")
      .param("id", technician.id()).param("store", storeId).query(UUID.class).optional().orElse(null);
    if (employeeId != null) return employeeId;
    employeeId = UUID.randomUUID();
    UUID assignmentId = UUID.randomUUID();
    jdbc.sql("insert into employee(id,tenant_id,full_name,phone,active) values(:id,:tenant,:name,:phone,:active)")
      .param("id", employeeId).param("tenant", TENANT_ID).param("name", technician.name()).param("phone", technician.phone()).param("active", technician.active()).update();
    jdbc.sql("insert into employee_store_assignment(id,tenant_id,employee_id,store_id,employee_no,position_type,position_name,employment_status,active,left_on,note) values(:id,:tenant,:employee,:store,:employeeNo,'TECHNICIAN','技师',:status,:active,:leftOn,'由技师档案自动补齐')")
      .param("id", assignmentId).param("tenant", TENANT_ID).param("employee", employeeId).param("store", storeId).param("employeeNo", technician.code())
      .param("status", technician.active() ? "ACTIVE" : "LEFT").param("active", technician.active()).param("leftOn", technician.active() ? null : LocalDate.now()).update();
    jdbc.sql("update technician set employee_id=:employee,updated_at=now(),version=version+1 where id=:id and store_id=:store and employee_id is null")
      .param("employee", employeeId).param("id", technician.id()).param("store", storeId).update();
    return employeeId;
  }

  private ServiceItem serviceItem(UUID storeId, UUID id) {
    return jdbc.sql(serviceItemSql("where item.id=:id and item.store_id=:store"))
      .param("id", id).param("store", storeId).param("date", businessClock.currentBusinessDate(storeId)).query(ServiceItem.class).single();
  }

  private String serviceItemSql(String whereClause) {
    return "select item.id,item.code,item.name,item.category,item.category_id,item.default_duration_minutes," +
      "coalesce(current_price.price_cents,item.price_cents) price_cents," +
      "coalesce(current_price.effective_business_date,date '1970-01-01') price_effective_business_date," +
      "next_price.price_cents scheduled_price_cents,next_price.effective_business_date scheduled_price_effective_business_date," +
      "item.requires_room,item.allows_extension,item.counts_as_clock,item.dispatch_type,item.active " +
      "from service_item item " +
      "left join lateral (select price_cents,effective_business_date from service_item_price_version version where version.service_item_id=item.id and version.effective_business_date<=:date order by version.effective_business_date desc limit 1) current_price on true " +
      "left join lateral (select price_cents,effective_business_date from service_item_price_version version where version.service_item_id=item.id and version.effective_business_date>:date order by version.effective_business_date limit 1) next_price on true " + whereClause;
  }

  private void savePriceVersion(UUID storeId, UUID serviceItemId, int priceCents, LocalDate effectiveDate) {
    jdbc.sql("insert into service_item_price_version(id,tenant_id,store_id,service_item_id,price_cents,effective_business_date) values(:id,:tenant,:store,:service,:price,:effective) on conflict(service_item_id,effective_business_date) do update set price_cents=excluded.price_cents,updated_at=now(),version=service_item_price_version.version+1")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("service", serviceItemId).param("price", priceCents).param("effective", effectiveDate).update();
  }

  private void seedCommissionVersion(UUID storeId, UUID serviceItemId, LocalDate effectiveDate) {
    jdbc.sql("insert into service_item_commission_rule_version(id,tenant_id,store_id,service_item_id,effective_business_date) values(:id,:tenant,:store,:service,:effective)")
      .param("id", UUID.randomUUID()).param("tenant", TENANT_ID).param("store", storeId).param("service", serviceItemId).param("effective", effectiveDate).update();
  }

  private LocalDate effectiveDate(LocalDate requested, LocalDate current) {
    LocalDate result = requested == null ? current : requested;
    if (result.isBefore(current)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Effective business date cannot be in the past");
    return result;
  }

  private boolean countsAsClock(Boolean value) { return value == null || value; }

  record Technician(UUID id, String code, String name, String phone, Integer queueOrder, Boolean active, Boolean queueEnabled) {}
  record EmployeeLink(UUID employeeId, UUID assignmentId, String employeeNo, String fullName, String phone, Boolean active) {}
  record TechnicianInput(@NotBlank String code, @NotBlank String name, String phone, @NotNull Integer queueOrder) {}
  record ActiveInput(boolean active) {}
  record QueueEnabledInput(boolean enabled) {}
  record TechnicianOrder(@NotNull UUID id, @NotNull Integer queueOrder) {}
  record Room(UUID id, String code, String name, String roomType, Short bedCount) {}
  record ServiceItem(UUID id, String code, String name, String category, UUID categoryId, Short defaultDurationMinutes,
                     Integer priceCents, LocalDate priceEffectiveBusinessDate, Integer scheduledPriceCents,
                     LocalDate scheduledPriceEffectiveBusinessDate, Boolean requiresRoom, Boolean allowsExtension,
                     Boolean countsAsClock, String dispatchType, Boolean active) {}
  record PriceVersion(UUID id, Integer priceCents, LocalDate effectiveBusinessDate, java.time.OffsetDateTime createdAt) {}
  record ServiceItemInput(@NotBlank String code, @NotBlank String name, @NotBlank String category, UUID categoryId,
                          @NotNull @Min(15) Short defaultDurationMinutes, @NotNull @Min(0) Integer priceCents,
                          LocalDate priceEffectiveBusinessDate, boolean requiresRoom, boolean allowsExtension,
                          Boolean countsAsClock, String dispatchType) {}
}
