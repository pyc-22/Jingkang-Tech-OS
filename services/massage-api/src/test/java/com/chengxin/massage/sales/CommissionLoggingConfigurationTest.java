package com.chengxin.massage.sales;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.joran.JoranConfigurator;
import ch.qos.logback.classic.util.LogbackMDCAdapter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class CommissionLoggingConfigurationTest {
  private static final Path CONFIG = Path.of("src/main/resources/logback-spring.xml");

  @Test
  void commissionLoggerWritesFormattedMessagesToConsoleAndDailyRollingFile() throws Exception {
    String xml = Files.readString(CONFIG, StandardCharsets.UTF_8);

    assertThat(xml).contains("name=\"COMMISSION_CONSOLE\"");
    assertThat(xml).contains("name=\"COMMISSION_FILE\"");
    assertThat(xml).contains("name=\"COMMISSION\" level=\"DEBUG\" additivity=\"false\"");
    assertThat(xml).contains("<appender-ref ref=\"COMMISSION_CONSOLE\" />");
    assertThat(xml).contains("<appender-ref ref=\"COMMISSION_FILE\" />");
    assertThat(xml).contains("[%d{yyyy-MM-dd HH:mm:ss.SSS}] [COMMISSION] [%level] %msg%n");
    assertThat(xml).contains("commission-%d{yyyy-MM-dd}.log");
    assertThat(xml).contains("<maxHistory>90</maxHistory>");
  }

  @Test
  void productionConfigurationCreatesTheDatedCommissionLog() throws Exception {
    Path logDir = Files.createTempDirectory("commission-log-test-");
    LoggerContext context = new LoggerContext();
    context.setMDCAdapter(new LogbackMDCAdapter());
    context.putProperty("COMMISSION_LOG_DIR", logDir.toString().replace('\\', '/'));
    JoranConfigurator configurator = new JoranConfigurator();
    configurator.setContext(context);
    configurator.doConfigure(CONFIG.toFile());
    context.start();

    context.getLogger("COMMISSION").info("runtime-log-test amount={}", 12345);
    context.stop();

    Path logFile = logDir.resolve("commission-" + LocalDate.now() + ".log");
    assertThat(logFile).exists();
    assertThat(Files.readString(logFile, StandardCharsets.UTF_8))
      .containsPattern("\\[\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3}] \\[COMMISSION] \\[INFO] runtime-log-test amount=12345");
  }
}
