package com.chengxin.massage.catalog;

import com.chengxin.massage.admin.StoreContextService;
import com.chengxin.massage.audit.AuditService;
import com.chengxin.massage.operations.BusinessClockService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
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

@RestController
@RequestMapping("/api/v1/service-categories")
@CrossOrigin(origins = "*")
public class ServiceCategoryController {
  private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;
  private final AuditService audits;
  private final BusinessClockService businessClock;

  ServiceCategoryController(JdbcClient jdbc, StoreContextService storeContext, AuditService audits, BusinessClockService businessClock) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
    this.audits = audits;
    this.businessClock = businessClock;
  }

  @GetMapping
  List<Category> list(@RequestParam(defaultValue = "false") boolean includeInactive,
                      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    String where = includeInactive ? "" : " and active=true";
    return jdbc.sql("select id,parent_id,code,name,sort_order,active from service_item_category where store_id=:store" + where + " order by coalesce(parent_id,id),sort_order,name")
      .param("store", storeId).query(Category.class).list();
  }

  @PostMapping
  @Transactional
  Category create(@Valid @RequestBody CategoryInput input,
                  @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                  @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    ensureParent(storeId, input.parentId(), null);
    UUID id = UUID.randomUUID();
    jdbc.sql("insert into service_item_category(id,tenant_id,store_id,parent_id,code,name,sort_order) values(:id,:tenant,:store,:parent,:code,:name,:sort)")
      .param("id", id).param("tenant", TENANT_ID).param("store", storeId).param("parent", input.parentId())
      .param("code", input.code().trim()).param("name", input.name().trim()).param("sort", input.sortOrder()).update();
    Category created = category(storeId, id);
    audits.record(authorization, storeId, "FOUNDATION", "SERVICE_CATEGORY_CREATED", "service_item_category", id, "Created service category", null, created);
    return created;
  }

  @PutMapping("/{id}")
  @Transactional
  Category update(@PathVariable UUID id, @Valid @RequestBody CategoryInput input,
                  @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                  @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Category before = category(storeId, id);
    if (id.equals(input.parentId())) throw bad("Category cannot be its own parent");
    ensureParent(storeId, input.parentId(), id);
    jdbc.sql("update service_item_category set parent_id=:parent,code=:code,name=:name,sort_order=:sort,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("id", id).param("store", storeId).param("parent", input.parentId()).param("code", input.code().trim())
      .param("name", input.name().trim()).param("sort", input.sortOrder()).update();
    Category updated = category(storeId, id);
    audits.record(authorization, storeId, "FOUNDATION", "SERVICE_CATEGORY_UPDATED", "service_item_category", id, "Updated service category", before, updated);
    return updated;
  }

  @DeleteMapping("/{id}")
  @Transactional
  void delete(@PathVariable UUID id,
              @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
              @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    Category before = category(storeId, id);
    jdbc.sql("update service_item_category set active=false,updated_at=now(),version=version+1 where id=:id and store_id=:store")
      .param("id", id).param("store", storeId).update();
    audits.record(authorization, storeId, "FOUNDATION", "SERVICE_CATEGORY_DELETED", "service_item_category", id, "Deleted service category", before, category(storeId, id));
  }

  @GetMapping("/analytics")
  Analytics analytics(@RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to,
                      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                      @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    LocalDate end = to == null ? businessClock.currentBusinessDate(storeId) : to;
    LocalDate start = from == null ? end.withDayOfMonth(1) : from;
    if (start.isAfter(end)) throw bad("from must be before to");
    List<CategoryStat> categories = jdbc.sql("""
      select c.id category_id,coalesce(c.name,'未分类') category_name,count(distinct item.id)::integer project_count,
             coalesce(sum(case when order_header.id is not null then greatest(0,line.quantity-refund_totals.refunded_quantity) else 0 end),0)::integer sold_quantity,
             coalesce(sum(case when order_header.id is not null then greatest(0,line.line_amount_cents-refund_totals.refunded_cents) else 0 end),0)::bigint sales_amount_cents
      from service_item item
      left join service_item_category c on c.id=item.category_id
      left join sales_order_line line on line.service_item_id=item.id
      left join sales_order order_header on order_header.id=line.order_id and order_header.store_id=:store and order_header.status='SETTLED' and order_header.business_date between :from and :to
      left join lateral (
        select coalesce(sum(refund_line.refund_cents),0)::bigint refunded_cents,
               coalesce(sum(refund_line.quantity),0)::bigint refunded_quantity
        from sales_refund_line refund_line
        join sales_refund refund on refund.id=refund_line.refund_id
        where refund_line.order_line_id=line.id and refund.status='COMPLETED'
      ) refund_totals on true
      where item.store_id=:store and item.active=true
      group by c.id,c.name order by sales_amount_cents desc,category_name
      """).param("store", storeId).param("from", start).param("to", end).query(CategoryStat.class).list();
    List<ProjectStat> projects = jdbc.sql("""
      select item.id project_id,item.name project_name,coalesce(c.name,'未分类') category_name,
             coalesce(sum(case when order_header.id is not null then greatest(0,line.quantity-refund_totals.refunded_quantity) else 0 end),0)::integer sold_quantity,
             coalesce(sum(case when order_header.id is not null then greatest(0,line.line_amount_cents-refund_totals.refunded_cents) else 0 end),0)::bigint sales_amount_cents,
             max(case when order_header.id is not null and greatest(0,line.line_amount_cents-refund_totals.refunded_cents)>0 then order_header.business_date end) last_sold_date
      from service_item item left join service_item_category c on c.id=item.category_id
      left join sales_order_line line on line.service_item_id=item.id
      left join sales_order order_header on order_header.id=line.order_id and order_header.store_id=:store and order_header.status='SETTLED' and order_header.business_date between :from and :to
      left join lateral (
        select coalesce(sum(refund_line.refund_cents),0)::bigint refunded_cents,
               coalesce(sum(refund_line.quantity),0)::bigint refunded_quantity
        from sales_refund_line refund_line
        join sales_refund refund on refund.id=refund_line.refund_id
        where refund_line.order_line_id=line.id and refund.status='COMPLETED'
      ) refund_totals on true
      where item.store_id=:store and item.active=true
      group by item.id,item.name,c.name order by sales_amount_cents desc,project_name
      """).param("store", storeId).param("from", start).param("to", end).query(ProjectStat.class).list();
    return new Analytics(start, end, categories, projects);
  }

  private Category category(UUID storeId, UUID id) {
    return jdbc.sql("select id,parent_id,code,name,sort_order,active from service_item_category where id=:id and store_id=:store")
      .param("id", id).param("store", storeId).query(Category.class).single();
  }

  private void ensureParent(UUID storeId, UUID parentId, UUID currentId) {
    if (parentId == null) return;
    if (parentId.equals(currentId) || !jdbc.sql("select exists(select 1 from service_item_category where id=:id and store_id=:store and active=true)")
      .param("id", parentId).param("store", storeId).query(Boolean.class).single()) throw bad("Parent category not found");
    if (currentId != null && jdbc.sql("""
      with recursive descendants(id) as (
        select id from service_item_category where parent_id=:current and store_id=:store
        union
        select category.id from service_item_category category join descendants child on category.parent_id=child.id where category.store_id=:store
      )
      select exists(select 1 from descendants where id=:parent)
      """).param("current", currentId).param("store", storeId).param("parent", parentId).query(Boolean.class).single()) {
      throw bad("Category cannot be moved below its descendant");
    }
  }

  private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
  record Category(UUID id, UUID parentId, String code, String name, Integer sortOrder, Boolean active) {}
  record CategoryInput(UUID parentId, @NotBlank String code, @NotBlank String name, @NotNull @Min(0) Integer sortOrder) {}
  record CategoryStat(UUID categoryId, String categoryName, Integer projectCount, Integer soldQuantity, Long salesAmountCents) {}
  record ProjectStat(UUID projectId, String projectName, String categoryName, Integer soldQuantity, Long salesAmountCents, LocalDate lastSoldDate) {}
  record Analytics(LocalDate from, LocalDate to, List<CategoryStat> categories, List<ProjectStat> projects) {}
}
