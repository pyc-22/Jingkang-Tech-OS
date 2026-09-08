# 靖康按摩门店运营平台功能清单

> 扫描范围：权威 Web 前端、Java API、数据库迁移、部署模板及 Android 工程。本文描述当前源码入口；运行和测试状态以 [测试文档](testing.md) 及最近验证结果为准。

## 前台结算与订单工作台
### 房间和技师实时工作台
- 功能描述：展示房间状态、可用房间筛选、在岗/可派/服务中技师数量和轮钟队列，支持手动刷新及运营状态同步。
- 入口位置（页面/接口）：`apps/massage-console/index.html` 的“结算单”页；`GET /api/v1/foundation/rooms`、`GET /api/v1/rooms/statuses`、`GET /api/v1/foundation/technicians`、`GET /api/v1/technician-queue`、`GET /api/v1/technician-queue/events`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`styles.css`；`catalog/FoundationController.java`、`catalog/RoomController.java`、`catalog/TechnicianQueueController.java`。
- 依赖的其他功能：门店权限与会话、房间/床位资料、技师启用和队列状态、服务会话。

### 新建订单、会员/散客选择和服务项目明细
- 功能描述：创建当前订单，选择会员或散客，添加/删除服务项目，关联房间、技师和时长，支持搜索项目及待结算服务。
- 入口位置（页面/接口）：结算单页“当前订单/添加服务项目/选择会员”；`GET /api/v1/sales-orders/pending-service-sessions`、`GET /api/v1/members`、`GET /api/v1/foundation/service-items`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`frontdesk-pending-settlement.css`、`member-center.css`；`sales/SalesOrderController.java`、`member/MemberController.java`、`catalog/FoundationController.java`。
- 依赖的其他功能：服务会话状态、会员钱包、服务项目价格版本、房间占用。

### 单房/合并结算和混合支付
- 功能描述：按房间勾选待结算服务（默认不选中，可全选本房），合并多个房间结算；按现金统计标识拆分支付渠道，支持会员余额、现金、免单及混合支付。
- 入口位置（页面/接口）：结算单抽屉和“单房结算/合并结算”对话框；`POST /api/v1/sales-orders/settle`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`frontdesk-card-settlement.css`；`sales/SalesOrderController.java`、`sales/StorePaymentMethodController.java`、`member/MemberController.java`。
- 依赖的其他功能：支付方式配置、会员余额扣款、营业日计算、提成锁定、房间待付款状态。

