# 技师端与店长端权限整改回滚指南

## 触发条件

出现登录异常、店长安排上钟失败、技师无法接单、房间状态不一致或既有日报/订单功能回归时，先停止继续派单并保留应用日志、浏览器网络记录和当前文件哈希。

## 回滚步骤

1. 停止当前应用服务，避免回滚期间产生新的业务写入。
2. 使用部署前备份恢复前端静态目录中的原始 HTML、JS、CSS 和 manifest 文件。
3. 恢复部署前的后端 JAR。若本版本未改动后端源码，不要执行数据库回滚或删除业务数据。
4. 恢复原外部配置、环境变量和服务启动参数，重新启动应用。
5. 检查健康端点、店长端和技师端登录页 HTTP 状态。
6. 通过前台完成一笔只读状态检查，确认房间、技师和待结算列表恢复；再按原生产回归清单验证接单、拒绝、休息、下钟、日报和订单管理。
7. 保留本版本 ZIP、备份目录、哈希和故障记录，待确认后再决定是否重新部署。

## 数据说明

本版本前端整改不包含数据库迁移。已提交或已产生的服务/预约记录属于业务数据，回滚代码不会自动删除或逆向这些记录；如需处理业务记录，必须沿用现有前台审核和审计流程。

## 快速恢复示例

```powershell
# 示例路径按实际部署目录替换
Stop-Service MASSAGE_SERVICE
Copy-Item BACKUP_DIR\apps\massage-console\* APP_STATIC_DIR -Recurse -Force
Copy-Item BACKUP_DIR\services\massage-api\target\massage-api-0.1.0.jar API_JAR_DIR -Force
Start-Service MASSAGE_SERVICE
```
