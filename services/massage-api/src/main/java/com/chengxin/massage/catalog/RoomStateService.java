package com.chengxin.massage.catalog;

import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class RoomStateService {
  private final JdbcClient jdbc;

  RoomStateService(JdbcClient jdbc) { this.jdbc = jdbc; }

  @Transactional(propagation = Propagation.MANDATORY)
  public void record(UUID storeId, UUID roomId, String status, String reason, String source) {
    UUID tenantId = jdbc.sql("select tenant_id from room where id=:room and store_id=:store for update")
      .param("room", roomId).param("store", storeId).query(UUID.class).optional()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room is unavailable"));
    Occupancy occupancy = jdbc.sql("""
      select exists(select 1 from service_session where store_id=:store and room_id=:room and status='IN_SERVICE') in_service,
             exists(select 1 from service_session where store_id=:store and room_id=:room and status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED')) pending,
             exists(select 1 from service_session s where s.store_id=:store and s.room_id=:room and s.status='COMPLETED'
               and not exists(select 1 from sales_order_service_session link join sales_order o on o.id=link.order_id
                 where link.service_session_id=s.id and o.status='SETTLED')) unpaid
      """).param("store", storeId).param("room", roomId).query(Occupancy.class).single();
    if (occupancy.inService()) status = "IN_SERVICE";
    else if (occupancy.pending() && Set.of("IDLE", "PENDING_PAYMENT", "CLEANING").contains(status)) status = "RESERVED";
    else if (occupancy.unpaid() && Set.of("IDLE", "CLEANING").contains(status)) status = "PENDING_PAYMENT";
    jdbc.sql("insert into room_status_event(id,tenant_id,store_id,room_id,status,reason,source,occurred_at) values(:id,:tenant,:store,:room,:status,:reason,:source,clock_timestamp())")
      .param("id", UUID.randomUUID()).param("tenant", tenantId).param("store", storeId).param("room", roomId)
      .param("status", status).param("reason", reason).param("source", source).update();
  }

  record Occupancy(boolean inService, boolean pending, boolean unpaid) {}
}