### 订单查询、详情和待结算刷新
- 功能描述：按日期/状态分页查询订单，查看订单行、支付、服务、退款及更正历史；刷新待结算服务队列。
- 入口位置（页面/接口）：结算单订单列表、订单详情抽屉；`GET /api/v1/sales-orders`、`GET /api/v1/sales-orders/{id}`、`GET /api/v1/sales-orders/{id}/business-corrections`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`；`sales/SalesOrderController.java`、`sales/RefundController.java`。
- 依赖的其他功能：订单结算、退款、业务更正、审计记录。

## 派钟、服务会话与房间运营
### 前台排钟、点钟和预约派单
- 功能描述：从技师队列选择排钟/点钟技师及项目，设置服务房间和计划时长；预约单进入等待队列后可手动派单。
- 入口位置（页面/接口）：结算单“安排服务”派钟工作台；`POST /api/v1/service-sessions/clock-in`、`GET/POST /api/v1/service-reservations`、`POST /api/v1/service-reservations/{id}/dispatch`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`frontdesk-card-settlement.css`；`catalog/ServiceSessionController.java`、`catalog/ServiceReservationController.java`、`catalog/TechnicianScheduleController.java`。
- 依赖的其他功能：技师排班/上钟资格、服务项目计钟规则、房间状态、技师队列启用状态。

### 技师接单、开始服务和下钟
- 功能描述：技师端确认或拒绝派单，开始服务时锁定实际开始时间，服务结束后下钟；前台可查看全部服务会话状态。
- 入口位置（页面/接口）：前台服务记录、技师手机端当前服务；`GET/POST /api/v1/service-sessions`、`POST /api/v1/service-sessions/{id}/start-service`、`POST /api/v1/service-sessions/{id}/clock-out`、`GET /api/v1/mobile/technician/dispatch-notification`、`POST /api/v1/mobile/technician/dispatch-notification/confirm`、`POST /api/v1/mobile/technician/dispatch-notification/reject`。
- 涉及文件：`apps/massage-console/app.js`、`mobile.html`、`mobile.js`；`catalog/ServiceSessionController.java`、`mobile/TechnicianMobileController.java`。
- 依赖的其他功能：移动端会话、派单超时任务、房间占用、提成版本锁定。

### 派单转派、取消和参与技师
- 功能描述：记录派单事件，处理技师拒单后的转派/取消，支持多技师参与同一服务并转移参与人。
- 入口位置（页面/接口）：前台派钟详情和转派对话框；`GET /api/v1/service-sessions/{sessionId}/dispatch-events`、`POST /api/v1/service-sessions/{sessionId}/reassign`、`POST /api/v1/service-sessions/{sessionId}/cancel-dispatch`、`GET/POST /api/v1/service-sessions/{sessionId}/participants`、`POST /api/v1/service-sessions/{sessionId}/participants/transfer`、`GET /api/v1/service-transfer-requests`、`POST /api/v1/service-transfer-requests/{requestId}/approve`、`POST /api/v1/service-transfer-requests/{requestId}/reject`。
- 涉及文件：`apps/massage-console/app.js`、`mobile.js`；`catalog/ServiceDispatchController.java`、`ServiceParticipantController.java`、`ServiceTransferController.java`。
- 依赖的其他功能：技师移动端通知、队列事件、服务状态机、审计。

### 服务时长策略、调整和变更历史
- 功能描述：维护默认服务时长策略，前台可覆盖单次服务时长，查看时长调整记录。
- 入口位置（页面/接口）：前台服务详情/项目设置；`GET/PUT /api/v1/service-duration-policy`、`PUT /api/v1/service-sessions/{sessionId}/duration`、`GET /api/v1/service-sessions/{sessionId}/duration-changes`。
- 涉及文件：`apps/massage-console/app.js`、`index.html`；`catalog/ServiceDurationController.java`、`catalog/ServiceSessionChangeHistoryController.java`。
- 依赖的其他功能：服务会话、服务项目默认时长、审计和营业日报钟数。

### 加钟意向、加钟服务和取消
- 功能描述：技师提交加钟意向，前台查看待联系意向并标记已联系/拒绝；前台或技师发起加钟，支持查询和取消加钟记录。
- 入口位置（页面/接口）：前台“待处理加钟”、技师端“预约服务/加钟”；`POST/GET /api/v1/service-extension-intents`、`GET /api/v1/service-extension-intents/mine`、`PUT /api/v1/service-extension-intents/{id}/contacted`、`PUT /api/v1/service-extension-intents/{id}/reject`、`POST /api/v1/service-sessions/{sessionId}/extensions`、`GET /api/v1/service-sessions/{sessionId}/extensions`、`POST /api/v1/service-sessions/{sessionId}/extensions/{extensionId}/cancel`、`GET /api/v1/mobile/technician/extension-options`、`POST /api/v1/mobile/technician/extensions`。
- 涉及文件：`apps/massage-console/app.js`、`mobile.js`、`mobile-extension.css`；`catalog/ServiceExtensionIntentController.java`、`ServiceSessionExtensionController.java`、`ServiceSessionExtensionCancellationController.java`、`mobile/TechnicianMobileController.java`。
- 依赖的其他功能：服务项目加钟标识、服务会话、技师提成规则、移动端登录。

### 更换服务项目和服务记录追溯
- 功能描述：服务开始前或按权限更换服务项目，记录更改原因、原值和新值，支持查询完整变更历史。
- 入口位置（页面/接口）：前台服务详情“更改项目/变更历史”；`PUT /api/v1/service-sessions/{sessionId}/service-item`、`GET /api/v1/service-sessions/{sessionId}/change-history`、`GET /api/v1/service-change-history`、`GET /api/v1/service-change-history/export`。
- 涉及文件：`apps/massage-console/app.js`、`index.html`；`catalog/ServiceSessionItemChangeController.java`、`ServiceSessionChangeHistoryController.java`、`ServiceChangeHistoryQueryController.java`。
- 依赖的其他功能：服务项目版本、订单行、审计导出。

### 服务中换房和房间转移审批
- 功能描述：技师申请将服务转移到其他房间，前台审批或驳回，保留转移原因和状态；支持技师端查询自己的转房记录。
- 入口位置（页面/接口）：前台房间/服务详情、技师手机端“换房”；`POST /api/v1/mobile/technician/service-room-transfers`、`POST/GET /api/v1/service-room-transfers`、`POST /api/v1/service-room-transfers/{id}/approve`、`POST /api/v1/service-room-transfers/{id}/reject`、`GET /api/v1/mobile/technician/service-room-transfers`。
- 涉及文件：`apps/massage-console/app.js`、`mobile.js`；`catalog/ServiceRoomTransferController.java`。
- 依赖的其他功能：房间占用、服务会话状态、移动端会话、审计。

### 房间状态、清洁和待付款确认
- 功能描述：维护房间空闲/预留/服务中/待付款/清洁中状态，完成清洁、确认付款并记录房间状态事件；支持房间和床位增删改及启用停用。
- 入口位置（页面/接口）：前台房间状态卡片、房间与床位管理页；`GET /api/v1/rooms`、`GET /api/v1/rooms/beds`、`GET /api/v1/rooms/statuses`、`POST /api/v1/rooms/{roomId}/status`、`POST /api/v1/rooms/{roomId}/complete-cleaning`、`POST /api/v1/rooms/{roomId}/confirm-payment`、`POST/PUT /api/v1/rooms`、`PUT /api/v1/rooms/{id}/active`、`POST /api/v1/rooms/{roomId}/beds`、`PUT /api/v1/rooms/beds/{id}`、`PUT /api/v1/rooms/beds/{id}/active`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`frontdesk-cleaning.css`、`room-payment.css`；`catalog/RoomController.java`、`catalog/FoundationController.java`。
- 依赖的其他功能：服务会话、订单结算、清洁流程、房间/床位数据迁移。

## 员工、技师、排班与考勤
### 员工档案和门店任职信息
- 功能描述：新增/编辑员工基本资料、岗位、员工号、入职日期、备注及门店任职状态；支持离职员工查看和状态变更。
- 入口位置（页面/接口）：员工管理“员工档案”；`GET/POST /api/v1/employees`、`PUT /api/v1/employees/{employeeId}`、`PUT /api/v1/employees/assignments/{assignmentId}`、`PUT /api/v1/employees/assignments/{assignmentId}/employment-status`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`；`catalog/EmployeeController.java`。
- 依赖的其他功能：门店权限、技师档案、账号关联、考勤。

### 技师档案、启用状态和轮钟队列
- 功能描述：维护技师编号、姓名、手机号和轮钟顺序；分别控制技师业务启用状态及是否显示在前台技师队列，可调整队列顺序。
- 入口位置（页面/接口）：员工管理“技师档案”；`GET/POST /api/v1/foundation/technicians`、`PUT /api/v1/foundation/technicians/{id}`、`PUT /api/v1/foundation/technicians/{id}/active`、`PUT /api/v1/foundation/technicians/{id}/queue-enabled`、`PUT /api/v1/foundation/technicians/order`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`technician-accounts.css`；`catalog/FoundationController.java`。
- 依赖的其他功能：前台技师队列、排班资格、技师账号、提成统计。

### 排班、请假和上钟资格
- 功能描述：按营业日创建/编辑/取消技师班次，提交和审批请假申请，计算当日可上钟资格。
- 入口位置（页面/接口）：员工管理“排班请假”；`GET /api/v1/technician-schedules/clock-eligibility`、`GET/POST /api/v1/technician-schedules`、`PUT /api/v1/technician-schedules/{id}`、`PUT /api/v1/technician-schedules/{id}/cancel`、`GET/POST /api/v1/technician-schedules/leave-requests`、`PUT /api/v1/technician-schedules/leave-requests/{id}/status`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`mobile.js`；`catalog/TechnicianScheduleController.java`、`mobile/TechnicianMobileController.java`。
- 依赖的其他功能：营业日边界、技师队列、服务派单、员工状态。

