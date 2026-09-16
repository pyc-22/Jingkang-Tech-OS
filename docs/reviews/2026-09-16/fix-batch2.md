# 第二批修复：业务一致性与安全

版本：20260916-quality-batch2-v9。范围：R15、R16、R01、R06。

## 修复及文件

| 问题 | 修复 | 主要文件 |
| --- | --- | --- |
| R15 | 前台、手机和换房共用房态聚合；锁房间后检查在服、待接单和未结算服务；有在服服务时保持 IN_SERVICE | catalog/RoomStateService.java、ServiceSessionController.java、mobile/TechnicianMobileController.java |
| R16 | 审批按固定顺序锁两间房，选择并锁定目标空床，同步修改 room_id/bed_id，释放旧床引用并重算旧房状态 | catalog/ServiceRoomTransferController.java、V96__service_bed_room_ownership.sql |
| R01 | 沿用现有 HTML 转义函数保护名称、备注、追踪文本和属性；补齐派生文本，保留受控结构和按钮；刷新脚本和手机离线缓存版本 | apps/massage-console/app.js、manager-mobile.js、mobile.js、对应 HTML、technician-service-worker.js |
| R06 | 原子事务覆盖回执占位、业务操作和 APPLIED；提交前缓存响应；绑定已认证用户、已校验门店、规范路径、查询串、方法、原始请求体 SHA-256；内容或身份不一致返回 409 | admin/OfflineOperationIdempotencyFilter.java、V97__atomic_bound_offline_receipts.sql |

Java 主文件位于 services/massage-api/src/main/java/com/chengxin/massage/；迁移位于 src/main/resources/db/migration/。

其他修改：HomeController 发布标识；package.json/package-lock.json 添加测试依赖 acorn/jsdom；前端现有源码断言适配转义和版本号；quality-review-rendering.test.js 移除 R01 TODO；新增 xss-dom-regression.test.js；后端 P0ConflictRegressionTest、TechnicianMobileControllerTest 适配共用房态服务；tools/regression/quality-review.test.js 增加真实数据库回归并移除本批 TODO。

## 数据兼容与恢复

- V96 新复合外键核对床位、房间、门店和租户。干净库验证成功；历史错配存在时保持 NOT VALID，但约束仍检查新写入。需依巡检和实际服务凭证核对旧记录，再执行 VALIDATE CONSTRAINT，不猜测替换床位。
- V97 将旧 PROCESSING 标记 REVIEW_REQUIRED。旧回执缺少身份和摘要时返回 409，需核对原业务结果后处理；不自动删除回执。新版本异常或进程中断由数据库事务回滚，成功回执与业务同时提交。
- 摘要基于请求体原始字节。客户端重放应保留原始内容；同样语义但字节不同的请求返回 409。
- 房间转移仍遵循原有目标房空闲/本申请预留规则，没有扩大可转移范围。

## 验证结果

- Java 21 下 npm test：前端 164 项、后端 164 项全部通过，均无 TODO。
- 干净 PostgreSQL 16 + 实际 API：27 项通过，无 TODO；完整 Flyway 迁移至 V97；健康检查 UP；JAR 构建成功。
- 维护脚本回归：18 项通过，包括对全部仓库迁移后的删除计划检查。
- R15：同房两技师在服，手机下钟一人后仍为 IN_SERVICE。
- R16：新床属于新房，旧床无占用，旧房另一个服务仍在服，尝试重新写入错配床位被数据库拒绝。
- R01：jsdom 执行真实渲染函数；script/img/事件属性不进入 DOM，恶意文本完整显示，按钮数据与点击行为保留；打印预览不重复转义。
- R06：同键同内容 204、不同内容/用户/门店 409；并发重复一次入账；模拟回执 APPLIED 写入失败，余额、流水和回执共同回滚，随后重试成功；旧回执不重复扣款。

测试输出在忽略目录 .artifacts/batch2-*.log。仅验证本地新库，未连接生产库。第三批问题尚待修复。
