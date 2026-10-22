# 后台账号密码直登

用户授权取消 `admin.dcelysion.cn` 的 Cloudflare 邮箱关卡，不强制二步验证。后台继续使用现有 Waline 管理员账号；`ADMIN_REQUIRE_TOTP=0` 保持不变，已绑定验证器的账号仍遵循 Waline 自身验证规则。

## 已实施

- Access 应用 `3b5a6961-e7a2-478b-b56c-bcf8e84d9628` 新增 `Admin native password login` Bypass Everyone 策略，ID `80a1cc8e-2917-4878-ab2b-db6b0ea0e1c7`。原邮箱 Allow 策略保留以便回滚。
- Tunnel `bcb4cdd4-fbe7-4d82-939f-023ca84b56ba` 配置版本 3，仅将后台 ingress 的 `originRequest.access.required` 改为 `false`；Memos ingress 保持不变。
- `deploy/tencent/nginx-admin-access.conf` 的旧 `/ui/`、`/waline-api/`（含 token/reset location）增加 `auth_request`，通过内部 GET `/api/me` 验证现有后台 Cookie。未登录不能绕过后台会话直接访问旧管理接口。
- `/waline-api/db` 及子路径返回 404；认证子请求入口为 internal。
- 源站继续仅监听回环地址，后台现有会话、管理员身份检查及登录限流保留。

## 验证与限制

Nginx 配置检查通过；源站首页 200、未登录后台及旧管理接口 401、内部认证入口和数据库接口 404。公网首页已从本机及服务器确认 200，无 Access 重定向。真实账号成功登录、已登录旧管理页和退出后的浏览器体验由用户验收，未代替用户输入密码。

现有限流按后端连接地址计算，代理后的访客可能共享失败次数；本次未修改应用限流算法。旧 OAuth 回调还受后台 SameSite=Strict Cookie 限制，本次未验证该流程。

## 回滚

先删除上述新增 Bypass 策略以恢复邮箱关卡，再将后台 Tunnel ingress 的 `access.required` 恢复 `true`（保留当前其他 ingress）。如需恢复 Nginx，原文件备份为 `/etc/nginx/sites-available/dcelysion-admin-access.before-password-login-20261022`，恢复后执行 `nginx -t` 并 reload。无需变更账号、密码、数据库或二步验证绑定。

本次未获 Git 提交或推送授权，源码改动保留本地。
