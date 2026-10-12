# 阶段二：正式后台、持久存储与 Access 交接

日期：2026-10-11。当前阶段二部署及正式管理员登录完成，正式业务流程验收仍有待确认项，不能标为全部通过。未开始阶段三，未提交/推送 Git，未执行 Sites；其他对话的提交和任务外差异保留。

## 最新范围及身份

- 用户明确跳过 MDX，未再执行用户 MDX。依赖它的预览、在线构建及发布保持不可用，私有保存可独立运行。
- 用户明确“不用两步验证了”。正式 `ADMIN_REQUIRE_TOTP=0`：Access 邮箱 OTP + 正式 Waline owner 密码。没有修改用户密码或绑定密钥。
- Access 白名单为 `dcelysion@gmail.com`、`lin507793465@gmail.com`，只授权进入登录页。正式 owner 为 Waline id=1、邮箱 `dcelysion@gmail.com`、昵称 `DcElysia`、administrator、auth_version=1、TOTP 未启用。
- 截图中的“东方未晞”为 id=2、`lin507793465@gmail.com`、guest，不能登录统一后台。账号验证失败也使用统一错误，不等于密码本身已被证实错误。不得自动提升普通用户或沿用测试 owner。

## 候选与代码

正式完整候选包 9151138 字节，SHA256 `f3fa160c9edf6f069ba76cbaa854d7077e89624b4681568ae3618acc64e92981`，142 项。本地 `cache/launch-stage2-20261011/formal-admin-candidate.tar.gz`；远端 incoming 位于 `/home/ubuntu/dc-admin-private-20261002/launch-stage2-20261011/`。正式 release 为 `/opt/dcelysion-admin-stage2/releases/20261011-stage2`。

输入快照 HEAD `a1398fb1`，248 文件，输入摘要 `a02dacf8ea14c125edabda7480fdb30b34a5d9f42aef7ade0183b9c23e3fdd92`。此后其他对话可以推进 HEAD，不能把该候选说成实时匹配最新全库。

本阶段改动：`admin/server/{config,auth}.ts` 可选强制 TOTP 及会话权限检查；`admin/tests/foundation.test.ts` 定向认证用例；`admin/client/i18n.ts` 明确 MDX 暂停；`deploy/tencent/admin-unified.env.example` 正式域名及无强制 TOTP；`build-admin-candidate.mjs` 校验依赖元数据/锁文件而允许任务外 scripts 差异；新增 `nginx-admin-access.conf`、`admin-stage2-backup.py`。

可信固定 rootless 构建，无网络/秘密/用户 MDX：TypeScript、Svelte 检查 0 错误 0 警告、前后端构建、Sharp 转换通过。随后追加的 PGlite 测试在 512MiB 容器内 OOM，没有声称全套测试通过。独立认证定向测试 1/1 和五个受影响文件 Biome 检查通过；已成功构建产物校验 manifest 后复用打包，没有拼旧 index。

## 正式服务和网络

正式根 `/opt/dcelysion-admin-stage2`，OWNER `dcelysion-admin-stage2-20261011`。runtime/operator 文件受保护，含秘密，不复制到交接或聊天。

- `dc-admin-formal`：固定 Node 镜像 `sha256:1fffeb988fa7a5eb437d366a4a7a1ea1f4deacc102d5fe57415b3054976a7cb7`；512MiB、0.5CPU、128PID，uid1000，只读根、无 capabilities、no-new-privileges。仅 `dcelysion_database` internal 网络，预留 `172.18.0.7:4322`，**没有宿主 backend 端口映射**。更新/回退前核实 IP 和 nginx 配置，不使用早期 14322 描述。
- Node `waline-loopback.mjs` 仅将容器 loopback8360 转发到固定正式 `waline:8360`，然后加载完整后台。
- `dc-admin-r2-egress`：64MiB、0.15CPU、32PID，内部网络与 outbound 网络相连，仅固定账户 R2 TLS 端点透传，无凭据及任意 CONNECT。后台任意公网请求拒绝，固定端点经内部 alias 可达且 TLS 验证通过。
- `dc-umami` 增加内部数据库网络，保留原网络；后台从 `http://dc-umami:3000/api` 读取，凭据仅服务端。
- nginx 私有入口 `127.0.0.1:18445`，Host 不匹配421；根代理内部后台，`/ui/` 为既有 Waline 界面，serverURL 改为同域 `/waline-api/`；旧 `/waline-api/user/password` 返回410。全 hostname 均由 Access/Tunnel JWT 校验覆盖。私有访问日志关闭，错误日志使用 crit，防止日常限流日志记录 OAuth state URL；现存私有错误日志权限0600。
- connector `dc-admin-cloudflared.service`，nobody/nogroup，128MiB、CPU25%、Tasks64，ProtectSystem strict、ProtectHome、PrivateTmp；token 仅 root:nogroup0640 文件。cloudflared2026.10.0 官方二进制 SHA256 `d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db`。

