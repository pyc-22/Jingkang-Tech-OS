# 第一批修复：资金安全与权限安全

版本：20260916-quality-batch1-v8。问题范围：R02/R03/R04/R05。

## 修复内容

- R02：使用 Spring 路径工具去除矩阵参数并解码；与 MVC 已注册路径交叉检查，未知路径返回 403；没有权限映射的注册 API 也默认拒绝。保留明确在 Controller 内鉴权的登录、技师及管理入口，意向加钟前台入口明确要求 FRONTDESK_SETTLE。
- R03：申请先锁原充值流水，再重新检查同请求键与累计有效申请金额；完成按原充值、退款、钱包锁顺序重新核对累计额度，旧超额申请不会继续扣钱包。取消申请后额度仍释放。
- R04：本金退款流水的余额为 before-本金，赠送流水再衔接最终余额。amount 是带符号金额，每行均满足 before+amount=after。
- R05：V95 新增 wallet_transaction.recharge_id。新本金行引用自身，赠送行明确引用该本金 ID；不再使用 2 秒时间窗口。旧行保持 NULL，不推断关联。申请和待完成的旧退款提示人工核对；已完成请求仍保持重放兼容。

关联核对必须以充值凭证与审计为依据，确认本金及所有赠送行后，在专门审批事务内建立关联；没有证据时不批量更新。此迁移不修改历史余额，也不自动修复旧的错误余额快照。

## 修改文件

- services/massage-api/src/main/java/com/chengxin/massage/admin/BusinessPermissionFilter.java
- services/massage-api/src/main/java/com/chengxin/massage/member/MemberController.java
- services/massage-api/src/main/java/com/chengxin/massage/member/MemberRechargeRefundController.java
- services/massage-api/src/main/resources/db/migration/V95__explicit_recharge_bonus_link.sql
- services/massage-api/src/test/java/com/chengxin/massage/admin/BusinessPermissionFilterTest.java
- tools/regression/quality-review.test.js
- services/massage-api/src/main/java/com/chengxin/massage/HomeController.java
- 本报告

## 验证

Java 21 下 npm test：前端 158 通过、后端 164 通过；前端尚保留第二批 R01 的 1 项 TODO。新数据库 HTTP 套件：22 通过，R02/R03/R04/R05 均已移除 TODO；第二批 R06/R15/R16 的 3 项 TODO 保留。既有维护脚本 18 项通过。

验证包括矩阵参数位于版本段/资源段、百分号编码、未知路径、授权用户正常访问、双会话并发退款、完成时历史超额保护、退款余额守恒、连续充值赠送隔离、旧充值无关联的明确提示。新建 PostgreSQL 实际执行全部迁移至 V95，健康检查 UP，包构建成功。

测试输出位于忽略目录 .artifacts/batch1-*.log。此批不宣称第二、三批缺陷已修复；未操作生产数据库。
