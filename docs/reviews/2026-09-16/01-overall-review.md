# 第一阶段：全量代码质量评审

评审基线：`797359f`，包含工作区已有的 `HomeController.RELEASE` 更新。日期：2026-09-16。

## 范围与方法

- 盘点 72 个后端 Java 源文件、前台/店长/技师 JavaScript、Android 容器、数据库迁移、构建入口与维护脚本；沿鉴权、结算、退款、钱包、派钟、补单、日报主链路阅读实现。
- 知识图谱工具本次未提供，使用文件清单、符号搜索、调用点及 SQL 交叉验证。
- “全量”指覆盖所有业务模块和共享基础设施，不表示逐行形式化证明，也不表示生产数据已经检查。Android 原生通知、真实设备、反向代理、支付渠道和生产配置未运行验证。
- 下表区分静态确认与待运行复现；后续阶段报告补充验证结果。没有读取远程数据库，没有修改业务代码或生产数据。

## 架构与依赖

```text
前台 app.js / 店长 manager-mobile.js / 技师 mobile.js
  -> Node 静态服务和 API 代理 / Spring 静态页面
  -> BusinessPermissionFilter / OfflineOperationIdempotencyFilter / AuditOutcomeFilter
  -> Controller（HTTP + 校验 + 编排 + SQL + 事务）
  -> JdbcClient -> PostgreSQL / Flyway
  -> AuditService -> 提交后告警
共享服务：StoreContextService、BusinessClockService、DailyReportService、
          ServiceItemVersionService、ServiceDurationPolicyService、TechnicianQueueService
Android：Capacitor 容器及技师通知服务，不是独立业务后端。
```

构建：Spring Boot 3.3.5、Java 21、PostgreSQL 16、Apache POI 5.2.5；前端使用 Node 内置测试运行器。
后端主订单 Controller 1166 行、日报 Controller 837 行；跨模块依赖主要通过同库 SQL 和共享服务，而非领域接口。`tenant_id` 在多个类中固定为同一个 UUID，因此当前是单租户多门店产品，不能把它当作已经具备多租户隔离的服务。

## 风险清单

P0：紧急，如无需登录即可取得管理权、确定的大规模资金损坏。当前未确认 P0。
P1：重要，可导致越权、重复资金操作、错误账务/提成。P2：一般，局部一致性、可用性或维护性问题。

路径均相对于仓库；`java/` 下文代表 `services/massage-api/src/main/java/com/chengxin/massage/`。

