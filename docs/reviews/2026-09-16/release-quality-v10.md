# 20260916-quality-batch3-v10 发布说明

包含前三批 R01-R17 修复。运行要求：Java 21、Node 22+、PostgreSQL 16。数据库密码沿用服务端环境配置，本包不包含凭据或数据库备份。

## 包内容

- apps/massage-console：已跟踪的 Web 资源，排除测试文件；未重打 Android APK，保留服务器已有 downloads 安装包。
- services/massage-api/target/massage-api-0.1.0.jar：可执行 Spring Boot JAR，内含 Flyway 全部迁移。
- services/massage-api/src/main/resources/db/migration：迁移源码供审核；由 Flyway 执行，不手动重复执行。
- server.massage.js、logback-spring.xml、巡检 SQL、三批报告和最终复核报告。
- release.json：版本及源码提交；SHA256SUMS.txt：逐文件摘要。压缩包摘要由打包命令输出。

## 部署前后

1. 在维护窗口停止新业务写入，确认可恢复的数据库备份和当前前后端文件备份。先在数据库副本验证 V95-V98 和现存历史异常。
2. 检查 SHA256SUMS.txt；将本包 JAR/Web/代理脚本部署到现有对应路径，保留环境配置、证书、运行数据和已有 APK。不要整目录覆盖包含数据的服务器根目录。
3. 启动原有 Java 21 服务，Flyway 自动升级。读取启动日志，确认无迁移失败；请求 /api/health，status 应为 UP，release 应为 20260916-quality-batch3-v10。
4. 刷新前台、店长端及技师端缓存，烟测下单/结算/退款、多人房下钟、换房、日报保存/发布及重新登录。
5. 使用专门的新 psql 连接运行只读巡检。命令中的时间范围按实际核对需求调整，密码交互输入：

```powershell
& 'C:/Program Files/PostgreSQL/16/bin/psql.exe' -X -W -h localhost -U postgres -d massage_platform `
  -v ON_ERROR_STOP=1 -v store_id=f3448132-92a9-4263-af9f-f34acf5c310e `
  -v from_date=2026-09-05 -v to_date=2026-09-16 `
  -f tools/maintenance/inspect_data_quality.sql -o inspection-quality-v10.txt
```

脚本以只读 REPEATABLE READ 运行并结束于 ROLLBACK。检查输出的每项 anomaly_count 及最终 INSPECTION_COMPLETE_READ_ONLY；SQL 执行成功本身不表示异常数为零。移除 store_id 参数可检查全部门店，外键检查始终覆盖全库。

## 需人工核对的历史数据

- V95：旧 RECHARGE/BONUS 的 recharge_id 保持 NULL。根据充值凭证和审计建立本金与全部赠送行关联；无赠送也需确认本金自引用，之后才可继续充值退款。应用不按时间窗口推断。
- V96：有历史床位错配时约束保留 NOT VALID，新写入仍受约束。核对服务实际房间/床位后修复旧行，再 VALIDATE CONSTRAINT service_bed_room_ownership。
- V97：旧 PROCESSING 转为 REVIEW_REQUIRED；旧 APPLIED 若缺身份/摘要也拦截重放。应核对实际业务是否已发生，再逐笔处理，不批量删除回执后重试。
- V98：已有床位但房间为空的旧服务需根据凭证核对；修复后 VALIDATE CONSTRAINT service_bed_requires_room。新写入立即受检查约束。
- 旧钱包流水等式错误不由本次迁移重写；保留原始账务证据并按财务核对流程处理。

## 回退

先停止写入并保全故障现场、上线后的新业务数据及日志。优先针对故障前滚修复。若确需回退应用和数据库，使用经过验证的匹配备份方案，并先核对上线后的资金变动，避免丢失已发生交易。Flyway 历史和校验和保持原样；不要手动删除迁移记录或临时关闭约束。

## 本地发布验收

前端 167、后端 167、HTTP/发布资源 38、维护脚本 18 项通过；后端行覆盖率 40.45%。全新数据库迁移至 V98，健康 UP。解压包使用独立本地数据库重复运行 HTTP/资源回归；不连接任何生产数据库。

生产巡检、历史数据逐笔核对及生产健康检查仍属于服务器上线验收步骤，不在本地结果中冒充完成。