### 员工考勤和自动扫描
- 功能描述：查询员工每日考勤，普通员工支持人工上下班打卡，技师按排班自动计算迟到/早退/旷工。
- 入口位置（页面/接口）：员工管理“考勤”；`GET /api/v1/employee-attendance`、`POST /api/v1/employee-attendance/clock-in`、`POST /api/v1/employee-attendance/clock-out`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`；`operations/EmployeeAttendanceController.java`、`operations/EmployeeAttendanceService.java`。
- 依赖的其他功能：员工档案、排班请假、Spring 定时任务。

### 员工账号关联和技师手机账号
- 功能描述：将员工档案关联管理账号，创建/停用技师手机端账号及重置密码，停用时使现有会话失效。
- 入口位置（页面/接口）：员工管理“账号权限/技师手机端账号”；`GET /api/v1/employees/account-options`、`PUT /api/v1/employees/{employeeId}/account`、`GET/POST /api/v1/admin/technician-accounts`、`PUT /api/v1/admin/technician-accounts/{id}/password`、`PUT /api/v1/admin/technician-accounts/{id}/active`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`technician-accounts.css`；`catalog/EmployeeController.java`、`mobile/TechnicianAccountAdminController.java`、`mobile/MobileSessionService.java`。
- 依赖的其他功能：管理端/技师端认证、角色权限、技师档案。

## 服务项目、分类、价格与时长
### 服务项目和价格版本
- 功能描述：新增/编辑/停用服务项目，设置分类、默认时长、价格、是否需要房间、是否允许加钟、是否计入钟数；按营业日维护价格版本并查看历史。
- 入口位置（页面/接口）：项目管理页及项目编辑对话框；`GET/POST /api/v1/foundation/service-items`、`PUT /api/v1/foundation/service-items/{id}`、`PUT /api/v1/foundation/service-items/{id}/active`、`GET /api/v1/foundation/service-items/{id}/price-versions`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`service-management.css`；`catalog/FoundationController.java`。
- 依赖的其他功能：服务派单、订单结算、加钟、价格生效营业日。

### 服务分类树和分类分析
- 功能描述：维护父子分类、编码、名称和排序，支持删除及分类使用分析。
- 入口位置（页面/接口）：项目管理分类区域；`GET/POST /api/v1/service-categories`、`PUT /api/v1/service-categories/{id}`、`DELETE /api/v1/service-categories/{id}`、`GET /api/v1/service-categories/analytics`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`；`catalog/ServiceCategoryController.java`。
- 依赖的其他功能：服务项目、报表统计、权限校验。

### 服务时长政策
- 功能描述：设置门店默认时长和可选时长规则，供前台派钟及技师上钟选项使用。
- 入口位置（页面/接口）：项目/派钟配置；`GET/PUT /api/v1/service-duration-policy`、`GET /api/v1/mobile/technician/clock-options`。
- 涉及文件：`apps/massage-console/app.js`、`mobile.js`；`catalog/ServiceDurationController.java`、`mobile/TechnicianMobileController.java`。
- 依赖的其他功能：服务项目、技师上钟、营业日报钟数。

## 会员、开卡与储值钱包
### 会员查询和会员中心
- 功能描述：按编号/姓名/手机号查询会员，按余额和本店业务筛选，显示会员人数、余额、充值、赠送及本店消费汇总。
- 入口位置（页面/接口）：会员中心；`GET /api/v1/members`、`GET /api/v1/members/center`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`member-center.css`；`member/MemberController.java`。
- 依赖的其他功能：门店范围、共享会员钱包、订单消费、充值流水。

### 会员建档、开卡、续卡和资料维护
- 功能描述：新增/编辑会员资料，开卡、续卡并记录归属员工/技师；支持测试余额清理归档以及删除/彻底清理操作。
- 入口位置（页面/接口）：会员中心“新增会员/开卡/续卡”；`POST /api/v1/members`、`POST /api/v1/members/open-card`、`PUT /api/v1/members/{id}`、`DELETE /api/v1/members/{id}`、`DELETE /api/v1/members/{id}/purge`、`POST /api/v1/members/{id}/clear-test-balance-and-archive`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`；`member/MemberController.java`。
- 依赖的其他功能：钱包流水、员工/技师追踪、审计、门店权限。

### 充值、赠送、余额消费和资金流水
- 功能描述：办理会员充值/赠送，按会员余额扣款消费，查看消费明细及全部钱包流水；开卡、充值、续卡计入现金流规则，余额消费计入营业额但不重复计入现金流。
- 入口位置（页面/接口）：会员详情“充值/消费明细/资金流水”；`POST /api/v1/members/{id}/recharges`、`GET /api/v1/members/{id}/profile`、`GET /api/v1/wallet-transactions`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`daily-report.js`；`member/MemberController.java`、`member/WalletTransactionController.java`、`operations/OperationsReportController.java`。
- 依赖的其他功能：订单结算、营业日报、退款、营业日边界、会员充值技师/员工追踪。

### 会员充值退款
- 功能描述：提交会员充值退款申请，按审核结果完成或取消，保留退款金额、赠送金额和状态。
- 入口位置（页面/接口）：会员中心/退款管理；`GET/POST /api/v1/member-recharge-refunds`、`POST /api/v1/member-recharge-refunds/{id}/complete`、`POST /api/v1/member-recharge-refunds/{id}/cancel`。
- 涉及文件：`apps/massage-console/app.js`、`index.html`；`member/MemberRechargeRefundController.java`。
- 依赖的其他功能：会员钱包、财务审核、营业额/现金流统计、审计。

## 销售订单、退款与更正
### 订单结算和订单作废
- 功能描述：保存已结算订单及支付明细；按原因作废整单，联动房间、服务会话、营业额和技师业绩，并写入审计。
- 入口位置（页面/接口）：订单详情“作废”、结算提交；`POST /api/v1/sales-orders/settle`、`POST /api/v1/sales-orders/{id}/void`。
- 涉及文件：`apps/massage-console/app.js`、`index.html`；`sales/SalesOrderController.java`、`audit/AuditService.java`。
- 依赖的其他功能：服务会话、退款生命周期、提成计算、报表。

### 整单退款/红冲和待确认退款
- 功能描述：按订单剩余可退金额生成整单红冲，锁定剩余项目和原支付方式；外部收款退款先进入待确认状态，确认付款后完成红冲及业绩冲减，也可取消未完成的退款。
- 入口位置（页面/接口）：财务审核/订单详情退款对话框；`POST /api/v1/sales-orders/{orderId}/refunds`、`GET /api/v1/sales-orders/{orderId}/refunds`、`GET /api/v1/refunds`、`GET /api/v1/refunds/{refundId}`、`POST /api/v1/refunds/{refundId}/payments/{refundPaymentId}/complete`、`POST /api/v1/refunds/{refundId}/cancel`。
- 涉及文件：`apps/massage-console/app.js`、`index.html`；`sales/RefundController.java`、`sales/SalesOrderController.java`。
- 依赖的其他功能：原支付记录、会员钱包、技师提成、营业额/现金流报表、审计。

### 财务收款更正和业务更正
- 功能描述：在版本校验下修正订单实际收款/支付渠道，或修正服务项目、技师、房间等业务信息；保留更正原因和前后版本。
- 入口位置（页面/接口）：订单详情“收款更正/业务更正”；`POST /api/v1/sales-orders/{id}/financial-corrections`、`GET/POST /api/v1/sales-orders/{id}/business-corrections`。
- 涉及文件：`apps/massage-console/app.js`、`index.html`；`sales/SalesOrderController.java`。
- 依赖的其他功能：乐观锁、订单明细、提成重算、营业报表、审计。

## 技师提成和推荐提成
### 项目提成规则与版本
- 功能描述：分别配置排钟、点钟、加钟的固定金额/比例/不计提成规则，按生效营业日生成版本；服务开始时锁定版本。
- 入口位置（页面/接口）：项目管理“提成设置”；`GET /api/v1/commissions/service-item-rules`、`PUT /api/v1/commissions/service-item-rules/{serviceItemId}`、`GET /api/v1/commissions/service-item-rules/{serviceItemId}/versions`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`；`sales/TechnicianCommissionController.java`。
- 依赖的其他功能：服务项目、服务会话开始时间、订单结算、退款冲减。

