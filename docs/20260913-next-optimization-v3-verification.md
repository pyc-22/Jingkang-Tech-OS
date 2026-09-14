# v3 验证报告

## 已执行

- `node --check apps/massage-console/app.js` 通过
- `node --check apps/massage-console/mobile.js` 通过
- `node --check apps/massage-console/manager-mobile.js` 通过
- `npm run test:console`：148/148 通过，0 失败
- `git diff --check` 通过

## Maven

`services\\massage-api\\mvnw.cmd -f services\\massage-api\\pom.xml test` 在当前环境失败：检测到 JDK 17，而项目要求 Java 21（source release 21）。需切换 JDK 21 后重跑。

## 本版本改动

- 历史补单列表及弹窗布局、响应式间距与表格可读性优化。
- 历史补单会员余额使用租户共享钱包并保留门店/营业日流水归属。
- 待付款房卡技师与项目文字提升为高对比度。
- 技师端废弃拒单、转单、意向加钟、加钟、换房接口统一返回 403，前端入口移除。
- 技师加钟取消 120 分钟累计限制，仅保留 720 分钟总服务时长上限；新增 V92 迁移。