| ID | 级别 | 问题、触发条件与影响 | 代码位置 | 修复建议 / 证据状态 |
|---|---|---|---|---|
| R01 | P1 | 店长跨店流水把会员名、门店名、项目追踪等数据直接写入 innerHTML；会员姓名等字段可由业务接口写入。浏览器会把数据当成标记，且登录令牌保存在 localStorage。 | `apps/massage-console/manager-mobile.js:477`、`:568`；`member/MemberController.java:86` | 使用 textContent 或既有 managerEscape。运行时已确认标记原样进入 HTML，实际脚本执行还受部署 CSP 影响。 |
| R02 | P1 | 过滤器依据 getRequestURI 和字符串前缀，未知路由放行；MVC 把带矩阵参数的路径映射回原接口，导致只做门店校验的 Controller 丢失功能权限。 | `admin/BusinessPermissionFilter.java:26`、`:31`；`member/MemberController.java:86` | 使用 Handler 权限元数据，或统一规范化并默认拒绝。真实 HTTP 已确认：无会员写权限角色，普通路径 403、矩阵路径 200 并落库。 |
| R03 | P1 | 充值退款申请读原充值、汇总已申请金额后插入，未锁原充值。不同会话同时退款可各自通过额度检查，完成时只检查钱包总余额而非该笔充值额度。 | `member/MemberRechargeRefundController.java:66`、`:70`、`:89` | 同一事务锁原充值、重算额度并创建，完成时再次校验。双会话实测原充值 10000 分、各申请 8000 分，均成功。 |
| R04 | P1 | 有赠送回收的充值退款，主退款流水 amount 仅为本金，但 after 已扣本金和赠送，随后还记一条赠送流水，单条余额链不守恒。 | `member/MemberRechargeRefundController.java:99`、`:107` | 主退款 after=before-本金，赠送行衔接最终余额。真实退款确认钱包归零但主行算式错误；历史修复不直接改钱包余额。 |
| R05 | P1 | 以同会员同店 2 秒内的 BONUS 流水猜测某次充值赠送额；连续充值可能把后一笔赠送算到前一笔，退款回收错误。 | `member/MemberRechargeRefundController.java:66` | 明确充值操作 ID 关联本金/赠送；历史歧义人工核对。接口实测第一笔无赠送，仍回收第二笔赠送 2000 分。 |
| R06 | P1 | 业务事务提交后才把回执标 APPLIED；进程在两次提交间退出会留下永久 PROCESSING。回执仅绑定方法和路径，未绑定用户、门店、请求体；相同 ID 的不同充值金额会被当作重放。 | `admin/OfflineOperationIdempotencyFilter.java:49`、`:65`、`:80`；`db/migration/V54__offline_operation_receipts.sql` | 业务与回执同事务，绑定主体/门店/请求摘要，恢复先查业务结果。实测不同金额同键返回 204；进程崩溃窗口仍为静态证据。 |
| R07 | P1 | 月阶梯先汇总钟数再写提成，没有按技师/月串行化；不同订单同时跨阶梯时可能读取同一个旧钟数，固化错误倍率。 | `sales/MonthlyCommissionTierService.java:29`；`sales/SalesOrderController.java:742` | 在写钟数前锁技师/月计数行或事务级 advisory lock，明确补单的重算策略；补双会话阈值用例。静态交错分析，未声称生产已发生。 |
| R08 | P2 | 考勤历史日期的缺勤/迟到计算使用服务器当前 LocalTime，而不是被查询日期和门店时区；查询同一天历史考勤会随当前时刻改变状态。 | `operations/EmployeeAttendanceService.java:125`、`:137` | 注入 Clock，以门店时区构造完整计划时间；过去/未来营业日分别处理，覆盖跨日班次。静态确认。 |
| R09 | P2 | 自助改密更新密码后不撤销其他登录会话，旧令牌在有效期内继续使用；技师令牌最长 30 天。 | `admin/AdminSessionService.java:120`；`mobile/MobileSessionService.java:40` | 改密后撤销其他会话或旋转当前令牌；鉴权补 active/tenant 防御性检查。管理员停用账号已有撤销逻辑，不把它误报成完全缺失。 |
| R10 | P2 | 大量测试只断言源码包含文本，不能证明事务、真实外键、HTTP 鉴权和竞争行为；未配置覆盖率门槛。版本号字面量测试已在当前工作区失效。 | `services/massage-api/pom.xml:16`；`apps/massage-console/tests/idempotency-duplicate-prevention-regression.test.js:222` | 补运行时测试与 PostgreSQL 集成测试，测量行/分支覆盖，不把测试数量当覆盖率。 |
| R11 | P2 | 修改房间 bed_count 不同步 room_bed，停用房间/床位也未检查正在进行的服务，配置与现有占用可不一致。 | `catalog/RoomController.java:153`、`:165`、`:199` | 房间行锁下校验占用和容量；缩容/停用应拒绝有占用床位，明确床位数单一事实来源。静态确认。 |
| R12 | P2 | 同一份日报由多条独立 SELECT 组装，没有统一快照；并发退款/结算时总额和渠道可以来自不同提交。月报再逐日重复这些查询。 | `operations/DailyReportService.java:27`、`:73`；`operations/DailyOperatingReportController.java:448` | 报表入口使用只读 REPEATABLE READ 或单条聚合 SQL；批量按日聚合并检查执行计划。静态确认。 |
| R13 | P2 | 历史补单取当前 active 技师/项目；无历史价格版本时回退当前价格，佣金版本则直接 single()。早期日期可能出现不一致回退或 500，历史已离职人员也被排除。 | `catalog/ServiceItemVersionService.java:20`、`:32`、`:42`；`sales/SalesOrderController.java:266`、`:358` | 明确历史可用性策略；缺少历史价格/规则应给可操作的 4xx，而非静默当前价/数据库异常。 |
| R14 | P2 | 业务层把不存在资源用 single()、业务冲突用 IllegalStateException 抛出，缺少全局异常映射；审计直接把 X-Forwarded-For 强转 inet，坏格式可能使整个业务回滚。 | `member/MemberRechargeRefundController.java:95`；`operations/EmployeeAttendanceService.java:52`；`audit/AuditService.java:120`、`:56` | 统一 404/409/422 映射；只信任代理设置的合法地址，异常 IP 回退连接地址并保留原串为文本。 |
| R15 | P1 | 手机端下钟把房间直接标为 PENDING_PAYMENT，即使同房另一个服务仍在上钟；前台端有聚合校验，手机端没有。 | `mobile/TechnicianMobileController.java:287`、`:519`；`catalog/ServiceSessionController.java:642` | 共用房态计算与同一房间行锁，优先保留 IN_SERVICE/RESERVED。真实手机接口已复现。 |
| R16 | P1 | 换房审批仅改 room_id，bed_id 仍引用旧房间；FK 只保证床存在，不保证床属于新房间，旧床继续被占用。 | `catalog/ServiceRoomTransferController.java:96`；`db/migration/V75__room_bed_occupancy.sql:1` | 审批时锁目标床、同时更新 room_id/bed_id，并按旧房剩余服务重算房态；补复合约束和巡检。真实申请/审批接口已复现。 |
| R17 | P1 | 日报更新先读状态后无条件写 SAVED；另一个会话在中间发布，旧保存仍覆盖 PUBLISHED，破坏发布锁定规则。 | `operations/DailyOperatingReportController.java:276`、`:293`、`:312` | 使用 version 和 status 条件更新或行锁，冲突返回 409；保存/发布共享锁顺序。 |

