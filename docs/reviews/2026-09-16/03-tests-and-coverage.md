# 第三阶段：测试覆盖检查与补充

## 实测结论

本阶段交付测试与缺陷证据，没有修复业务实现。测试结果区分正常回归和 TODO 缺陷复现，后者不是通过项。

| 测试集 | 基线 | 本次结果 | 范围 |
|---|---|---|---|
| 后端 JUnit/Mockito/MockMvc | 153 通过 | 162 通过，0 失败 | 新增 9 项运行时单元测试 |
| 前端 Node | 156 通过，1 失败 | 158 通过，0 普通失败，1 TODO 失败 | 修复过时版本号断言；新增 2 项运行时渲染测试 |
| 新增 HTTP + PostgreSQL | 原无本套件 | 16 通过，0 普通失败，7 TODO 失败 | 启动真实应用，自动迁移新建 PostgreSQL 数据库 |
| 既有订单清理脚本回归 | 本阶段复跑 | 18 通过 | 保留旧任务的删除范围与回滚保护 |
| Maven package | Java 17 启动失败 | Java 21 构建成功 | 不提交生成的 jar、日志、临时库 |

TODO 用例执行了真实断言，不是跳过测试。Node 将它们单独统计，命令退出码可以为 0，**这不表示业务缺陷消失**。修复对应问题时，应移除 TODO 并让原断言通过；新增其他原因的错误也要检查具体输出，不能只依赖退出码。

## 覆盖率

使用 JaCoCo 0.8.12 的 prepare-agent + test + report；最终执行前 clean 清除旧数据。分母包含编译后的业务类及 record，不包括测试类。

| 指标 | 基线覆盖/总数 | 基线比例 | 补充后覆盖/总数 | 补充后比例 |
|---|---|---|---|---|
| 行 | 526 / 6731 | 7.81% | 537 / 6731 | 7.98% |
| 分支 | 333 / 3152 | 10.56% | 345 / 3152 | 10.95% |
| 方法 | 139 / 1563 | 8.89% | 148 / 1563 | 9.47% |
| 类 | 44 / 510 | 8.63% | 45 / 510 | 8.82% |

这些数值仅包含 Maven 测试；独立 Java 进程的 HTTP 集成测试没有并入 JaCoCo，不能把它们称为系统整体覆盖率。
在 Maven 报告中，RefundController、MemberController、AccessControlController、ServiceRoomTransferController 等核心实现仍为零行覆盖；前三个会员/退款/换房路径已由独立接口套件执行，但不改变上述计量口径。

前端运行 `node --test --experimental-test-coverage` 得到空文件清单和 `all files 100%`。现有测试大量使用读源文本/VM 片段，V8 没有记录真实业务文件；该百分比没有覆盖证明意义，本报告不将它作为前端覆盖率。后续应把纯计算模块直接导入测试，并用浏览器端 V8 覆盖率覆盖 DOM、导航和离线交互。

原始输出留在忽略目录 `.artifacts/quality-review-*-final.log`；JaCoCo HTML/XML 在 `services/massage-api/target/site/jacoco/`，均不提交。

## 新增测试与验证目标

### 单元测试

- `services/massage-api/src/test/java/com/chengxin/massage/operations/DailyReportArithmeticTest.java`：订单/储值现金流分离、退款日负净额、不可变渠道更新、会员余额渠道、零值/大值和负输入，共 6 项。
- `services/massage-api/src/test/java/com/chengxin/massage/operations/BusinessClockServiceTest.java`：跨年、闰年边界、午夜截点、夏令时重复小时，共新增 3 项。
- `apps/massage-console/tests/quality-review-rendering.test.js`：运行真实渲染函数，验证空态/普通行及 HTML 数据编码；后者复现 R01。没有浏览器脚本执行或 CSP 验证。
- `apps/massage-console/tests/idempotency-duplicate-prevention-regression.test.js:222`：健康接口暴露 RELEASE 的稳定契约与格式，替代对旧发布值的硬编码。用户已有 HomeController 修改保持原状；此项不替代发布包版本验收。

### HTTP 与数据库集成

入口：`tools/regression/quality-review.test.js`。

1. 自动创建随机本地端口的新 PostgreSQL 集群和数据库，只绑定 127.0.0.1，覆盖继承的数据库环境变量；自动运行 93 个 Flyway 迁移至 V94。
2. 临时账号密码运行时随机生成，使用实际密码哈希和登录接口；分别创建管理员、收银员、无业务权限角色、技师会话。
3. 检查未登录拒绝、普通路径权限拒绝、跨门店访问拒绝。
4. 检查开卡本金/赠送的余额和流水、零值充值拒绝、重复会员拒绝、退款额度、取消释放额度、重复完成不重复扣款。
5. 检查补单未来日期、二次确认、收银角色权限；成功时服务归属/提成/支付/审计齐全；无效支付方式在后续写入阶段失败、余额不足时，订单/明细/服务/提成/支付/流水计数全部回滚。
6. 检查同键同内容充值一次、技师重复打卡只产生一条记录且同步员工考勤。
7. 串联派钟、手机接单、手机上钟、前台加钟、预期结束时间、手机下钟、结算、重复结算、整单退款、重复退款申请/完成、提成抵销；同时验证技师直接加钟仍返回 403。
8. 巡检 SQL 空基线、注入异常识别、跨店共享钱包、不合法日期退出，共 4 项独立验证。

