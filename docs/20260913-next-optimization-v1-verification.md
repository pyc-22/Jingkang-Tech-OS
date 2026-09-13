# 20260913-next-optimization-v1 验证报告

## 验证原则

发布包以当前完整工作树为输入；下面只记录本机实际运行的命令和结果。API 烟测使用隔离 PostgreSQL 16（端口 55439）和临时 API 端口 58093，未触碰系统 PostgreSQL 5432；服务已在验证结束后停止。

## 可重复命令

```text
node --check apps/massage-console/app.js
node --check apps/massage-console/mobile.js
node --check apps/massage-console/manager-mobile.js
node --check apps/massage-console/technician-service-worker.js
npm run test:console
services\massage-api\mvnw.cmd -f services\massage-api\pom.xml test
services\massage-api\mvnw.cmd -f services\massage-api\pom.xml clean package -DskipTests
powershell -ExecutionPolicy Bypass -File tools/release/package-full-optimization-20260912.ps1 -Version 20260913-next-optimization-v1
```

## 验证结果

| 检查 | 实际结果 |
| --- | --- |
| JS 语法 | 4 个核心脚本 `node --check` 退出码 0 |
| 前端全量回归 | `npm run test:console`：147/147 通过，失败 0 |
| 后端全量测试 | JDK 21 + Maven：131/131 通过，Failures 0、Errors 0、Skipped 0，`BUILD SUCCESS` |
| 完整构建 | `clean package -DskipTests`：`BUILD SUCCESS`，JAR 来自当前工作树 |
| 健康检查 | `/api/health` HTTP 200，release 为 `20260913-next-optimization-v1` |
| 打卡门禁 | 未打卡批量派钟 HTTP 403；打卡成功后可继续流程 |
| 历史补单 | 未授权店长 HTTP 403；授权后两项目、三技师、现金+微信补单成功，补单日为 2026-09-12 |
| 退款/日报 | 整单退款成功，退款营业日保持 2026-09-12；日报 sales=18700、refund=18700、net=0 |
| 独立派钟 | 批量创建两条服务单，分别为 QUEUE/Extension A/30 分钟和 CALL/Extension B/45 分钟，使用不同床位和项目 |
| 包内清单 | `SHA256SUMS.txt` 解压后逐项重算，覆盖全部成员文件，无缺失、额外项或哈希错误 |
| 工作树检查 | `git diff --check` 退出码 0（仅有现存 LF/CRLF 提示） |

## 交付校验

本轮 clean package 生成的 JAR SHA-256 为 `6ED4AE83629642BDD7BE265286B3D86ADD37F2532E4D3BF64C596CCFD39B7A6F`。ZIP SHA-256 以最终打包后独立计算结果为准，并在交付消息中报告；不把 ZIP 自身哈希写入包内，避免自引用。`SHA256SUMS.txt` 不包含自身哈希，清单覆盖包内其他全部文件。

## 残余风险

资源竞争返回业务 409 属于预期并发保护。线上部署仍需先完成数据库、JAR、静态资源、附件和外部配置备份。