### 提成记录、调整和汇总
- 功能描述：查询技师项目业绩和有效提成，登记/查看人工调整，按日期、门店和技师汇总，退款整单冲减对应业绩。
- 入口位置（页面/接口）：经营管理“技师提成/提成调整”；`GET /api/v1/commissions/records`、`GET /api/v1/commissions/adjustments`、`GET /api/v1/commissions/summary`、`GET /api/v1/technician-performance`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`manager-mobile.html`、`manager-mobile.js`；`sales/TechnicianCommissionController.java`、`catalog/TechnicianPerformanceController.java`。
- 依赖的其他功能：订单支付、退款/作废、项目提成版本、营业日。

### 月度提成阶梯
- 功能描述：维护按月份生效的门店/技师提成阶梯，查询当前规则及历史版本。
- 入口位置（页面/接口）：经营管理/店长端提成设置；`GET /api/v1/commissions/monthly-tiers`、`GET /api/v1/commissions/monthly-tiers/versions`、`PUT /api/v1/commissions/monthly-tiers`。
- 涉及文件：`apps/massage-console/monthly-targets.js`、`manager-mobile.js`；`sales/MonthlyCommissionTierController.java`。
- 依赖的其他功能：提成汇总、营业日月份、门店权限。

### 行政推荐提成
- 功能描述：配置行政推荐提成规则，登记推荐记录，查询汇总并标记已支付。
- 入口位置（页面/接口）：经营管理“行政推荐提成”；`GET/PUT /api/v1/commissions/administrative/rules`、`GET/POST /api/v1/commissions/administrative/referrals`、`GET /api/v1/commissions/administrative/summary`、`PUT /api/v1/commissions/administrative/referrals/{id}/paid`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`；`sales/AdministrativeReferralCommissionController.java`。
- 依赖的其他功能：员工档案、服务项目、订单结算、付款状态。

## 经营报表、营业日和目标
### 管理看板和日报
- 功能描述：展示订单实收、服务业绩、储值充值、余额消费、房间利用率、近七日趋势、技师排行和待关注事项；按营业日编辑、发布日报并查看修订版本。
- 入口位置（页面/接口）：前台“经营管理”、日报编辑区；`GET /api/v1/operations/management-overview`、`GET/POST/PUT /api/v1/daily-reports`、`GET /api/v1/daily-reports/summary`、`GET /api/v1/daily-reports/settings`、`PUT /api/v1/daily-reports/settings`、`POST /api/v1/daily-reports/{id}/publish`、`GET /api/v1/daily-reports/{id}/revisions`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`daily-report.js`、`daily-report.css`；`operations/OperationsReportController.java`、`operations/DailyOperatingReportController.java`。
- 依赖的其他功能：订单/退款、会员钱包、房间服务、提成、营业日边界。

### 营业额、累计现金流和支付渠道统计
- 功能描述：按规则区分累计营业额与累计现金流：开卡/充值/续卡进入现金流不进入营业额；会员余额消费进入营业额不重复进入现金流；普通订单实际支付同时进入两者；赠送金额不进入两者；退款冲减对应指标。
- 入口位置（页面/接口）：经营管理“营业数据/收款构成”、店长端营业数据；`GET /api/v1/operations/daily-report`、`GET /api/v1/operations/payment-channel-summary`、`GET /api/v1/operations/cross-store-transactions`。
- 涉及文件：`apps/massage-console/daily-report.js`、`app.js`、`manager-mobile.js`；`operations/OperationsReportController.java`、`sales/SalesOrderController.java`、`member/WalletTransactionController.java`。
- 依赖的其他功能：支付方式现金统计标识、会员钱包、退款、更正、营业日。

### 服务钟数和技师排行
- 功能描述：按钟类统计服务次数/时长，输出技师服务排行和有效业绩，支持门店与日期筛选。
- 入口位置（页面/接口）：经营管理服务记录；`GET /api/v1/operations/service-clock-summary`、`GET /api/v1/technician-performance`。
- 涉及文件：`apps/massage-console/app.js`、`index.html`；`operations/OperationsReportController.java`、`catalog/TechnicianPerformanceController.java`。
- 依赖的其他功能：服务会话、钟类、订单结算、提成规则。

### 月度目标分解
- 功能描述：设置门店月度目标并分配到项目和技师，按月份查询和保存。
- 入口位置（页面/接口）：经营管理“月度目标”；`GET/PUT /api/v1/monthly-targets`、`GET/PUT /api/v1/daily-reports/settings`。
- 涉及文件：`apps/massage-console/monthly-targets.js`、`monthly-targets.css`、`daily-report.js`、`index.html`；`operations/MonthlyTargetController.java`、`DailyOperatingReportController.java`。
- 依赖的其他功能：门店权限、经营日报、项目/技师资料。

### 多门店对比、预警和跨店交易
- 功能描述：总部或店长查看已授权门店的订单实收、服务业绩、现金净额对比；查看经营预警待办，搜索跨门店订单、退款及会员消费。
- 入口位置（页面/接口）：前台经营管理总部视图、店长手机端“更多”；`GET /api/v1/operations/store-comparison`、`GET /api/v1/operations/store-alerts`、`GET /api/v1/operations/cross-store-transactions`。
- 涉及文件：`apps/massage-console/app.js`、`manager-mobile.html`、`manager-mobile.js`；`operations/OperationsReportController.java`。
- 依赖的其他功能：多门店访问范围、订单/退款、会员钱包、日报。

### 实时房间和技师状态报表
- 功能描述：在管理看板和店长端显示空闲/服务中/清洁中房间、服务中技师、接单和轮钟状态。
- 入口位置（页面/接口）：经营管理实时运营、店长端首页；`GET /api/v1/operations/live-room-status`、`GET /api/v1/operations/live-technician-status`。
- 涉及文件：`apps/massage-console/app.js`、`manager-mobile.html`、`manager-mobile.js`；`operations/OperationsReportController.java`。
- 依赖的其他功能：房间状态、服务会话、技师队列和排班。

### 日报导出
- 功能描述：将日报及筛选结果导出文件，供财务或总部留档。
- 入口位置（页面/接口）：日报“导出”；`GET /api/v1/daily-reports/export`、`GET /api/v1/operations/daily-report/export`。
- 涉及文件：`apps/massage-console/daily-report.js`、`app.js`；`operations/DailyOperatingReportController.java`、`OperationsReportController.java`。
- 依赖的其他功能：日报数据权限、营业日和统计口径。

## 报销、财务审核与费用统计
### 店长报销草稿和提交
- 功能描述：店长按费用分类、日期、金额、付款来源和凭证类型创建报销草稿，上传 JPG/PNG/PDF 凭证，保存、提交或撤回。
- 入口位置（页面/接口）：店长手机端“费用报销”；`GET /api/v1/expense-claims/categories`、`GET/POST /api/v1/expense-claims`、`GET /api/v1/expense-claims/{id}`、`PUT /api/v1/expense-claims/{id}`、`POST /api/v1/expense-claims/{id}/submit`、`POST /api/v1/expense-claims/{id}/withdraw`、`POST /api/v1/expense-claims/{id}/attachments`、`GET/DELETE /api/v1/expense-claims/{claimId}/attachments/{attachmentId}`。
- 涉及文件：`apps/massage-console/manager-mobile.html`、`manager-mobile.js`、`manager-mobile.css`；`operations/ExpenseClaimController.java`。
- 依赖的其他功能：店长认证与门店范围、费用分类、附件存储、财务审核。

### 财务费用分类管理
- 功能描述：财务维护报销分类，支持新增、编辑和启用/停用，供店长填报和财务归类。
- 入口位置（页面/接口）：前台“财务审核/费用分类”；`GET/POST /api/v1/finance/expense-categories`、`PUT /api/v1/finance/expense-categories/{id}`、`PUT /api/v1/finance/expense-categories/{id}/active`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`finance-center.css`；`operations/FinanceExpenseCategoryController.java`。
- 依赖的其他功能：报销单、角色权限、门店范围。

### 财务审核、退回、驳回、归类和付款
- 功能描述：按门店/店长/日期/单号/状态筛选报销，查看详情和附件，执行审核通过、退回、驳回、归类、付款并上传付款凭证。
- 入口位置（页面/接口）：前台“财务审核”；`GET /api/v1/finance/expense-claims`、`GET /api/v1/finance/expense-claims/{id}`、`GET /api/v1/finance/expense-claims/{claimId}/attachments/{attachmentId}`、`POST /api/v1/finance/expense-claims/{id}/approve`、`POST /api/v1/finance/expense-claims/{id}/return`、`POST /api/v1/finance/expense-claims/{id}/reject`、`POST /api/v1/finance/expense-claims/{id}/classify`、`POST /api/v1/finance/expense-claims/{id}/pay`、`POST /api/v1/finance/expense-claims/{id}/payment-proof`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`finance-center.css`；`operations/FinanceExpenseClaimController.java`。
- 依赖的其他功能：报销提交、费用分类、附件、管理员权限、审计。

### 报销统计和导出
- 功能描述：按门店、分类、状态汇总报销金额和数量，导出财务报销报表。
- 入口位置（页面/接口）：财务审核统计区；`GET /api/v1/finance/expense-reports/summary`、`GET /api/v1/finance/expense-reports/export`。
- 涉及文件：`apps/massage-console/app.js`、`index.html`；`operations/FinanceExpenseReportController.java`。
- 依赖的其他功能：报销单状态、费用分类、门店权限。

## 收款方式与小票打印
### 门店收款方式
- 功能描述：维护收款方式编码、名称、排序、是否计入现金统计和备注，支持停用及恢复显示。
- 入口位置（页面/接口）：前台“收款方式”；`GET/POST /api/v1/payment-methods`、`PUT /api/v1/payment-methods/{id}`、`PUT /api/v1/payment-methods/{id}/active`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`；`sales/StorePaymentMethodController.java`。
- 依赖的其他功能：订单结算、营业额/现金流统计、退款。

