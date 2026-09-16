# 第二阶段 / 系统管理

范围：登录/会话、用户/角色/门店授权、功能权限过滤器、审计/告警、考勤、HTTP 错误处理。
后端路径前缀：`services/massage-api/src/main/java/com/chengxin/massage/`。

## 已核实保护

- 密码为带随机盐的 PBKDF2-HMAC-SHA256，令牌用安全随机数产生，数据库保存 SHA-256 摘要；不是明文密码或可预测 token。
- 管理权限在 AccessControlController.authorize 内要求 TENANT_ADMIN；停用用户时撤销其会话（`:207`）。跨店范围来自服务器授权表。
- 改角色/权限后每次请求重新查询权限，无长期 JWT 权限缓存。
- 审计成功记录与业务同事务，失败记录使用独立事务；敏感键递归脱敏。前端 localStorage 中令牌仍会放大 XSS 的影响。

## 问题

### R02 / P1：原始 URI 与 MVC 路径不一致

位置：`admin/BusinessPermissionFilter.java:26`、`:31`、`:143`。
权限为空即放行，匹配不是 Handler 驱动。第三阶段真实 HTTP 验证：有门店范围但无 MEMBER_MANAGE 的会话，普通会员创建路径 403，带矩阵参数路径 200 并持久化会员。不是所有接口都受影响，历史补单、审计、日报等具有 Controller 内重复权限检查。
建议统一规范化和默认拒绝策略，并在匹配后的 Handler 或业务服务执行权限校验。

### R09 / P2：改密不撤销其他会话

位置：`admin/AdminSessionService.java:120`；`mobile/MobileSessionService.java:40`。
找回/重置凭据时遗留登录态延续至到期。建议原子修改密码并撤销其他会话，当前会话换发新 token。登录入口也缺应用级失败节流，应结合代理已有策略再决定部署级风险，不凭代码推断公网暴露。

### R08 / P2：考勤状态依赖当前服务器时刻

位置：`operations/EmployeeAttendanceService.java:125`、`:137`。
历史考勤 GET 调用 synchronize 会写库；查看昨日未打卡记录时使用今天几点判迟到/缺勤。建议按目标营业日和门店时区计算，查询与每日归档分离；计划结束跨日必须采用完整日期时间。

### R14 / P2：异常响应和审计 IP 校验

位置：`audit/AuditService.java:56`、`:120`；`operations/EmployeeAttendanceService.java:52`。
任意 X-Forwarded-For 被直接送入 inet cast，非法值使审计插入失败并回滚业务；标准业务冲突又混用 IllegalStateException 和 ResponseStatusException。建议只信任指定代理并验证 IP，集中错误映射，日志保留 requestId 不输出凭据。

### R10 / P2：测试和构建可重复性

位置：`services/massage-api/pom.xml:5`；`apps/massage-console/tests/idempotency-duplicate-prevention-regression.test.js:222`。
项目要求 Java 21，环境默认 Java 17 导致基线首次启动失败；版本号测试写死某次发布。建议文档化 JDK、用稳定版本格式/契约验证替代旧版本字面量，并单独验证部署包与目标发布版本一致。

## 剩余验证

Session 撤销与并发写的时间窗口、所有敏感路由的权限矩阵、登录失败节流、异常审计输出、被停用门店、无门店用户、店长跨店授权撤销。生产代理、HTTPS、CSP、备份恢复和告警投递需要部署环境证据，本次代码报告不代替配置审计。