## Cloudflare 资源

账户 `25d4e6f2e01c0cde639588a28d13814d`，zone `1cea6693a8c06688eadb1b6abc50067b`。官方 MCP 完成创建和回读。

| 资源 | 标识及配置 |
| --- | --- |
| Organization | team `broken-mode-4c7c`；auth domain `broken-mode-4c7c.cloudflareaccess.com` |
| OTP IdP | `12e1715a-d74f-4448-9f84-f6dd51080ee1`，DcElysion Email OTP |
| Access app | `3b5a6961-e7a2-478b-b56c-bcf8e84d9628`，DcElysion Private Admin，整个 admin hostname，8h，HttpOnly，SameSite Lax |
| Allow policy | `68b9dfa1-b8e1-4fb3-b5e7-de13b58766d0`，仅两个精确邮箱，require OTP IdP，无 bypass/everyone/service token |
| AUD | `cc21c1feba6c04973a2a19ef68040677f8d838ba292a8f25c6de391d04210ace` |
| Tunnel | `bcb4cdd4-fbe7-4d82-939f-023ca84b56ba`，dcelysion-admin-stage2，远程配置，healthy，4 connections |
| Ingress | admin → http://127.0.0.1:18445，Host admin，access.required=true，team/AUD 精确匹配；最终404 |
| DNS | `0d454dedfa09c33526cf17efd359bc8d`，仅新建 proxied CNAME admin → tunnel UUID.cfargotunnel.com |

## 持久存储与权限

现有 PG 容器 `dcelysion-postgres-1` 中新建独立正式库 `dc_admin`，001–007 迁移已完成，八表 sessions/audit/drafts/draft_saves/media/media_refs/jobs/job_logs。runtime 与 migrator 分离，runtime 无 DDL，正式初始化 drafts=0，未复制测试库。

Waline reader 仅可读 `dc_admin_waline_reader.wl_users` live view，owner 为 waline；投影 id/display_name/type/auth_version 和 TOTP 布尔标记，不暴露密钥。reader 原表列权限已撤销，固定 search_path `pg_catalog,dc_admin_waline_reader,pg_temp`。实际 TCP 验证原始 TOTP、密码、写入、DDL 均拒绝。

private/public 媒体目录 uid1000、0700，状态 journal 独立；当前内容快照以只读 repository 挂载，保存只进入 PG 私有草稿。四用途 R2 固定桶/域名保留，私有桶 r2.dev=false、custom domains=[]。腾讯额度 journal 独立，64KiB/s、80GB/月，核对交付量0；未切换公开媒体策略。

## 验证证据及待确认

- 隔离候选真实合成账号 + TOTP 登录、原文草稿 revision3→4 保存回读、私有媒体读取、匿名401、真实 Umami PV/UV/visits 各17、发布503通过；这些是隔离证据，不替代正式账号业务验收。
- 正式 nginx root200、错误 Host421；匿名 `/api/me`、analytics、library、content、publishing 均401；profile serverURL 重写正确；数据库权限拒绝成立。
- 公网 root/API 未登录跳转 Access302。用户截图已证明正常浏览器通过 Access。官方 Access 日志记录 `lin507793465@gmail.com` allowed=true；另一白名单及非白名单实际测试仍未完成。
- 用户最初报告“已成功登录”没有确认为统一后台；后续截图显示连接失败。取消 TOTP 后服务就绪，私有登录接口无效账号正常401 JSON；用户刷新后错误变为账号验证失败。核查“东方未晞”为 guest。此前多次失败触发15分钟限流，以重启唯一后台清除临时状态，未放宽限流。用户随后用正式 owner 登录，明确回复“成功进入后台”；数据库证实 activeOwnerSessions=1、login success=1。正式无 TOTP 登录已验收。
- 本机直连/代理部分网络探测失败；截图证明用户正常浏览器可达。服务器内部端口/网络约束、Access required 配置、wrong Host421 已验证；不能将本机 timeout 单独作为全网源站绕过拒绝的证明。
- 正式用户已创建草稿 `1fad0c3b-6c2c-49ac-87fe-1f9ea5c775db`，数据库回读 revision=3、confirmedSaves=2、6014字节、source=base_source 原文一致；用户界面重新打开结果仍待确认。
- 用户上传相册图片 `140162004_p0.jpg`，9.63MiB、5760×3240，媒体 `9be1570b-1b43-408c-8bad-b6987bd4408e`。2026-10-11 北京时间18:24:41开始、18:27:25首次同步完成，local=ready、privateCopy=ready、stage=private_verified、error=null。真实受限 R2 私有同步及完整内容校验通过，未公开。
- 正式登录后的真实统计读取、第二个白名单/非白名单 Access 实际测试仍待确认。不得用人工伪造正式 session、测试账号提升、配置正确或隔离结果代替。
- 用户截图也确认 `/ui` 原 Waline 管理界面以 DcElysia 登录、历史评论可见。LeanCloud 停服横幅与当前 PostgreSQL 存储无关；上游版本提醒另作维护，当前自有镜像有认证/密码找回覆盖层，不能直接替换。官方 https://github.com/walinejs/waline/releases 的1.43系列已抽出服务端核心结构，升级需保留自有改动并验证兼容。

