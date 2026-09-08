# 部署目录

- `.env.production.example`：生产环境变量模板，不包含真实秘密。
- `start-production.ps1`：本机首次部署验证入口；长期运行请注册系统服务。
- `nginx/massage-platform.conf`：HTTP 跳转 HTTPS、静态页面和 API 反向代理模板。
- `DEPLOYMENT.md`：兼容入口，权威说明位于 `docs/deployment.md`。
- `releases/`、`package/`：历史发布包和数据库备份，保留原位但不是源码。

其他日期命名目录、补丁和临时验收包属于历史运维材料。未经归档、哈希核验和恢复确认不要删除，也不要把它们作为当前构建输入。