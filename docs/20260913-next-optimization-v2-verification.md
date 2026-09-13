# 20260913-next-optimization-v2 验证报告

## 验证原则

发布包以当前完整工作树为输入；下面只记录本机实际运行的命令和结果。前端测试使用仓库现有 Node 测试套件，后端使用 JDK 21 和 Maven Wrapper。

## 可重复命令

```text
npm run test:console
node --check apps/massage-console/app.js
node --check apps/massage-console/daily-report.js
node --check apps/massage-console/manager-mobile.js
node --check apps/massage-console/technician-service-worker.js
services\massage-api\mvnw.cmd -f services\massage-api\pom.xml test
services\massage-api\mvnw.cmd -f services\massage-api\pom.xml clean package -DskipTests
powershell -ExecutionPolicy Bypass -File tools/release/package-full-optimization-20260912.ps1 -Version 20260913-next-optimization-v2
```

## 验证结果

| 检查 | 实际结果 |
| --- | --- |
| JS 语法 | 4 个核心脚本 `node --check` 退出码 0 |
| 前端全量回归 | `npm run test:console`：148/148 通过，失败 0 |
| 后端全量测试 | JDK 21 + Maven：134/134 通过，Failures 0、Errors 0、Skipped 0，`BUILD SUCCESS` |
| 完整构建 | `clean package -DskipTests`：`BUILD SUCCESS`，JAR 来自当前工作树 |
| 充值渠道回归 | 日报渠道测试覆盖订单净额、充值净额、充值退款原渠道冲减和 JSON 字段序列化；定向测试 17/17 通过，并包含在全量 134/134 中 |
| 历史补单 UI | 桌面预览检查确认日期/会员分行、项目卡片、技师分配、金额和支付方式无重叠；窄屏规则已通过静态检查 |
| 工作树检查 | `git diff --check` 退出码 0（仅有现存 LF/CRLF 提示） |
| 包内清单 | 最终 ZIP 解压后逐项重算 `SHA256SUMS.txt`：90 个业务文件、连同清单共 91 个文件；清单不包含自身，且无临时预览文件 |

## 交付校验

本轮 clean package 生成的 JAR SHA-256：

```text
3CE22F72FB52234E03CE45A2A3567DEC75BA325EBDB146E71A25296746A575A3
```

ZIP SHA-256 以最终打包命令输出为准，并在交付记录中报告；包内清单不写入 ZIP 自身哈希，避免自引用。清单已覆盖 90 个业务文件，连同 `SHA256SUMS.txt` 共 91 个文件。

## 残余风险

资源竞争返回业务 409 属于预期并发保护。线上部署仍需先完成数据库、JAR、静态资源、附件和外部配置备份；代码回滚不等于数据库迁移回滚。