### 小票内容、尺寸和打印路径
- 功能描述：设置抬头、门店地址电话、订单/会员/技师/房间/支付/余额/钟类显示、纸宽（58/80/100/120mm）、字号、边距、份数和自动打印；支持网页打印、参考预览和本地打印桥接测试。
- 入口位置（页面/接口）：前台“打印设置”；`GET/PUT /api/v1/print-settings`；本地桥接 `GET http://127.0.0.1:9178/health`、`POST http://127.0.0.1:9178/print`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`styles.css`；`sales/StorePrintSettingController.java`、`server.massage.js`。
- 依赖的其他功能：订单结算、收款方式、服务钟类、浏览器打印权限及本地打印服务。

## 管理员认证、门店与权限
### 管理端登录和会话
- 功能描述：管理员登录、查询当前会话角色/权限、退出登录；会话失效时清理前端令牌并锁定受保护页面。
- 入口位置（页面/接口）：管理登录对话框；`POST /api/v1/admin/auth/login`、`GET /api/v1/admin/auth/session`、`POST /api/v1/admin/auth/logout`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`、`login-portal.css`；`admin/AdminAuthController.java`、`admin/AdminSessionService.java`。
- 依赖的其他功能：业务权限过滤器、门店范围、前台/财务/总部视图。

### 门店创建、开通和资料维护
- 功能描述：总部查看全部门店，查看当前账号已授权门店，创建单店或按模板一键开通门店（含经理账号、房间床位和服务项目），编辑门店资料并启用/停用。
- 入口位置（页面/接口）：前台“门店设置/门店与权限”；`GET /api/v1/admin/access/stores`、`GET /api/v1/admin/access/my-stores`、`POST /api/v1/admin/access/stores`、`POST /api/v1/admin/access/stores/onboard`、`PUT /api/v1/admin/access/stores/{id}`、`PUT /api/v1/admin/access/stores/{id}/active`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`；`admin/AccessControlController.java`。
- 依赖的其他功能：门店基础资料、权限角色、服务/房间初始化、管理员会话。

