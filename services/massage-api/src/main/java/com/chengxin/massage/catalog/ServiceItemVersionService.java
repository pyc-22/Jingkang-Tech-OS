package com.chengxin.massage.catalog;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class ServiceItemVersionService {
  private final JdbcClient jdbc;

  ServiceItemVersionService(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  public Optional<ResolvedServiceItem> activeItem(UUID storeId, UUID serviceItemId, LocalDate businessDate) {
    return jdbc.sql(itemSql("where item.id=:id and item.store_id=:store and item.active=true"))
      .param("id", serviceItemId).param("store", storeId).param("date", businessDate)
      .query(ResolvedServiceItem.class).optional();
  }

  public List<ResolvedServiceItem> activeItems(UUID storeId, LocalDate businessDate, boolean extensionOnly) {
    String extensionFilter = extensionOnly ? " and item.allows_extension=true" : "";
    return jdbc.sql(itemSql("where item.store_id=:store and item.active=true" + extensionFilter + " order by item.code"))
      .param("store", storeId).param("date", businessDate).query(ResolvedServiceItem.class).list();
  }

  public CommissionRuleVersion commissionRule(UUID storeId, UUID serviceItemId, LocalDate businessDate) {
    return jdbc.sql(commissionSql("where rule.store_id=:store and rule.service_item_id=:service and rule.effective_business_date<=:date order by rule.effective_business_date desc limit 1"))
      .param("store", storeId).param("service", serviceItemId).param("date", businessDate)
      .query(CommissionRuleVersion.class).single();
  }

  public CommissionRuleVersion commissionRule(UUID storeId, UUID versionId) {
    return jdbc.sql(commissionSql("where rule.store_id=:store and rule.id=:id"))
      .param("store", storeId).param("id", versionId).query(CommissionRuleVersion.class).single();
  }

  private String itemSql(String whereClause) {
    return "select item.id,item.code,item.name,item.category,item.default_duration_minutes," +
      "coalesce(price.price_cents,item.price_cents) price_cents,price.id price_version_id," +
      "coalesce(price.effective_business_date,date '1970-01-01') price_effective_business_date," +
      "item.requires_room,item.allows_extension,item.counts_as_clock,item.dispatch_type " +
      "from service_item item left join lateral (" +
      "select version.id,version.price_cents,version.effective_business_date from service_item_price_version version " +
      "where version.service_item_id=item.id and version.effective_business_date<=:date " +
      "order by version.effective_business_date desc limit 1) price on true " + whereClause;
  }

  private String commissionSql(String whereClause) {
    return "select rule.id,rule.service_item_id,rule.queue_rule_type,rule.queue_fixed_cents,rule.queue_rate_bp," +
      "rule.call_rule_type,rule.call_fixed_cents,rule.call_rate_bp,rule.extension_rule_type," +
      "rule.extension_fixed_cents,rule.extension_rate_bp,rule.active,rule.effective_business_date " +
      "from service_item_commission_rule_version rule " + whereClause;
  }

  public record ResolvedServiceItem(UUID id, String code, String name, String category,
                                    Short defaultDurationMinutes, Integer priceCents, UUID priceVersionId,
                                    LocalDate priceEffectiveBusinessDate, Boolean requiresRoom,
                                    Boolean allowsExtension, Boolean countsAsClock, String dispatchType) {}

  public record CommissionRuleVersion(UUID id, UUID serviceItemId,
                                      String queueRuleType, Long queueFixedCents, Integer queueRateBp,
                                      String callRuleType, Long callFixedCents, Integer callRateBp,
                                      String extensionRuleType, Long extensionFixedCents, Integer extensionRateBp,
                                      Boolean active, LocalDate effectiveBusinessDate) {}
}