测试结束停止自己启动的 Java 与 PostgreSQL；临时数据和应用日志保留于忽略目录用于定位。该套件不连接现有数据库，也不接受生产数据库 URL。

## 实测缺陷证据

| ID | 正确行为 | 实际结果 | 证据级别 |
|---|---|---|---|
| R01 | 姓名标记输出为文本 | 标记原样写进 innerHTML | 运行时渲染，未做浏览器执行验证 |
| R02 | 相同 Controller 路径变体保持权限校验 | 无 MEMBER_MANAGE 的角色，普通路径 403，带矩阵参数路径 200 并创建会员 | 真实 HTTP/持久化，候选升级为确认 |
| R03 | 原充值 10000 分，两会话各申请 8000 分，至少一笔冲突 | 两笔均 200，累计预约退款 16000 分 | 真实并发；仅测试库在插入前加 1 秒屏障放大交错 |
| R04 | 每条退款流水 before + amount = after | 退本金 10000、赠送 2000 后，钱包正确归零，但一条主退款流水不守恒 | 真实 HTTP/数据库 |
| R05 | 第一笔无赠送充值退款回收赠送为 0 | 一秒后第二笔充值赠送 2000，被第一笔退款计入 | 真实 HTTP；时间戳使用确定性夹具 |
| R06 | 同键不同金额返回冲突 | 第二次金额从 100 改为 900，返回 204 重放 | 真实 HTTP；未做进程崩溃窗口复现 |
| R15 | 同房另一个服务在服，房态仍在服 | 另一服务 IN_SERVICE，最新房态 PENDING_PAYMENT | 真实手机接口 + 两床夹具 |
| R16 | 换房同步新房床位 | 审批成功，服务房间与床位所属房间不一致 | 真实申请/审批接口 |

## 尚缺的关键场景

| 模块 | 本次补充 | 仍需补充 |
|---|---|---|
| 前台 | 派钟至全额退款主链路、重复结算、换房缺陷 | 最后一床双派竞争、加钟/下钟竞争、混合渠道逐笔退款、财务/业务更正 |
| 技师 | 接单、上/下钟、计时一致性、重复打卡同步 | 接单超时竞争、离线恢复、真实设备通知、跨日排班 |
| 店长 | 日报金额计算单元测试、渲染测试 | 日报保存/发布竞争 R17、报表快照 R12、阶梯阈值竞争 R07 |
| 补单 | 权限/日期/确认/成功归属/失败回滚 | 店长逐店授权撤销、多技师比例边界、缺失历史版本 |
| 会员 | 充值/赠送/退款/并发额度/幂等 | 混合支付原路回退、部分充值退款余数分摊、归档恢复竞争 |
| 基础 | 派钟项目/床位关联与换房 | 缩容/停用在服床、最后可用技师竞争、价格生效边界 |
| 管理 | 普通路径权限、跨店、角色路径变体 | 全路由权限矩阵、改密撤销、异常审计地址、生产代理/CSP |

## 复跑命令

在仓库根目录 PowerShell 执行，准备 Node >=22、PostgreSQL 16（默认安装目录），JAVA_HOME 指向实际 JDK 21。

```powershell
$env:JAVA_HOME='C:/Program Files/Microsoft/jdk-21.0.12.101-hotspot'
$env:Path="$env:JAVA_HOME/bin;$env:Path"
npm test
& services/massage-api/mvnw.cmd -f services/massage-api/pom.xml clean org.jacoco:jacoco-maven-plugin:0.8.12:prepare-agent test org.jacoco:jacoco-maven-plugin:0.8.12:report package '-DskipTests=false'
node --test --test-reporter=tap tools/regression/quality-review.test.js
node --test tools/maintenance/tests/clear-orders.test.js
```

脚本沿用本项目 Windows Java 的短 Unix socket 临时路径 `C:/tmp/jdsock`，避免本机长临时目录导致 Tomcat 启动失败。PG_BIN 可指向其他 PostgreSQL 16 bin 目录。前端当前是源码/VM 测试，没有单独打包构建流程。

## 覆盖提升建议

先将本次 8 个 TODO 对应缺陷修复并转为常规回归，再补全资金/权限/状态机的分支矩阵。引入差异覆盖率门槛，禁止新增资金和鉴权分支无运行时测试；不要把全项目低基线直接设为虚假的高门槛，也不要把读源码测试作为业务覆盖。后续通过相同 JaCoCo agent 收集独立接口进程数据，分别展示单元和合并覆盖率。