### 角色、权限和账号访问范围
- 功能描述：查看权限字典和角色，编辑角色权限；创建管理账号、分配角色与门店范围，编辑访问范围并启用/停用账号。
- 入口位置（页面/接口）：前台“门店设置/权限”；`GET /api/v1/admin/access/permissions`、`GET /api/v1/admin/access/roles`、`PUT /api/v1/admin/access/roles/{id}/permissions`、`GET/POST /api/v1/admin/access/users`、`PUT /api/v1/admin/access/users/{id}/access`、`PUT /api/v1/admin/access/users/{id}/active`。
- 涉及文件：`apps/massage-console/index.html`、`app.js`；`admin/AccessControlController.java`、`security/BusinessPermissionFilter.java`。
- 依赖的其他功能：管理员会话、门店数据隔离、财务/报表/审计权限。

## 店长移动端
### 店长登录、门店切换和看板
- 功能描述：店长手机端登录后仅访问授权门店，可切换门店，查看今日经营概览、订单实收、服务业绩、充值、余额消费和房间利用率。
- 入口位置（页面/接口）：`apps/massage-console/manager-mobile.html` 管理看板；`POST /api/v1/admin/auth/login`、`GET /api/v1/admin/access/my-stores`、`GET /api/v1/operations/management-overview`、`GET /api/v1/operations/daily-report`。
- 涉及文件：`manager-mobile.html`、`manager-mobile.js`、`manager-mobile.css`；`admin/AdminAuthController.java`、`admin/AccessControlController.java`、`operations/OperationsReportController.java`。
- 依赖的其他功能：管理员会话、门店权限、日报和实时状态接口。

### 店长端营业分析、提成和实时运营
- 功能描述：按当日/当月查看客流与钟数，按月份和技师查看项目业绩/实际提成及调整记录，实时显示房间和技师状态，并提供多门店对比、经营预警、跨店订单消费查询。
- 入口位置（页面/接口）：店长端“营业数据/技师项目提成/实时运营/更多”；`GET /api/v1/operations/service-clock-summary`、`GET /api/v1/commissions/summary`、`GET /api/v1/commissions/records`、`GET /api/v1/commissions/adjustments`、`GET /api/v1/operations/live-room-status`、`GET /api/v1/operations/live-technician-status`、`GET /api/v1/operations/store-comparison`、`GET /api/v1/operations/store-alerts`、`GET /api/v1/operations/cross-store-transactions`。
- 涉及文件：`manager-mobile.html`、`manager-mobile.js`、`manager-mobile.css`；`operations/OperationsReportController.java`、`sales/TechnicianCommissionController.java`。
- 依赖的其他功能：提成规则、订单退款、房间/技师状态、门店访问范围。

### 店长端报销编辑、附件预览和状态跟踪
- 功能描述：在手机端新增/编辑报销、上传或删除凭证、预览图片/PDF，保存草稿、提交审核、撤回并按状态筛选。
- 入口位置（页面/接口）：店长端“费用报销”及详情/预览弹窗；对应 `/api/v1/expense-claims` 全部店长报销接口。
- 涉及文件：`manager-mobile.html`、`manager-mobile.js`、`manager-mobile.css`；`operations/ExpenseClaimController.java`。
- 依赖的其他功能：店长登录、费用分类、附件校验、财务审核流程。

## 技师移动端
### 技师登录、个人资料和服务首页
- 功能描述：技师登录/退出，查看个人资料、当前服务、待处理派单、预约服务、最近服务和底部导航。
- 入口位置（页面/接口）：`apps/massage-console/mobile.html`；`POST /api/v1/mobile/auth/login`、`POST /api/v1/mobile/auth/logout`、`GET /api/v1/mobile/technician/me`。
- 涉及文件：`mobile.html`、`mobile.js`、`mobile-auth.css`、`mobile-app.css`；`mobile/MobileAuthController.java`、`mobile/TechnicianMobileController.java`。
- 依赖的其他功能：技师账号、移动会话、门店和技师绑定。

### 技师上钟、开始/结束服务和换房
- 功能描述：查看可上钟房间/项目及时长，主动上钟，开始服务、下钟，申请服务中换房并查看处理结果。
- 入口位置（页面/接口）：技师端“当前服务/上钟/换房”；`GET /api/v1/mobile/technician/clock-options`、`POST /api/v1/mobile/technician/clock-in`、`POST /api/v1/mobile/technician/start-service`、`POST /api/v1/mobile/technician/clock-out`、`GET/POST /api/v1/mobile/technician/service-room-transfers`。
- 涉及文件：`mobile.html`、`mobile.js`、`mobile-clock.css`；`mobile/TechnicianMobileController.java`、`catalog/ServiceRoomTransferController.java`。
- 依赖的其他功能：排班资格、房间状态、服务会话、移动认证。