## 已确认的防护与排除项

- 抽查查询、搜索、金额及 UUID 过滤使用 JdbcClient 命名参数；动态 SQL 片段主要由固定分支生成。本次没有证实可利用的 SQL 注入，不将字符串拼接一概判为注入。
- StoreContextService 会检查用户门店范围；历史补单还在 Controller 内做功能权限和逐门店授权，不能仅凭过滤器路径问题断言它被越权。
- 普通订单退款锁订单；钱包消费/充值/退款锁钱包；服务状态更新存在行锁和 version 条件。并非“系统没有事务”，风险来自跨路径锁粒度不一致。
- AuditService 成功审计要求当前事务，失败审计单独事务；敏感 JSON 键做脱敏。应用配置数据库密码来自环境变量。
- 已跟踪文件的密钥模式扫描未确认生产明文凭据。示例种子、打包产物、未跟踪运维文件和历史 Git 对象不在这一结论内；报告不复制任何凭据。
- 依赖版本已盘点，但没有把未做公告比对的旧版本直接标成某个 CVE；建议单独做 SCA/SBOM 和部署面版本验证。

## 基线验证

- 前端：157 项，156 通过，1 项因工作区版本号与测试字面量不同失败。
- 默认 Java 17 下后端测试启动失败；切换 Java 21 后 clean test：153 项全部通过。
- 基线 JaCoCo：行 7.81%、分支 10.56%；新增测试后行 7.98%、分支 10.95%，仅计 Maven 测试。前端空文件覆盖报告不具备计量意义。
- 本阶段没有自动修复上述业务风险。优先处理 R01-R06，随后处理提成并发和报表快照。

## 最终证据索引

共 17 项主问题：10 项 P1、7 项 P2。R01/R02/R03/R04/R05/R06/R15/R16 有运行时复现；R06 的崩溃窗口、R07/R17 并发及其他问题的运行时覆盖边界，见 [第三阶段](03-tests-and-coverage.md)。[第四阶段](04-production-inspection.md) 给出只读巡检脚本、实测结果和生产填写模板；远程生产数据尚待用户执行。
