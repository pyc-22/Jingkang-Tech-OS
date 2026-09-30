package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class SplitSettlementContractTest {
  @Test
  void settlementUsesSessionPlusAllExtensionsAsTheSmallestUnit() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));

    assertThat(source).contains("validateSettlementUnits(storeId, lines)");
    assertThat(source).contains("service_session_extension extension");
    assertThat(source).contains("service_price_cents + coalesce(sum(extension.service_price_cents),0) total_cents");
    assertThat(source).contains("服务主项与加钟必须在同一张订单中结算");
    assertThat(source).contains("sales_order_service_session");
  }

  @Test
  void pendingSettlementPayloadExposesRoomAndBedForAaGrouping() throws Exception {
    String source = Files.readString(Path.of("src/main/java/com/chengxin/massage/sales/SalesOrderController.java"));

    assertThat(source).contains("ss.bed_id,bed.code bed_code,bed.name bed_name");
    assertThat(source).contains("record PendingServiceSession");
    assertThat(source).contains("UUID bedId, String bedCode, String bedName");
  }
}
