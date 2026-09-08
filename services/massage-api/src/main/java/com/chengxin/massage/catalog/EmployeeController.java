package com.chengxin.massage.catalog;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;

/** Employee master records and store-specific employment assignments. */
@RestController
@RequestMapping("/api/v1/employees")
@CrossOrigin(origins = "*")
public class EmployeeController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final String POSITION_TYPES = "STORE_MANAGER|CASHIER|TECHNICIAN|CLEANER|CHEF|FINANCE|OTHER";
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AuditService audits;

  EmployeeController(JdbcClient jdbc, StoreContextService storeContext, AuditService audits) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.audits = audits;
  }

  @GetMapping
  List<EmployeeAssignment> list(@RequestParam(defaultValue = "false") boolean includeInactive,
                                @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    String sql = employeeAssignmentSql(includeInactive
      ? "where assignment.store_id=:store and assignment.tenant_id=:tenant"
      : "where assignment.store_id=:store and assignment.tenant_id=:tenant and assignment.active=true and employee.active=true");
    return jdbc.sql(sql).param("store", storeId).param("tenant", TENANT_ID).query(EmployeeAssignment.class).list();
  }

  @PostMapping
  @Transactional
  EmployeeAssignment create(@Valid @RequestBody CreateEmployeeInput input,
                            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                            @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    if (input.userId() != null) ensureAvailableUser(input.userId());
    UUID employeeId = UUID.randomUUID();
    UUID assignmentId = UUID.randomUUID();
    jdbc.sql("insert into employee(id,tenant_id,full_name,phone,note) values(:id,:tenant,:name,:phone,:note)")
      .param("id", employeeId).param("tenant", TENANT_ID).param("name", input.fullName().trim())
      .param("phone", blankToNull(input.phone())).param("note", blankToNull(input.note())).update();
    insertAssignment(assignmentId, employeeId, storeId, input.employeeNo(), input.positionType(), input.positionName(), input.hiredOn(), input.note());
    if (input.userId() != null) linkUser(employeeId, input.userId());
    EmployeeAssignment created = assignment(storeId, assignmentId);
    audits.record(authorization, storeId, "EMPLOYEE", "EMPLOYEE_CREATED", "employee", employeeId, "Employee created", null, created);
    return created;
  }

  @PutMapping("/{employeeId}")
  @Transactional
  EmployeeAssignment update(@PathVariable UUID employeeId, @Valid @RequestBody UpdateEmployeeInput input,
                            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                            @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    EmployeeAssignment before = employeeAssignmentForStore(storeId, employeeId);
    jdbc.sql("update employee set full_name=:name,phone=:phone,note=:note,updated_at=now(),version=version+1 where id=:id and tenant_id=:tenant")
      .param("id", employeeId).param("tenant", TENANT_ID).param("name", input.fullName().trim())
      .param("phone", blankToNull(input.phone())).param("note", blankToNull(input.note())).update();
    EmployeeAssignment updated = assignment(storeId, before.assignmentId());
    audits.record(authorization, storeId, "EMPLOYEE", "EMPLOYEE_UPDATED", "employee", employeeId, "Employee updated", before, updated);
    return updated;
  }

  @PostMapping("/{employeeId}/assignments")
  @Transactional
  EmployeeAssignment createAssignment(@PathVariable UUID employeeId, @Valid @RequestBody AssignmentInput input,
                                      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    ensureEmployee(employeeId);
    if (jdbc.sql("select exists(select 1 from employee_store_assignment where employee_id=:employee and store_id=:store)")
      .param("employee", employeeId).param("store", storeId).query(Boolean.class).single()) {
      throw conflict("Employee already has an assignment at this store");
    }
    UUID assignmentId = UUID.randomUUID();
    insertAssignment(assignmentId, employeeId, storeId, input.employeeNo(), input.positionType(), input.positionName(), input.hiredOn(), input.note());
    EmployeeAssignment created = assignment(storeId, assignmentId);
    audits.record(authorization, storeId, "EMPLOYEE", "EMPLOYEE_ASSIGNMENT_CREATED", "employee_assignment", assignmentId,
      "Employee store assignment created", null, created);
    return created;
  }

  @PutMapping("/assignments/{assignmentId}")
  @Transactional
  EmployeeAssignment updateAssignment(@PathVariable UUID assignmentId, @Valid @RequestBody AssignmentInput input,
                                      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    EmployeeAssignment before = assignment(storeId, assignmentId);
    if (before.technicianId() != null && !"TECHNICIAN".equals(input.positionType())) {
      throw conflict("A technician profile requires the TECHNICIAN position type");
    }
    if (before.technicianId() != null && !java.util.Objects.equals(blankToNull(input.employeeNo()), before.employeeNo())) {
      throw conflict("Technician code must be managed from the technician profile");
    }
    jdbc.sql("update employee_store_assignment set employee_no=:employeeNo,position_type=:positionType,position_name=:positionName,hired_on=:hiredOn,note=:note,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("id", assignmentId).param("store", storeId).param("employeeNo", blankToNull(input.employeeNo()))
      .param("positionType", input.positionType()).param("positionName", input.positionName().trim()).param("hiredOn", input.hiredOn())
      .param("note", blankToNull(input.note())).update();
    EmployeeAssignment updated = assignment(storeId, assignmentId);
    audits.record(authorization, storeId, "EMPLOYEE", "EMPLOYEE_ASSIGNMENT_UPDATED", "employee_assignment", assignmentId,
      "Employee store assignment updated", before, updated);
    return updated;
  }

  @PutMapping("/assignments/{assignmentId}/employment-status")
  @Transactional
  EmployeeAssignment updateEmploymentStatus(@PathVariable UUID assignmentId, @Valid @RequestBody EmploymentStatusInput input,
                                            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                            @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    EmployeeAssignment before = assignment(storeId, assignmentId);
    boolean active = "ACTIVE".equals(input.employmentStatus());
    LocalDate leftOn = "LEFT".equals(input.employmentStatus())
      ? (input.leftOn() == null ? LocalDate.now() : input.leftOn())
      : null;
    jdbc.sql("update employee_store_assignment set employment_status=:status,active=:active,left_on=:leftOn,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("id", assignmentId).param("store", storeId).param("status", input.employmentStatus()).param("active", active).param("leftOn", leftOn).update();
    if (before.technicianId() != null) {
      jdbc.sql("update technician set employment_status=:status,active=:active,updated_at=now(),version=version+1 where id=:id and store_id=:store")
        .param("id", before.technicianId()).param("store", storeId).param("status", input.employmentStatus()).param("active", active).update();
    }
    EmployeeAssignment updated = assignment(storeId, assignmentId);
    String action = "LEFT".equals(input.employmentStatus()) ? "EMPLOYEE_LEFT" : "EMPLOYEE_EMPLOYMENT_STATUS_UPDATED";
    audits.record(authorization, storeId, "EMPLOYEE", action, "employee_assignment", assignmentId,
      "Employee employment status updated", before, updated);
    return updated;
  }

  @PostMapping("/{employeeId}/technician-profile")
  @Transactional
  TechnicianProfile createTechnicianProfile(@PathVariable UUID employeeId, @Valid @RequestBody TechnicianProfileInput input,
                                            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                            @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    EmployeeAssignment employee = employeeAssignmentForStore(storeId, employeeId);
    if (!employee.active() || !"ACTIVE".equals(employee.employmentStatus())) throw conflict("Only active employees can receive a technician profile");
    if (!"TECHNICIAN".equals(employee.positionType())) throw conflict("Employee position must be TECHNICIAN");
    if (employee.technicianId() != null) throw conflict("Employee already has a technician profile at this store");
    String code = input.code().trim();
    boolean codeInUse = jdbc.sql("select exists(select 1 from technician where store_id=:store and code=:code and active=true)")
      .param("store", storeId).param("code", code).query(Boolean.class).single();
    if (codeInUse) throw conflict("该技师编号已被在职技师使用");
    UUID technicianId = UUID.randomUUID();
    jdbc.sql("insert into technician(id,tenant_id,store_id,employee_id,code,name,phone,queue_order) values(:id,:tenant,:store,:employee,:code,:name,:phone,:queue)")
      .param("id", technicianId).param("tenant", TENANT_ID).param("store", storeId).param("employee", employeeId)
      .param("code", code).param("name", employee.fullName()).param("phone", employee.phone()).param("queue", input.queueOrder()).update();
    jdbc.sql("update employee_store_assignment set employee_no=:code,updated_at=now(),version=version+1 where id=:id")
      .param("id", employee.assignmentId()).param("code", code).update();
    TechnicianProfile created = new TechnicianProfile(technicianId, employeeId, code, employee.fullName(), input.queueOrder());
    audits.record(authorization, storeId, "EMPLOYEE", "TECHNICIAN_PROFILE_CREATED", "technician", technicianId,
      "Technician profile created from employee", employee, created);
    return created;
  }

  @PutMapping("/{employeeId}/account")
  @Transactional
  EmployeeAssignment updateAccount(@PathVariable UUID employeeId, @RequestBody AccountLinkInput input,
                                   @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                   @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    EmployeeAssignment before = employeeAssignmentForStore(storeId, employeeId);
    if (before.technicianId() != null && jdbc.sql("select exists(select 1 from technician_account_binding where technician_id=:technician)")
      .param("technician", before.technicianId()).query(Boolean.class).single()) {
      throw conflict("Technician mobile accounts must be managed from the technician account screen");
    }
    if (input.userId() == null) {
      jdbc.sql("delete from employee_user_link where employee_id=:employee").param("employee", employeeId).update();
      EmployeeAssignment updated = assignment(storeId, before.assignmentId());
      audits.record(authorization, storeId, "EMPLOYEE", "EMPLOYEE_ACCOUNT_UNLINKED", "employee", employeeId,
        "Employee account unlinked", before, updated);
      return updated;
    }
    ensureAvailableUserForEmployee(input.userId(), employeeId);
    jdbc.sql("delete from employee_user_link where employee_id=:employee").param("employee", employeeId).update();
    linkUser(employeeId, input.userId());
    EmployeeAssignment updated = assignment(storeId, before.assignmentId());
    audits.record(authorization, storeId, "EMPLOYEE", "EMPLOYEE_ACCOUNT_LINKED", "employee", employeeId,
      "Employee account linked", before, updated);
    return updated;
  }

  @GetMapping("/account-options")
  List<AccountOption> accountOptions(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                     @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql("select user_account.id,user_account.login_name,user_account.display_name from app_user user_account where user_account.tenant_id=:tenant and user_account.active=true and not exists(select 1 from employee_user_link link where link.user_id=user_account.id) order by user_account.login_name")
      .param("tenant", TENANT_ID).query(AccountOption.class).list();
  }

  private void insertAssignment(UUID assignmentId, UUID employeeId, UUID storeId, String employeeNo, String positionType,
                                String positionName, LocalDate hiredOn, String note) {
    jdbc.sql("insert into employee_store_assignment(id,tenant_id,employee_id,store_id,employee_no,position_type,position_name,hired_on,note) values(:id,:tenant,:employee,:store,:employeeNo,:positionType,:positionName,:hiredOn,:note)")
      .param("id", assignmentId).param("tenant", TENANT_ID).param("employee", employeeId).param("store", storeId)
      .param("employeeNo", blankToNull(employeeNo)).param("positionType", positionType).param("positionName", positionName.trim())
      .param("hiredOn", hiredOn).param("note", blankToNull(note)).update();
  }

  private void linkUser(UUID employeeId, UUID userId) {
    jdbc.sql("insert into employee_user_link(employee_id,user_id,tenant_id) values(:employee,:user,:tenant)")
      .param("employee", employeeId).param("user", userId).param("tenant", TENANT_ID).update();
  }

  private EmployeeAssignment employeeAssignmentForStore(UUID storeId, UUID employeeId) {
    return jdbc.sql(employeeAssignmentSql("where assignment.store_id=:store and assignment.employee_id=:employee and assignment.tenant_id=:tenant"))
      .param("store", storeId).param("employee", employeeId).param("tenant", TENANT_ID).query(EmployeeAssignment.class).optional()
      .orElseThrow(() -> notFound("Employee is not assigned to this store"));
  }

  private EmployeeAssignment assignment(UUID storeId, UUID assignmentId) {
    return jdbc.sql(employeeAssignmentSql("where assignment.store_id=:store and assignment.id=:assignment and assignment.tenant_id=:tenant"))
      .param("store", storeId).param("assignment", assignmentId).param("tenant", TENANT_ID).query(EmployeeAssignment.class).optional()
      .orElseThrow(() -> notFound("Employee assignment not found"));
  }

  private String employeeAssignmentSql(String whereClause) {
    return "select assignment.id assignment_id,employee.id employee_id,assignment.employee_no,employee.full_name,employee.phone," +
      "assignment.position_type,assignment.position_name,assignment.employment_status,assignment.hired_on,assignment.left_on,assignment.active,assignment.note," +
      "user_account.id user_id,user_account.login_name,technician.id technician_id " +
      "from employee_store_assignment assignment join employee on employee.id=assignment.employee_id " +
      "left join employee_user_link link on link.employee_id=employee.id " +
      "left join app_user user_account on user_account.id=link.user_id " +
      "left join technician on technician.employee_id=employee.id and technician.store_id=assignment.store_id " + whereClause +
      " order by assignment.active desc,assignment.position_type,employee.full_name";
  }

  private void ensureEmployee(UUID employeeId) {
    boolean exists = jdbc.sql("select exists(select 1 from employee where id=:id and tenant_id=:tenant)")
      .param("id", employeeId).param("tenant", TENANT_ID).query(Boolean.class).single();
    if (!exists) throw notFound("Employee not found");
  }

  private void ensureAvailableUser(UUID userId) { ensureAvailableUserForEmployee(userId, null); }

  private void ensureAvailableUserForEmployee(UUID userId, UUID employeeId) {
    boolean exists = jdbc.sql("select exists(select 1 from app_user where id=:id and tenant_id=:tenant and active=true)")
      .param("id", userId).param("tenant", TENANT_ID).query(Boolean.class).single();
    if (!exists) throw notFound("Active account not found");
    boolean linkedElsewhere = jdbc.sql("select exists(select 1 from employee_user_link where user_id=:user and (:employee is null or employee_id<>:employee))")
      .param("user", userId).param("employee", employeeId).query(Boolean.class).single();
    if (linkedElsewhere) throw conflict("Account is already linked to another employee");
  }

  private String blankToNull(String value) { return value == null || value.isBlank() ? null : value.trim(); }
  private ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }
  private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }

  record EmployeeAssignment(UUID assignmentId, UUID employeeId, String employeeNo, String fullName, String phone,
                            String positionType, String positionName, String employmentStatus, LocalDate hiredOn,
                            LocalDate leftOn, Boolean active, String note, UUID userId, String loginName, UUID technicianId) {}
  record AccountOption(UUID id, String loginName, String displayName) {}
  record CreateEmployeeInput(@NotBlank @Size(max = 120) String fullName, @Size(max = 30) String phone,
                             @Size(max = 40) String employeeNo, @NotBlank @Pattern(regexp = POSITION_TYPES) String positionType,
                             @NotBlank @Size(max = 80) String positionName, LocalDate hiredOn, @Size(max = 240) String note, UUID userId) {}
  record UpdateEmployeeInput(@NotBlank @Size(max = 120) String fullName, @Size(max = 30) String phone, @Size(max = 240) String note) {}
  record AssignmentInput(@Size(max = 40) String employeeNo, @NotBlank @Pattern(regexp = POSITION_TYPES) String positionType,
                         @NotBlank @Size(max = 80) String positionName, LocalDate hiredOn, @Size(max = 240) String note) {}
  record EmploymentStatusInput(@NotBlank @Pattern(regexp = "ACTIVE|INACTIVE|LEFT") String employmentStatus, LocalDate leftOn) {}
  record AccountLinkInput(UUID userId) {}
  record TechnicianProfileInput(@NotBlank @Size(max = 40) String code, @NotNull @Min(1) Integer queueOrder) {}
  record TechnicianProfile(UUID technicianId, UUID employeeId, String code, String name, Integer queueOrder) {}
}
