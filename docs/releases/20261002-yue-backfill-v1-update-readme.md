# 20261002-yue-backfill-v1 部署说明

## 部署前备份

1. 备份生产 PostgreSQL `massage_platform`，并确认备份可恢复。
2. 备份当前 API JAR、`apps/massage-console` 静态目录和外部配置文件。
3. 解压发布 ZIP 到独立临时目录，先核对 `SHA256SUMS.txt`，不在原目录直接覆盖。

## 停服与替换顺序

1. 在维护窗口停止 API 服务，确认 8080 已不再接受写请求。
2. 先替换 `services/massage-api/target/massage-api-0.1.0.jar`。
3. 启动 API，让 Flyway 在启动事务中自动执行 V108。
4. 健康检查通过后，再按包内 `apps/massage-console/` 相对路径替换前端文件；不要把两个不同目录的 `index.html` 平铺到同一目录。
5. 恢复真实门店流量；本版本不包含生产数据清理操作。

## 数据库迁移

V108 `manager_yue_record.submission_kind` 由 Flyway 随 API 启动自动迁移，**无需、也禁止手工执行 SQL**。启动日志应显示 V108 成功，失败时停止放量并按回退步骤处理。

## 健康检查与缓存

访问 `/api/health`，确认 HTTP 200、状态为 `UP`，且 `release` 为 `20261002-yue-backfill-v1`。发布后在前台、店长端和管理端执行强制刷新并清理旧 Service Worker/站点缓存；确认资源请求带 `?v=20261002-yue-backfill-v1`。

## 回退步骤

1. 停止 API 服务并暂停流量。
2. 恢复备份 JAR、前端目录和外部配置，保留本次日志与 Flyway 状态记录。
3. 启动原版本并确认 `/api/health` 恢复到原 release，再逐步恢复流量。
4. 不直接删除 V108 数据或手工回滚结构；如迁移失败，保留数据库备份并按 Flyway/数据库管理员流程处理。
