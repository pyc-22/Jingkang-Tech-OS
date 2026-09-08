package com.chengxin.massage.operations;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class BusinessClockService {
  private final JdbcClient jdbc;

  public BusinessClockService(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  public LocalDate currentBusinessDate(UUID storeId) {
    return businessDate(storeId, OffsetDateTime.now());
  }

  public LocalDate businessDate(UUID storeId, OffsetDateTime occurredAt) {
    StoreBusinessTime setting = jdbc.sql("select timezone,business_day_cutoff from store where id=:store")
      .param("store", storeId)
      .query(StoreBusinessTime.class)
      .single();
    return resolveBusinessDate(occurredAt, ZoneId.of(setting.timezone()), setting.businessDayCutoff());
  }

  static LocalDate resolveBusinessDate(OffsetDateTime occurredAt, ZoneId zone, LocalTime cutoff) {
    ZonedDateTime local = occurredAt.atZoneSameInstant(zone);
    return local.toLocalTime().isBefore(cutoff) ? local.toLocalDate().minusDays(1) : local.toLocalDate();
  }

  record StoreBusinessTime(String timezone, LocalTime businessDayCutoff) {}
}