### 派单确认、拒绝和转派
- 功能描述：接收派单提醒并倒计时确认，拒绝时填写原因，选择候选技师转派。
- 入口位置（页面/接口）：技师端派单提醒；`GET /api/v1/mobile/technician/dispatch-notification`、`POST /api/v1/mobile/technician/dispatch-notification/confirm`、`POST /api/v1/mobile/technician/dispatch-notification/reject`、`GET /api/v1/mobile/technician/dispatch-notification/transfer-candidates`、`POST /api/v1/mobile/technician/dispatch-notification/transfer`。
- 涉及文件：`mobile.html`、`mobile.js`、`mobile-dispatch-alert.css`；`mobile/TechnicianMobileController.java`、`catalog/ServiceDispatchController.java`。
- 依赖的其他功能：派单超时任务、服务转派、技师队列。

### 技师业绩、提成、调整和日报
- 功能描述：按范围查看服务业绩、当日数据、项目提成明细、人工调整和汇总。
- 入口位置（页面/接口）：技师端“我的业绩与提成/最近服务”；`GET /api/v1/mobile/technician/performance`、`GET /api/v1/mobile/technician/daily-data`、`GET /api/v1/mobile/technician/commissions`、`GET /api/v1/mobile/technician/commissions/adjustments`、`GET /api/v1/mobile/technician/commissions/summary`。
- 涉及文件：`mobile.html`、`mobile.js`；`mobile/TechnicianMobileController.java`。
- 依赖的其他功能：订单结算、退款冲减、提成版本、营业日。

### 技师请假和加钟
- 功能描述：提交/查看请假申请，查看加钟可选项目并提交加钟意向。
- 入口位置（页面/接口）：技师端“请假申请/加钟”；`GET/POST /api/v1/mobile/technician/leave-requests`、`GET /api/v1/mobile/technician/extension-options`、`POST /api/v1/mobile/technician/extensions`、`GET /api/v1/service-extension-intents/mine`、`POST /api/v1/service-extension-intents`。
- 涉及文件：`mobile.html`、`mobile.js`、`mobile-extension.css`；`mobile/TechnicianMobileController.java`、`catalog/ServiceExtensionIntentController.java`。
- 依赖的其他功能：排班请假审批、服务会话、项目加钟规则。

## 独立账本
### 账本订单和消费记录
- 功能描述：提供独立账本页面，查询账本订单/消费记录和统计；账本数据与前台订单和会员余额隔离。
- 入口位置（页面/接口）：`apps/massage-console/ledger.html`；前端逻辑由 `ledger.js` 维护（当前无独立 Java Controller 路由）。
- 涉及文件：`apps/massage-console/ledger.html`、`ledger.js`、`styles.css`。
- 依赖的其他功能：浏览器本地状态与静态资源服务；不依赖前台结算钱包写入。

## 审计与安全告警
### 审计查询、筛选和导出
- 功能描述：按操作人、门店、模块、动作、结果和日期查询审计事件，查看详情并导出。
- 入口位置（页面/接口）：前台“审计中心”（由权限控制显示）；`GET /api/v1/audits/options`、`GET /api/v1/audits`、`GET /api/v1/audits/{id}`、`GET /api/v1/audits/export`。
- 涉及文件：`apps/massage-console/audit-center.js`、`audit-center.css`、`index.html`；`audit/AuditQueryController.java`、`audit/AuditService.java`、`audit/AuditOutcomeFilter.java`。
- 依赖的其他功能：业务权限、订单/退款/报销等写操作、门店范围。

### 安全告警查询和状态处理
- 功能描述：查看安全告警、规则和筛选选项，打开告警详情并更新处理状态。
- 入口位置（页面/接口）：前台安全告警区；`GET /api/v1/security-alerts`、`GET /api/v1/security-alerts/options`、`GET /api/v1/security-alerts/rules`、`GET /api/v1/security-alerts/{id}`、`POST /api/v1/security-alerts/{id}/status`。
- 涉及文件：`apps/massage-console/security-alert.js`、`security-alert.css`、`index.html`；`alert/SecurityAlertController.java`、`alert/SecurityAlertService.java`、`alert/SecurityAlertAuditListener.java`。
- 依赖的其他功能：审计事件、管理员权限、告警规则配置。

## 离线、PWA 与本地同步
### 离线操作队列和幂等回执
- 功能描述：网络中断时缓存服务会话、预约、换房和房间状态操作，恢复网络后按序同步并使用操作 ID/回执避免重复提交。
- 入口位置（页面/机制）：前台及技师端离线操作；前端 `offline-sync.js`，后端离线回执过滤器。
- 涉及文件：`apps/massage-console/offline-sync.js`、`offline-sync.css`；`services/massage-api` 的 `OfflineOperationIdempotencyFilter` 及 V54 迁移。
- 依赖的其他功能：服务会话、预约、房间状态 API、认证令牌。

### 技师端 PWA 缓存和安装
- 功能描述：通过 Service Worker 缓存技师端静态资源，网络失败时回退缓存；提供 web manifest 供移动端安装。
- 入口位置（页面/机制）：`mobile.html` 注册 `technician-service-worker.js`，`technician.webmanifest`。
- 涉及文件：`apps/massage-console/technician-service-worker.js`、`technician.webmanifest`、`mobile.html`、`mobile-app.css`。
- 依赖的其他功能：静态资源服务器、浏览器 Service Worker 权限。

## Android 应用壳与静态入口
### 技师 Android 壳
- 功能描述：以 Capacitor WebView 打包技师移动端，启动后加载远程技师页面。
- 入口位置（配置/页面）：`apps/technician-android/www/index.html`；远程地址 `https://tech.jkyygl.xyz/mobile.html`。
- 涉及文件：`apps/technician-android/www/index.html`、`capacitor.config.json` 及 Android 工程文件。
- 依赖的其他功能：技师移动端静态服务、HTTPS、移动端 API。

### 店长 Android 壳
- 功能描述：以 Capacitor WebView 打包店长移动端，启动后加载远程店长页面。
- 入口位置（配置/页面）：`apps/manager-android/www/index.html`；远程地址 `https://manager.jkyygl.xyz/manager-mobile.html`。
- 涉及文件：`apps/manager-android/www/index.html`、`capacitor.config.json` 及 Android 工程文件。
- 依赖的其他功能：店长移动端静态服务、HTTPS、管理员认证和报表 API。

