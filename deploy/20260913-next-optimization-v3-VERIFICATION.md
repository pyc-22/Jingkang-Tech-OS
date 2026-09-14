# 20260913-next-optimization-v3 验证报告

## 已验证

- 前端回归：`npm run test:console`，148 passed，0 failed。
- 后端回归：JDK 21 下 `services/massage-api/mvnw.cmd test`，136 tests，0 failures，0 errors，0 skipped。
- 构建：JDK 21 下 `mvnw.cmd clean package -DskipTests`，BUILD SUCCESS。
- 历史补单会员余额烟测：HTTP 200；钱包 110000 分扣减至 94100 分；写入 `MEMBER_BALANCE` 支付记录及 `CONSUMPTION -15900` 钱包流水。

## 发布内容

- 前台历史补单列表/弹窗布局优化。
- 待付款房间卡片文字高对比度优化。
- 技师端仅保留确认接单、确认下钟。
- 技师加钟取消 120 分钟限制，保留 720 分钟总服务上限，新增 V92 迁移。
- 历史补单会员余额按租户共享钱包处理。

## 发布校验

JAR 与 ZIP 的 SHA-256 写入包内 `SHA256SUMS.txt`，并在打包后使用 `sha256sum -c` 校验。
