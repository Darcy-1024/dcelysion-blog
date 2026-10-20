# 后台内嵌与统一登录凭据桥

更新：2026-10-21。用户已选择“独立作者凭据桥”：保留原版 Memos v0.31.0，不增加独立身份服务，服务器保管普通作者密码。真实 PRIVATE 实例、普通作者 `users/dcelysion`（USER）及后台网关已部署，注册关闭。真实浏览器统一登录、上传及退出联动仍在联调，不能把部署/匿名401称为验收通过；后续结果见 [生产验收报告](../../docs/plans/2026-10-21-memos-production-acceptance.md)。

## 为什么需要桥接

固定版本的 [SignIn 协议](https://github.com/usememos/memos/blob/v0.31.0/proto/api/v1/auth_service.proto)只有密码或OAuth2授权码登录，没有交换现有后台cookie的接口。[OAuth2实现](https://github.com/usememos/memos/blob/v0.31.0/provider/idp/oauth2/oauth2.go)并不是完整的发现/联邦注销服务。[认证实现](https://github.com/usememos/memos/blob/v0.31.0/server/auth/authenticator.go)不接受可信代理用户名头；[注销实现](https://github.com/usememos/memos/blob/v0.31.0/server/api/v1/auth_service_session.go)清除refresh会话，也不能替代对既有短期access JWT的即时入口撤权。

因此不是把 iframe 显示出来就叫统一登录。已有后台 `AuthService.verify()` 每次检查会话有效期/撤销、指定Waline owner、管理员角色和auth_version，按已有配置检查2FA状态；桥接复用此裁决，不修改原登录/2FA流程，不共享密码哈希、Cookie签名密钥或Waline密码。

## 已实现的数据流

1. 后台“动态 · Memos”独立页面保留原导航和原仓库动态入口。读取受保护 `/api/memos`；未配置时显示说明，配置了来源但桥关闭时明确显示统一登录待完成，不降级为独立Memos登录。
2. 已登录后台使用同源 `POST /api/memos/entry`，经过既有cookie及精确Origin检查，获取30秒单用随机票据。浏览器以表单POST票据到独立Memos来源的 `/_bridge/entry`，票据不写URL。
3. 独立回环网关再次验证后台会话，服务端用独立作者密码调用官方REST SignIn。严格核对Memos `user.name`、username及角色`USER`，错误作者或ADMIN拒绝并清理会话。
4. Memos refresh cookie仅保留服务端。浏览器得到host-only、HttpOnly、Secure、SameSite=Strict的随机桥cookie；它关联原后台会话，不是后台cookie或固定Memos token。
5. 原版前端启动所需的Connect RefreshToken按v0.31.0字段返回真实短期accessToken（protobuf unary或JSON），服务器轮换refresh并复核作者。浏览器可能看到**当前会话原生短期accessToken**，原版[auth-state](https://github.com/usememos/memos/blob/v0.31.0/web/src/auth-state.ts)会将其写入localStorage；不能称令牌只在浏览器内存。浏览器不会得到同步PAT、作者密码或固定管理员token。每个后台入口会话使用独立Memos会话。
6. HTML、静态、REST、`/memos.api.v1.*` Connect、附件、分享和新窗口全部经过网关逐请求 `verify()`。浏览器提交的Bearer/PAT及Memos refresh cookie被剥离，代理使用该后台会话对应的服务器令牌。本地Memos登录、用户/PAT/身份管理等不在写作所需范围的接口被拒绝，不能从UI切换到其他作者或管理员。
7. 后台成功退出/撤销/过期后，新请求即拒绝；Memos自身SignOut也注销桥会话。上游refresh撤销是额外清理，即使清理失败，网关仍拒绝。进程重启不恢复桥内存会话，需要从后台重新进入，原作者数据不删除。

原版UI使用 [Connect](https://github.com/usememos/memos/blob/v0.31.0/web/src/connect.ts) 与 [AuthContext](https://github.com/usememos/memos/blob/v0.31.0/web/src/contexts/AuthContext.tsx)，所以实现覆盖Connect而不只代理REST。Memos的[分享ACL](https://github.com/usememos/memos/blob/v0.31.0/server/api/v1/acl_config.go)和[附件分享令牌](https://github.com/usememos/memos/blob/v0.31.0/server/fileserver/fileserver.go)也必须经过外层会话门禁，不能仅依赖实例PRIVATE设置。

真实镜像联调发现官方 REST SignIn 返回200时，refresh cookie 可能位于 `Grpc-Metadata-Set-Cookie`，而不是普通 `Set-Cookie`。桥接已补该固定版本响应差异的解析和协议测试；仍需校验 cookie 名称/属性和作者身份，不能仅凭登录200创建可用桥会话。此修复的生产升级及浏览器结果另见验收报告。

## 配置与维护

[环境样例](admin-memos.env.example)默认 `ADMIN_MEMOS_BRIDGE_ENABLED=0`。只有明确启用才创建第二个HTTP listener；默认回环4324。`ADMIN_MEMOS_ORIGIN`是独立受信HTTPS纯来源，不能带路径、凭据或票据。生产已设置 `https://memos.dcelysion.cn` 并启用桥，网关无宿主机端口映射。

[私有作者配置样例](author.example.json)只能在服务器外部私有目录填写，0600且拒绝symlink/junction，禁止入Git。正式作者配置已创建并只读绑定到后台容器；普通作者与同步器的 `users/dcelysion` 一致，管理员仅用于初始运维。密码轮换后关闭旧桥会话/重启后台，从后台重新进入；备份该私有配置，桥会话/ticket不持久化、不写日志。同步 PAT、作者密码与发布 SSH key 分别保管，不能互换。

现有 `dc-admin-formal` 在 `dcelysion_database` 网络，固定 IP172.18.0.7，容器 Node 为v24.20.0，宿主机 PATH 没有 Node 命令。**后台容器127.0.0.1不等于宿主机127.0.0.1**。[compose.bridge.yaml](compose.bridge.yaml) 已用于生产：Memos 只加入新建的 `dc-memos-private` 内部网络、别名 `dc-memos-origin`，后台额外接入该新网，Memos 不进入数据库旧网。

桥上游只接受精确回环HTTP来源，或唯一专用别名 `http://dc-memos-origin:5230`，不允许任意私网主机/路径。正式容器已显式设置 `ADMIN_MEMOS_GATEWAY_HOST=0.0.0.0` 与 `ADMIN_MEMOS_GATEWAY_CONTAINER_ONLY=1`；4324 没有宿主机端口映射。Nginx 仅监听回环 `127.0.0.1:18446`，转发到后台私有 IP:4324；非容器档仍使用回环。

正式 DNS/tunnel 已将整个 Memos 来源交给回环18446网关，包括 `/api/*`、`/memos.api.v1.*`、`/file/*`、分享、HTML和静态；没有部分路径直达5231。原始源站由内部网络与回环 Nginx 限定服务器访问，不能通过公网主机端口/其他域名绕过。后台域名原 Cloudflare Access 配置保留；Memos 域名没有独立 Access 应用，逐请求后台会话检查是其入口门禁，不能用可伪造身份头登录。

## 浏览器与资源边界

- 后台CSP仅精确增加该来源的frame-src；启用桥后精确增加form-action，保持后台自身frame-ancestors none、X-Frame-Options DENY等保护。Memos网关只对该隔离来源将frame-ancestors设为具体后台来源，保留其余上游CSP指令，去掉冲突XFO；不能全局放开任意站点嵌入。
- 票据表单不能受no-referrer导航策略导致的Opaque Origin影响。桥启用时后台使用strict-origin，只传来源、不传路径；新窗口使用noopener。入口仍严格拒绝Origin null/其他来源。实际浏览器的POST Origin、Cookie、Access跳转和CSP组合尚未验收。
- 建议后台与Memos使用同站点的HTTPS兄弟域名。host-only Cookie不改成父域共享；第三方Cookie限制、跨站Strict Cookie、Access登录页自身frame策略可能阻止嵌入，必须实测。新窗口入口使用同一票据/网关，不能作为绕过登录的直达源站入口。弹窗拦截行为需浏览器核对。
- iframe没有把onload当作登录/服务正常证明。空白/故障时有说明及重载/新窗口入口；跨域内部状态不可可靠探测。离开或重载前提示确认已在原版Memos保存。桌面/手机采用独立滚动视口，但软键盘、滚动和真实上传/下载仍待验收。
- 请求默认20MiB、响应64MiB、8个并发、15秒上游超时，响应有界缓冲并在发送前复核会话。理论缓冲占用仍可能显著（8×64MiB响应，另有请求/解码开销）；这不是内存实测。与Memos384MiB试用上限、Sharp编码及共享主机余量一起测量，不能默认足够，不自动提高额度。大导出/长连接/流式RPC不承诺支持。
- 网络撤权只能阻止后续请求和尚未发出的响应，不能收回已送达浏览器的正文/图片、清空另一窗口的已有页面或抹除浏览器历史。没有用销毁iframe冒充后端注销。

## 必须继续的真实验收

固定镜像已真实启动，REST SignIn 的 metadata cookie 差异已定位。仍需完成 SignIn/refresh/SignOut 与 Connect 实际流量、refresh-cookie属性及作者身份核对；验证无需二次输入 Memos 密码、手机多图上传/下载、编辑/退出/过期/撤销/2FA失效、直接 HTML/API/Connect/附件/share token/旧 access token 绕过拒绝。实际响应 CSP/XFO、反代路由、TLS、Cookie、登录跳转及新窗口也须按真实流程确认。历史协议测试使用 HTTP fixture 手工携带逻辑 HTTPS 头及 Cookie，**不能证明真实浏览器会接收 Secure/Strict cookie 或原版 Memos 兼容性**；真实结果只以生产验收报告为准。

启用桥与启用自动发布是不同授权。只启用桥不会自动提交/推送；独立发布适配仍默认关闭，见 [PUBLISH.md](PUBLISH.md)。
