# 20260911-p0-conflict-fix-v1 400/409 条件清单

本清单按当前源码给出触发条件。真正的资源竞争 409 仍是业务保护，不应改成双写成功。

## P0 目标接口

### `PUT /api/v1/service-sessions/{sessionId}/service-item`

- 400：请求字段缺失/空白；新旧项目相同；项目不存在、停用、跨店或不可用；换后总时长低于 15 分钟；门店总时长或累计加钟上限超限。
- 409：服务不是 `IN_SERVICE`；服务已结算；当前累计加钟时长异常；乐观锁版本已变化。
- `reason: "2"` 是合法自由文本原因码，长度限制仍为 240。

### `PUT /api/v1/service-sessions/{sessionId}/extensions/{extensionId}/service-item`

- 400：项目字段/原因字段校验失败；新项目不存在、停用、跨店或不可作为加钟；换后总时长低于 15 分钟；门店时长上限超限。
- 409：服务不是 `IN_SERVICE`；服务已结算；当前累计加钟时长异常；乐观锁版本已变化。
- 同时长换项不再写 0 分钟时长变更日志。
- 已超预计结束时间但仍为合法 `IN_SERVICE` 的服务允许换项。

### `POST /api/v1/service-sessions/clock-in`

- 400：技师/房间/项目不存在或停用；参与技师超过 4 位、重复或分配比例不为 100%；钟类非法；床位参数无效；DTO 必填或时长不在 15-360 分钟。
- 409：技师已有 `PENDING_ACCEPTANCE`、`ACCEPTED`、`REASSIGNMENT_REQUIRED`、`DISPATCH_CANCELLED` 或 `IN_SERVICE` 服务；房间没有可用床位；房态为 `PENDING_PAYMENT`、`CLEANING` 或 `MAINTENANCE`；数据库唯一约束竞态。
- `QUEUE`、`CALL`、`SELECTED` 走同一校验链；预定使用 `/service-reservations` 的 `BOOKED_QUEUE`、`BOOKED_CALL`。

### `POST /api/v1/rooms/{id}/status`

- 409：存在活动/待处理服务且目标房态不是 `IN_SERVICE`。
- 相同房态和相同原因直接幂等成功，不新增事件。
- 房间行锁保证同房间并发更新串行化。

### `POST /api/v1/rooms/{id}/complete-cleaning`

- 409：房间停用；存在占用服务；当前房态不是 `CLEANING`。
- 已有 `IDLE / Cleaning completed` 事件视为重复成功；并发完成只保留一条事件。

### `POST /api/v1/rooms/{id}/confirm-payment`

- 409：房间停用；当前房态不是 `PENDING_PAYMENT`；仍有占用服务。

## 幂等过滤器

### `X-Offline-Operation-Id`

- 400：请求头不是 UUID。
- 409：同一 operation ID 用于不同 method 或 path；业务不执行。
- 同 method/path 的在途重复请求等待首请求：首请求 2xx 后返回 204 重放；首请求失败删除回执后由等待请求重新抢占。
- 等待超过 5 秒仍为 `PROCESSING` 返回 503，并带 `Retry-After: 1`；不自动重放。

## 其他保留的业务 409

- 退款：订单非已结算、退款超剩余金额、完成退款不可取消、整单红冲金额/项目不完整。
- 结算与订单更正：重复结算、订单状态不允许、已有退款/红冲、版本过期、服务记录或技师分配不一致。
- 会员：手机号重复、余额/未结算订单/历史记录阻止归档或清理、余额不足。
- 技师与排班：目标技师忙、重复转单、服务状态已变化、请假重叠、班次或请假状态不允许。
- 房间转移与预约：目标房停用、非空闲、已有服务、原请求已处理或源房态不符。
- 日报和费用：同店同日重复日报、已发布日报锁定、报销/费用状态不允许或单号/分类码冲突。

所有目标接口的 400/409 会由全局 `AuditOutcomeFilter` 记录 WARN；目标控制器同时记录可用的门店、房间、技师、服务单、operation ID 和触发原因。
