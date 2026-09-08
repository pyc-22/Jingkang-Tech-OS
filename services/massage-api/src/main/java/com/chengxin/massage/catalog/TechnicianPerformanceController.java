package com.chengxin.massage.catalog;

import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import com.chengxin.massage.admin.StoreContextService;

@RestController
@RequestMapping("/api/v1/technician-performance")
@CrossOrigin(origins = "*")
public class TechnicianPerformanceController {
  private static final String EFFECTIVE_RECORD_CTE = """
    WITH adjustment_totals AS (
      SELECT original_commission_record_id original_id,
             COALESCE(SUM(base_amount_cents), 0) base_delta,
             COALESCE(SUM(commission_cents), 0) commission_delta,
             COALESCE(SUM(clock_count_adjustment), 0) clock_delta,
             COALESCE(SUM(duration_minutes_adjustment), 0) duration_delta
      FROM technician_commission_record
      WHERE record_type IN ('REFUND_REVERSAL','ORDER_VOID_REVERSAL','BUSINESS_CORRECTION_REVERSAL')
      GROUP BY original_commission_record_id
    ), effective_records AS (
      SELECT base.*,
             GREATEST(0, base.base_amount_cents + COALESCE(adjustment.base_delta, 0)) effective_base_amount_cents,
             GREATEST(0, base.commission_cents + COALESCE(adjustment.commission_delta, 0)) effective_commission_cents,
             (base.clock_count_adjustment + COALESCE(adjustment.clock_delta, 0))::smallint effective_clock_count_adjustment,
             (base.duration_minutes_adjustment + COALESCE(adjustment.duration_delta, 0))::smallint effective_duration_minutes_adjustment
      FROM technician_commission_record base
      LEFT JOIN adjustment_totals adjustment ON adjustment.original_id = base.id
      WHERE base.record_type IN ('SETTLEMENT','BUSINESS_CORRECTION')
    )
    """;
  private final JdbcClient jdbc;
  private final StoreContextService storeContext;

  TechnicianPerformanceController(JdbcClient jdbc, StoreContextService storeContext) {
    this.jdbc = jdbc;
    this.storeContext = storeContext;
  }

  @GetMapping
  List<TechnicianPerformance> list(@RequestParam(defaultValue = "") String from,
                                  @RequestParam(defaultValue = "") String to,
                                  @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                  @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return jdbc.sql(EFFECTIVE_RECORD_CTE + "select t.id technician_id,t.code technician_code,t.name technician_name,coalesce(sum(record.effective_clock_count_adjustment),0) completed_count,coalesce(sum(record.effective_base_amount_cents),0) amount_cents,coalesce(sum(record.effective_duration_minutes_adjustment),0) total_minutes,case when sum(record.effective_clock_count_adjustment)>0 then round(sum(record.effective_base_amount_cents)::numeric/sum(record.effective_clock_count_adjustment)) else 0 end average_amount_cents,string_agg(distinct record.service_name_snapshot,'、') project_names from technician t join effective_records record on record.technician_id=t.id and record.store_id=:store and (:from='' or record.business_date>=cast(:from as date)) and (:to='' or record.business_date<=cast(:to as date)) where t.store_id=:store and (record.effective_base_amount_cents>0 or record.effective_commission_cents>0 or record.effective_clock_count_adjustment>0 or record.effective_duration_minutes_adjustment>0) group by t.id,t.code,t.name order by amount_cents desc,completed_count desc,t.code limit 100")
      .param("store", storeId).param("from", from).param("to", to).query(TechnicianPerformance.class).list();
  }

  record TechnicianPerformance(UUID technicianId, String technicianCode, String technicianName, Long completedCount,
                               Long amountCents, Long totalMinutes, Long averageAmountCents, String projectNames) {}
}
