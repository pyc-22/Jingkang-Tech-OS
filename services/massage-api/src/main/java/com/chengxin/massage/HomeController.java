package com.chengxin.massage;

import java.time.OffsetDateTime;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ResponseBody;

@Controller
public class HomeController {
  private static final String RELEASE = "20260913-next-optimization-v1";
  private final JdbcClient jdbc;

  HomeController(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  @GetMapping("/")
  public String home() {
    return "redirect:/index.html";
  }

  @GetMapping("/api/health")
  @ResponseBody
  public Map<String, Object> health() {
    Integer database = jdbc.sql("select 1").query(Integer.class).single();
    Boolean expenseClaimSequence = jdbc.sql("select coalesce(has_sequence_privilege(current_user,to_regclass('expense_claim_no_seq'),'USAGE'),false)")
      .query(Boolean.class).single();
    return Map.of(
      "status", database == 1 && Boolean.TRUE.equals(expenseClaimSequence) ? "UP" : "DOWN",
      "service", "massage-api",
      "database", database == 1 ? "UP" : "DOWN",
      "expenseClaimSequence", expenseClaimSequence,
      "release", RELEASE,
      "time", OffsetDateTime.now()
    );
  }
}