### QQ 绑定阻断修复

用户绑定 QQ 遇到 Nginx429。原 `/waline-api/` 全路径共用6次/分钟限流，资料/评论加载会消耗认证额度；现仅 token 与 password-reset/request、confirm 使用原限流，普通资料/OAuth 不共用这项额度。后台 Access 及 Waline 身份检查保持。

实际 Waline SERVER_URL 为 comments 域，默认 QQ 授权 Location 回调到 `comments.dcelysion.cn/api/oauth`。本任务私有代理通过 Nginx `proxy_redirect` 仅匹配固定 OAuth provider `https://oauth.lithub.cc/` 及固定旧回调，改成 `https://admin.dcelysion.cn/waline-api/oauth`；保持其余 query/state、Waline 正式镜像及公共评论域不变。语法依据 https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_redirect 。没有读取、打印或替用户提交真实 state/QQ 授权。

nginx -t、reload 完成。reload 后首个立即探测仍由旧 worker 响应，稍后独立定向验证通过：8次无 state 的 QQ 入口请求均302、回调域/路径/type精确匹配；匿名私有API401、错误Host421。未重复后台构建或MDX。保护备份 `/opt/dcelysion-admin-stage2/operator/nginx-before-oauth.conf`，验证记录 `oauth-nginx-verification.json`。用户实际 QQ 授权后回复“已成功”；数据库仅布尔回读确认 QQ 绑定在 Waline id2“东方未晞”（guest），id1 DcElysia 管理员未绑定。未读取或打印QQ标识，没有移动绑定或提升权限。重新执行备份成功。QQ 绑定不会自动为统一后台添加第三方登录接口。

## 备份与恢复

每日 `dc-admin-backup.timer` 于北京时间03:40（UTC19:40），Persistent=true；service 内存128MiB、CPU20%。脚本备份 dc_admin、waline 与私有目录/journal/operator/runtime 配置，0600/0700；每次 pg_restore --list 检查，manifest 记录大小及摘要。初次 `/opt/dcelysion-admin-stage2/backups/20261011T100922Z`，reader/no-TOTP 改动后再次运行成功，目录 `20261011T101802Z`；dc_admin dump SHA256 `4c5fe53766416bb8ad28c11ba8695ab5abbd09a75580b0f91f7c8e160483f89f`，waline dump `f2672ac3067d7c13fd008f1fa0d7e445a062d7d95a9a3f9e9b1e197568997eb9`。

当前为同机备份，无已验证的异机正式恢复演练。归档含配置秘密，不能公开、下载到内容目录或贴日志。以下仅为**恢复步骤说明，不是现在执行授权**：

1. 停止后台 worker，并复制当前状态到新的受保护目录；保持旧库/目录不覆盖。
2. `docker exec -i dcelysion-postgres-1 createdb -U waline dc_admin_recovery_YYYYMMDD`；将选择的 `dc_admin.dump` 通过 stdin 给 `docker exec -i dcelysion-postgres-1 pg_restore -U waline --exit-on-error -d dc_admin_recovery_YYYYMMDD`。
3. 校验表数、会话/草稿数据及 runtime grants；恢复 private-state 到新的0700 staging 根，仅核对并选择必要媒体/journal。不能把旧 runtime.env 自动覆盖现在的部署。
4. Waline dump 也只恢复到新具名库演练；正式账户恢复需独立确认，禁止覆盖已有用户或盲目降迁移。
5. 确认新环境后按受保护配置切换后台，复核匿名拒绝和 owner 登录。失败保留新状态并退回原配置。

## 回退及后续

停止的 `dc-admin-formal-before-no-totp` 保留了取消 TOTP 前容器（当前与 internal 网络断开）；`operator/runtime.before-no-totp.env` 为旧配置。回退到它会恢复强制 TOTP、与当前用户选择冲突，不能盲目执行。操作前保全当前 runtime/private 状态，停唯一写 worker，核对内网 IP、挂载和 nginx，再恢复选定版本；不覆盖正式库或媒体。

隔离三个测试容器及原候选回退容器仍保留，未 prune/delete 卷。若需要撤销 admin 暴露：仅停 `dc-admin-cloudflared.service`，保留 Access policy；在官方 MCP 备份资源后移除/恢复本任务 admin CNAME，不能删除无关 DNS 或改主站。nginx 单独恢复本任务配置、nginx -t 后 reload；PG 不做逆向迁移。

阶段三应在独立新对话获得用户开始指令后执行，携带总计划、阶段一/二交接及当前待验收项。MDX 仍跳过、评论仍隐藏、根域主页由独立项目处理，媒体公开选路尚未在此阶段切换。
