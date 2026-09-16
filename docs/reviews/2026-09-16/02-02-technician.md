# 第二阶段 / 技师端

范围：TechnicianMobileController、TechnicianAttendanceController、MobileSessionService、TechnicianSchedulePolicy、派钟超时任务与 mobile.js。
后端路径前缀：`services/massage-api/src/main/java/com/chengxin/massage/`。

## 主流程与边界

- 用户 -> 有效技师账号绑定 -> 所属门店，核心查询不接受客户端任意 technician_id；参见 `mobile/TechnicianMobileController.java:492`。
- 考勤打卡使用 `(technician_id,business_date)` 唯一约束与 ON CONFLICT；员工考勤同步处于同一事务，参见 `mobile/TechnicianAttendanceController.java:73`。
- 接单用待接状态和 acceptance_deadline_at 条件更新，过期请求不应变成已接。
- 自主上钟、拒单、转单和技师直接加钟的入口已明确返回 403；注释里的旧实现不是现行可调用能力，不据此误报。

## 问题

### R15 / P1：手机下钟覆盖同房其他服务的房态

位置：`mobile/TechnicianMobileController.java:280`、`:287`、`:519`。
手机下钟完成当前服务后直接写 PENDING_PAYMENT。批量派钟会在同房建立多笔独立 service_session，因此另一个床仍在上钟时也会显示待付款；前台 `catalog/ServiceSessionController.java:642` 已有优先在服/待接的聚合逻辑，两个入口不一致。
建议抽取共用房态计算，在房间锁内查询全部活动服务后写状态。回归要用同房两服务、两技师，分别下钟，不能只测一个服务。

### R08 / P2：历史考勤和跨日时间基准混用

位置：`operations/EmployeeAttendanceService.java:52`、`:85`、`:125`、`:137`。
技师同步以营业日+门店时区计算迟到，手动打卡和未打卡初始状态却按服务器当前 LocalTime；历史查看也会触发同步写入。建议注入 Clock、统一计划起止 Instant，并为跨午夜班次定义结束日。

### R14 / P2：考勤异常和参数验证不统一

位置：`mobile/TechnicianAttendanceController.java:61`、`:86`；`operations/EmployeeAttendanceService.java:52`。
ClockInput 的 note 标注 @Size，但入口未加 @Valid；员工业务冲突使用通用运行时异常而非稳定 409。建议统一 DTO 校验与异常状态，保证失败没有落下部分考勤/审计。

## 待验证业务约定

旧的一个服务多参与者模型中，手机下钟会结束同服务全部在服参与者（`TechnicianMobileController.java:282`）。批量派钟当前使用每床独立服务；是否允许旧模型中个人独立下钟需要产品确认，不能在本次评审中默默改变规则。
真实设备计时、离线恢复、通知重复和应用后台存活本次未运行；服务端 deadline 和 started_at 应作为时间事实，不能以手机本地倒计时为结算依据。

第三阶段实测：重复打卡与员工同步、接单/上钟/加钟/下钟主链路通过；R15 在同房两服务夹具中复现。技师自主派钟 `/clock-in` 受限，与已接单后的 `/start-service` 是不同入口，后者已纳入通过用例。
