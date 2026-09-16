# 第三批修复：并发、报表和其他 P2

版本：20260916-quality-batch3-v10。范围：R07、R17、R08-R14，以及最终复查发现的 R01/R15 同类遗漏。

## 修复、位置与验证

Java 路径均以 services/massage-api/src/main/java/com/chengxin/massage/ 为根。

| 编号 | 修复与主要位置 | 对应验证 |
| --- | --- | --- |
| R07 / P1 | sales/MonthlyCommissionTierService.java:21、:28 增加事务级门店及技师/月 advisory lock；SalesOrderController 的结算、补单、作废、业务更正及 RefundController 的退款写入入口先取得同一门店锁 | 两个独立会话同时跨月阶梯，钟数快照依次递增，倍率分别为 10000/12000；完整结算及退款链仍通过 |
| R17 / P1 | operations/DailyOperatingReportController.java:271、:306 保存/发布同时检查 version 和非 PUBLISHED；冲突 409；daily-report.js 发送读取到的版本并提示刷新 | 数据库更新屏障制造竞争，结果恰好一个 200、一个 409；旧版本和已发布保存均被拦截；DOM 测试核对保存请求体、发布参数和冲突提示 |
| R08 / P2 | operations/EmployeeAttendanceService.java:141、:148 按查询日期、门店时区构造完整班次起止时刻；跨午夜结束时间进入次日 | 单元测试覆盖历史日期、未来日期、时区和跨夜班次；已有技师打卡同步真实接口测试继续通过 |
| R09 / P2 | admin/AdminSessionService.java:120 改密锁用户后重新验证会话、撤销其他令牌，保留当前令牌；管理端和手机登录读取用户时 FOR SHARE | 旧会话 401、当前会话仍有效、旧密码登录 401、新密码登录成功；静态复核用户锁先于会话修改的顺序 |
| R10 / P2 | pom.xml 的 coverage profile；tools/regression/run-quality-coverage.ps1 合并单元和真实 Java 服务的 JaCoCo 数据，低于 30% 退出失败 | 167 后端测试、38 个 PostgreSQL/HTTP/发布资源用例；覆盖 2771/6851 行，40.45%，未排除应用类以缩小分母 |
| R11 / P2 | catalog/RoomController.java:144、:157、:212、:221 在房间锁下同步床位；扩容新增，缩容停用闲置床位而非删除历史行；房间/床位停用检查占用；ServiceSessionController 避免重复生成足额床位 | 创建 2 床、扩容 3 床、有占用时缩容/停用 409、结束服务后缩容为 1 床并成功停用 |
| R12 / P2 | operations/DailyReportService.java:31 统一只读 REPEATABLE READ；DailyOperatingReportController 的视图/累计统计和 OperationsReportController 日报在同一快照内组装；报表写事务也使用该隔离级别 | 在首条支付聚合读取时暂停，由另一连接提交金额变化；当次总额/渠道均保持旧快照，下一次读取看到新金额 |
| R13 / P2 | catalog/ServiceItemVersionService.java:20、:33、:62 移除当前价格回退；缺失历史价格/提成规则版本明确返回 422，提示核对版本 | 将价格有效日期置于补单日期之后，真实补单接口 422，订单/服务/支付/提成/钱包数量均不变 |
| R14 / P2 | ApiExceptionHandler.java 统一资源不存在 404、数据/并发冲突 409、非法业务参数 422；考勤已知状态冲突显式 409；audit/AuditService.java:126 验证 IP 字面量，异常转发地址回退连接地址 | 缺失退款 404；重复/未上班下班 409；无效员工 422；坏 X-Forwarded-For 不回滚正常业务，审计地址为连接地址；IPv4/IPv6 单元测试 |

## 复查补充

- R01：daily-report.js 的门店、配置标签、渠道和修订人，以及 ledger.js 的客户、单号、备注补齐上下文转义；真实 DOM 用例检查恶意标签不产生元素/事件、文本原样呈现、记录按钮标识不变。只改变动态数据呈现，保留固定结构。
- R15：catalog/RoomStateService.java 排除已关联 SETTLED 订单的历史 COMPLETED 服务，避免已结算旧服务把换出后的房间重新推回 PENDING_PAYMENT；真实换房用例验证 CLEANING。
- R11/R16：ServiceSessionController、ServiceRoomTransferController 的旧房补床只用于完全没有床位记录的房间，不按自定义排序号补出额外床位；换房用例核对自定义排序床位数量保持 2。
- R16：V98__bed_requires_room.sql 补充有床位时房间必填的 CHECK，封住 MATCH SIMPLE 外键的 NULL 跳过行为；仍允许手工服务房间/床位均为空。真实接口/数据库用例覆盖两种边界。
- HomeController.java 发布标识更新；index.html、ledger.html 仅更新本批变化脚本的缓存版本。

## 策略与兼容性

- 历史补单按其营业日期选择历史价格/提成规则，按串行入账顺序取得该月当前钟数；不追溯重写已经结算的倍率快照。要按服务发生时间重排整月提成，需另行财务核对和重算流程。
- 门店级提成锁是保守串行入口，避免多技师订单及冲正反向锁顺序；同门店结算吞吐会受约束，应观察生产等待时间。不同门店互不等待此锁。
- 日报 version 为新增可选输入，旧客户端省略时用事务读取的当前版本参与条件更新；仍防止发布竞争，但旧客户端不具备完整的“用户读取版本”冲突检测。新前端始终传版本。
- 日报 version 列原本存在，无需新增；本批 V98 补充床位非空归属检查，前三批迁移为 V95-V98。所有改表通过 Flyway，未直接改生产库。
- 保留既有显式 400 参数验证协议；不把任意内部 IllegalStateException 一概改成业务错误。
- 缩容保留旧床位和历史服务引用；独立的床位管理入口仍保留原有操作语义，没有增加新的容量配置模式。

## 测试结果与复现

在 Java 21、Node 22+、PostgreSQL 16 下：

```powershell
$env:JAVA_HOME='C:/Program Files/Microsoft/jdk-21.0.12.101-hotspot'
$env:Path="$env:JAVA_HOME/bin;$env:Path"
npm test
& tools/regression/run-quality-coverage.ps1
node --test tools/maintenance/tests/clear-orders.test.js
```

- 前端：167/167；后端：167/167；真实接口及发布资源：38/38；维护脚本：18/18。无失败或 TODO。
- 在独立新建数据库上执行完整 Flyway 至 V98，床位复合约束和房间必填检查已 VALIDATED；健康检查 UP，release=v10。
- 后端行覆盖率 40.45%；前端采用运行时 DOM 和已有回归测试，没有把测试数量宣称为前端行覆盖率。
- 首次误用机器默认 JDK 17 的命令因字节码版本中止；显式 JDK 21 后完整重跑成功，该失败不计作业务通过证据。
- 输出：.artifacts/batch3-*.log、.artifacts/quality-coverage/summary.json 及 html/。

## 文件清单补充

除表格列出的生产文件，本批修改 EmployeeAttendanceServiceTest.java、新增 audit/AuditAddressTest.java；补充 tools/regression/quality-review.test.js、apps/massage-console/tests/xss-dom-regression.test.js 和 daily-report-settlement-sync-regression.test.js；新增覆盖率运行脚本、限定文件范围的发布打包脚本及本批/最终发布报告。

生产数据库未连接；本地巡检结果不代表生产数据已无异常。上线前的核对步骤见 release-quality-v10.md。
