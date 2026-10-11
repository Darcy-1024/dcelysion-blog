# 2026-10-11 Waline 头像上传上线记录

用户授权本次 GitHub 推送和腾讯服务器部署。新增流程为点击头像或「上传头像」→选择本地文件→方形预览→确认保存；支持 10 MB 内的 JPG/PNG/WebP/GIF，浏览器转换为 256×256 静态 PNG。头像保存在 Waline PostgreSQL，评论域规范链接在私有后台通过同源代理显示，不改变 Access 或公开评论开关。用户另行授权记住 SSH 私钥路径，路径仅存本地记忆，不复制私钥进项目。

## 部署结果

- 功能提交 `be6b7fed` 已推送 `master`。本记录与 ThinkJS 成功响应控制流修复同次提交；成功响应移出存储异常捕获，避免框架的停止处理信号被误报成 503。
- 当前服务 `dcelysion-waline-1`，镜像 `dcelysion/waline-avatar:20261011-v1`，镜像 ID `sha256:92f2dbe0c6b65b1652b1fd3b5ad0ffb4d0eff2e7b0e7b85ffa34d7ab2ab70d25`。基于当时运行镜像 `sha256:1fffeb988fa7a5eb437d366a4a7a1ea1f4deacc102d5fe57415b3054976a7cb7` 增量构建，仅增加头像控制器、逻辑、图片/存储模块及三条翻译；现有登录、找回密码、QQ 绑定覆盖层保留。
- 仅更新 `/opt/dcelysion/compose.yaml` 的 Waline 镜像行；数据库、找回服务和统一后台没有重建。Waline 仍仅映射 `127.0.0.1:8360`。
- Waline 数据库安装 `004_user_avatars.sql`；正式表初始化为零行，未替真实用户上传测试头像。
- 运行中的 comments-private 和 admin-access Nginx 配置按原文局部加入脚本注入，未整体覆盖；`nginx -t` 和 reload 成功，QQ 回调改写与现有限流保持。原 `nginx-admin-access.conf` 属于其他未提交阶段，此次没有把该未跟踪文件整体纳入 Git 提交。
- `/srv/dcelysion/admin-assets/avatar-upload-v1.js` SHA-256 为 `0d29720388516110d33e8b136e5c726e80e77347cb525244e31017b9137e64b8`，通过私有后台 HTTP 回读与本地文件一致。

## 验证

本地七项定向测试覆盖预览取消、失败重试、成功刷新、令牌同源保护、私有头像 URL 映射、图片校验、ThinkJS 控制流及 PGlite 事务。使用服务器独立库 `dc_avatar_it_20261011` 和合成 guest 账号完成真实登录、PNG 上传、图片字节回读；匿名401、非法图片400、重复上传429及封禁账号401成立。没有使用、伪造或修改正式账号会话。

正式 `/ui/profile` 200，HTML 同时含新脚本和同源 `waline-api` 地址；脚本回读200及摘要匹配；匿名头像上传401、统一后台匿名401、旧改密路径410、错误 Host421。正式用户/评论行数及整行指纹在部署前后相同。公网未登录访问 `https://admin.dcelysion.cn/ui/profile` 为 Access302。

真实账号在浏览器选择头像并确认保存仍待用户本人验收。本次浏览器连接工具没有取得可用 Edge 页面，不能把 HTML 回读或隔离测试说成真实用户浏览器验收。

`be6b7fed` 的 GitHub Build and Check、Code quality、GitHub Pages 和共享公共构建均成功；公共平台的其他自动部署需分别以平台结果为准。未部署 OpenAI Sites。

## 备份与回退

部署根和证据位于服务器 `/opt/dcelysion/config-backups/avatar-upload-20261011`（0700），含原 compose、两个 Nginx 配置、Waline dump、prepare/activate JSON 证据及受保护的隔离环境文件。部署前 dump 通过 `pg_restore --list`，SHA-256 为 `e9b83b858b0323494458f901784e296e67ffc7771c8ac1ced0a24e0c5ba47bb9`。上线后 `dc-admin-backup.service` 再次运行，Result=success、ExecMainStatus=0。

两个本任务隔离容器已停止，独立测试库和证据保留；未清理现有服务镜像、数据库或媒体。以下为回退说明，非现在执行指令：先保全现状及已上传头像，恢复本次备份的 Nginx 配置和 compose，检查 `nginx -t`，仅重新启动 Waline并 reload Nginx；保留头像表，不恢复整库、不轮换 JWT、不回退用户密码。若部署后存在其他配置变更，应只撤销本次脚本注入和镜像选择。
