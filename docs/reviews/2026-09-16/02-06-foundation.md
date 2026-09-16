# 第二阶段 / 基础数据

范围：FoundationController、RoomController、ServiceItemVersionService、项目分类/价格/佣金版本、技师队列/排班、支付方式、钟类约束。
后端路径前缀：`services/massage-api/src/main/java/com/chengxin/massage/`。

## 已确认设计

项目金额按分存储；价格/佣金使用营业日版本快照，避免直接用今日价格改历史单。床位占用有局部唯一索引，技师替换会锁目标技师并校验在服参与者。钟类有 Java 白名单和数据库 CHECK 双重约束。
基础资料读写按 FOUNDATION_MANAGE/前台读权限区分，但部分 Controller 的功能权限完全依赖过滤器，需纳入 R02 的路径规范化验证。

## 问题

### R11 / P2：床位容量和启停缺少活动引用约束

位置：`catalog/RoomController.java:153`、`:165`、`:199`；`catalog/ServiceSessionController.java:450`。
bed_count 改小不会停用多余 room_bed，派钟按 active 床清单取床，因此缩容后仍可能派出超出标称容量的服务。ensureRoomBeds 只补缺床，不缩减床；停用床位/房间也未校验当前占用。
建议把“物理床清单/标称容量”的主来源明确下来；操作前锁房间，拒绝删除/停用占用床位，缩容时只撤销未占用目标床；巡检输出差异供人工核实，不批量删除床。

### R16 / P1：房间/床位只存在单列外键

位置：`services/massage-api/src/main/resources/db/migration/V75__room_bed_occupancy.sql:1`；`catalog/ServiceRoomTransferController.java:96`。
外键保证 bed_id 存在，但不保证床位的 room_id/store_id 与服务一致。换房路径已经具备写出不一致的条件。建议先修业务迁移床位，再基于复合唯一键建立复合外键防止旁路写入。

### R01 / P1：配置文本被直接当 HTML 渲染

位置：`apps/massage-console/app.js:1609`、`:1951`，以及店长门店比较 `manager-mobile.js:470`。
名称和备注没有“可信内部数据”豁免，应统一输出编码。不要靠禁止中文符号或简单过滤 `<script>` 修复。

### R13 / P2：历史有效性与缺省回退

位置：`catalog/ServiceItemVersionService.java:42`。历史读缺版本时回退基础价格，与佣金规则读取策略不一致。调整版本表前先核对补单所需最早日期；禁止把所有缺失版本一律补成今日金额。

## 待补测试

两个派钟竞争最后一张床、改房容量、停用在服技师/床位、重复工号启用、跨店项目 UUID、历史价格切换日、付款渠道改代码后的历史渠道显示、钟类更正前后提成抵销。
支付渠道代码可改但历史支付保留旧代码快照，应明确它是历史展示键而非稳定实体外键；日报当前对旧代码有回退聚合，未发现仅改名就丢订单的证据。