### Android 下载中心
- 功能描述：提供技师端和店长端 Android APK 下载入口，显示应用版本和用途说明。
- 入口位置（页面/服务）：`/downloads/`（`apps/massage-console/downloads/index.html`）；APK 由静态服务直接下载。
- 涉及文件：`apps/massage-console/downloads/index.html`、`apps/massage-console/downloads/downloads.css`、`server.massage.js`。
- 依赖的其他功能：技师/店长 Android 壳、静态文件服务、APK 构建产物。

### 主平台静态入口
- 功能描述：由唯一权威目录 `apps/massage-console/` 提供按摩运营平台的前台、技师端和店长端页面。
- 入口位置（页面/服务）：`apps/massage-console/index.html`、`mobile.html`、`manager-mobile.html`；`server.massage.js` 提供静态文件并反代 `/api/` 到 8080。
- 涉及文件：`apps/massage-console/`、`server.massage.js`。
- 依赖的其他功能：Java API、前端静态资源和门店认证。

## 后端健康检查、任务和公共机制
### 服务健康检查和首页
- 功能描述：返回后端首页和健康状态，供反向代理、部署检查和监控使用。
- 入口位置（页面/接口）：`GET /`、`GET /api/health`。
- 涉及文件：`services/massage-api/src/main/java/com/chengxin/massage/HomeController.java`、`services/massage-api/src/main/resources/application.yml`。
- 依赖的其他功能：Spring Boot 启动、数据库连接和部署环境。

### 派单超时扫描定时任务
- 功能描述：按固定延迟扫描超时未处理派单，推进派单状态并写入派单事件/通知；默认每 30 秒运行，可由 `massage.dispatch.timeout-scan-ms` 调整。
- 入口位置（机制）：Spring `@Scheduled` 后台任务，无页面入口。
- 涉及文件：`services/massage-api/src/main/java/com/chengxin/massage/catalog/ServiceDispatchTimeoutJob.java`、相关服务会话/派单 Service。
- 依赖的其他功能：派单状态机、技师移动通知、转派和审计。

### 考勤扫描定时任务
- 功能描述：按固定延迟同步排班与员工考勤、计算迟到早退/缺勤；默认每 60 秒运行，可由 `massage.attendance.scan-ms` 调整。
- 入口位置（机制）：Spring `@Scheduled` 后台任务，无页面入口。
- 涉及文件：`services/massage-api/src/main/java/com/chengxin/massage/operations/EmployeeAttendanceService.java`、`EmployeeAttendanceController.java`。
- 依赖的其他功能：员工档案、排班请假、营业日。

### 前端轮询、计时和同步机制
- 功能描述：前台约 5 秒同步运营状态、服务计时约 1 秒、财务约 20 秒；技师端派单倒计时/提醒约 1 秒并在登录后约 5 秒刷新；店长端可见时约 30 秒刷新，搜索使用防抖。
- 入口位置（机制）：前台 `app.js`、技师端 `mobile.js`、店长端 `manager-mobile.js`。
- 涉及文件：`apps/massage-console/app.js`、`mobile.js`、`manager-mobile.js`、`offline-sync.js`。
- 依赖的其他功能：对应报表、派单、服务会话和认证接口。

### 业务权限、审计和会话过滤器
- 功能描述：对 API 执行角色/门店范围校验，统一记录业务操作和结果，维护管理端与技师端会话。
- 入口位置（机制）：所有 `/api/v1/**` 受保护接口；无独立页面入口。
- 涉及文件：`BusinessPermissionFilter`、`AuditOutcomeFilter`、`AuditService`、`AdminSessionService`、`MobileSessionService` 及 `services/massage-api` 配置。
- 依赖的其他功能：管理员/技师登录、门店访问范围、审计中心、安全告警。

### 营业日边界计算
- 功能描述：按门店时区和营业日截止时间确定业务日期，统一用于订单、服务、会员流水、日报和月度统计。
- 入口位置（机制）：`BusinessClockService` 被订单、报表、提成和钱包服务调用。
- 涉及文件：`services/massage-api` 中 `BusinessClockService`、`application.yml`、V43 迁移及相关业务 Service。
- 依赖的其他功能：门店设置、订单结算、提成、日报和现金流口径。

## 数据库、日志与部署
### 数据库迁移和领域数据
- 功能描述：Flyway 迁移 V1 至 V88（V86 空号保留），覆盖门店权限、房间床位、服务会话、排班考勤、订单退款更正、会员钱包、提成、报表、报销、打印、审计告警、离线回执和日报统一索引等结构与约束。
- 入口位置（部署机制）：Java API 启动时自动执行 `db/migration`。
- 涉及文件：`services/massage-api/src/main/resources/db/migration/`、`services/massage-api/pom.xml`、`application.yml`。
- 依赖的其他功能：所有后端 Controller/Service、数据库连接和 Flyway。

### API 日志和应用日志
- 功能描述：Spring Boot/Logback 输出应用运行日志；提成计算模块按入口参数、中间结果、返回值和异常堆栈记录控制台及按日期切分的 `logs/` 文件。
- 入口位置（机制）：后端日志配置，无页面入口。
- 涉及文件：`services/massage-api/src/main/resources/logback-spring.xml`、提成计算相关 Service、`application.yml`。
- 依赖的其他功能：提成查询/调整、部署目录写权限、日志轮转。

### 生产启动、反向代理和静态服务
- 功能描述：使用 Java 21 运行 API（默认 8080），Node 22+ 运行静态服务（`server.massage.js` 默认 5174），Nginx 终止 HTTPS 并反向代理；部署脚本负责首次启动验证。
- 入口位置（部署文件）：`docs/deployment.md`、`deploy/start-production.ps1`、`deploy/nginx/massage-platform.conf`；`server.massage.js` 将 `/api/` 反代至 API 8080。
- 涉及文件：`deploy/`、`server.massage.js`、`services/massage-api/pom.xml`、`application.yml`。
- 依赖的其他功能：数据库迁移、静态前端、Java API、Nginx/HTTPS、环境变量。
