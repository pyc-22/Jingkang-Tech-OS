package com.chengxin.massage.audit;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;

class AuditAddressTest {
  @Test
  void acceptsLiteralAddressesAndFallsBackForMalformedForwarding() {
    assertThat(AuditService.clientAddress("203.0.113.1, 127.0.0.1", "127.0.0.1")).isEqualTo("203.0.113.1");
    assertThat(AuditService.clientAddress("2001:db8::1", "127.0.0.1")).isEqualTo("2001:db8::1");
    for (String invalid : new String[] {"", "localhost", "999.1.2.3", "1.2.3.4:80", "1.2.3.4/24", "<script>", "::not-ip", ","}) {
      assertThat(AuditService.clientAddress(invalid, "127.0.0.1")).as(invalid).isEqualTo("127.0.0.1");
    }
    assertThat(AuditService.clientAddress(null, "bad-address")).isNull();
  }
}
