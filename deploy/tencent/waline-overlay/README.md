# DcElysion Waline overlay

基于腾讯固定 **Waline 1.41.6**（镜像摘要见 `../Dockerfile.waline-reset`），与管理客户端 **0.34.2** 配套。基础鉴权、昵称、通知和找回密码部署边界见 `../README.md`。本目录源码覆盖同版本镜像的 `/app/src/`，不升级上游。各功能安装状态以对应上线记录为准，头像上传见[2026-10-11 上线记录](../../../docs/plans/2026-10-11-avatar-upload-release.md)。

## 登录账户内容点赞（2026-10-18 后端已部署）

`005_content_likes.sql` 新建账户与路径唯一的 `dc_content_likes`；2026-10-18 已按用户推送部署授权完成生产迁移及增量镜像切换。GET `/api/content-like?path=/posts/example&offset=0` 公开读取点赞数与每页20位点赞者；可选当前 Waline Bearer 会话用于返回本人 `liked`。POST 同一地址，JSON `{ "path": "/posts/example", "liked": true }` 设置点赞，`false` 取消；必须登录且属于当前 guest/administrator，匿名、已封禁及过期版本会话不能写入。事务在账户行锁内重新验证 `auth_version`，与封禁、改密等账户变更串行；同一用户/路径重复设置幂等，不会累加。

成功响应遵循 Waline `{ errno: 0, data: { count, liked, users: [{ id, nick, avatar }], hasMore, nextOffset } }`，POST 返回第一页。按点赞时间倒序、用户ID倒序；GET 将 `nextOffset` 作为后续 `offset` 直至 `null`，每页固定20，偏移量限0至9999999。并发新增/取消可能使偏移分页发生位移，前端按用户ID去重，刷新从第一页重读。读取与写入响应使用 `Cache-Control: no-store`，错误分别为400（入参）、401（登录）、405（不支持的方法）、503（存储暂不可用）；不泄露数据库错误。

路径只接受站内绝对 pathname，统一去掉末尾斜杠（根路径除外）、合并重复斜杠并规范化中文编码；拒绝查询串、片段、完整外站地址、反斜杠与控制字符。点赞者昵称和头像读取当前账户值；2026-10-18 头像补全修复已部署：空头像复用 Waline `avatar` 服务，使用账户邮箱、昵称和链接解析，并沿用登录接口的 `avatarProxy` 配置；这些输入只在服务端读取，不进入公开响应。未能取得头像或图片加载失败时，前端保留昵称首字占位。列表与总数仅包括当前有效 guest/administrator，封禁后隐藏，删除账户级联删除记录。公开响应不包含邮箱、IP、令牌或账户版本，亦不接受客户端指定用户ID。

旧匿名 `reaction0` 数量没有可验证的账户归属，继续保留原表和数值，**不迁移、不归属到任何用户，也不与新账户点赞数相加**。回退客户端与镜像即可停止新点赞功能，保留新表避免丢失已保存数据。

定向验证：`node --test deploy/tencent/waline-overlay/content-like.test.cjs`。覆盖路径规范化、匿名拒绝、布尔入参、真实隔离PGlite迁移/唯一约束/分页/撤销/版本失效/封禁/删除级联、公开字段最小化、旧匿名计数保留及ThinkJS成功控制流；不等同于真实生产数据库或HTTP实例联调。

本次另以临时 PostgreSQL 数据库和无公开端口容器通过真实 HTTP 登录、点赞/取消幂等、匿名401、非法入参400、旧会话401及 no-store 检查；测试账号未写入生产。生产 GET200、匿名 POST401、登录页及原评论读取正常，原账户/评论/计数行指纹不变。部署前数据库备份已通过 `pg_restore --list` 校验。首次上线镜像 `dcelysion/waline-content-like:20261018-v1` 仅在原 `dcelysion/waline-public:20261017-guard` 上新增三份点赞 JS；未覆盖 Nginx 或其他服务。后端上线不替代前端双域发布核验。

受保护的备份与回执在服务器 `/opt/dcelysion/config-backups/content-like-20261018/`，数据库备份为 `/opt/dcelysion/backups/waline-20261018T080031Z.dump`。回退时恢复该目录的 `compose.yaml` 并仅重建运行 Waline 容器，保留新表及其数据；不恢复旧数据库覆盖上线后的正常写入。

2026-10-18 头像补全增量发布：当前镜像 `dcelysion/waline-content-like:20261018-avatar-v2`，仅覆盖点赞控制器；不改数据库结构或账户数据。配置与旧镜像回退资料位于 `/opt/dcelysion/config-backups/content-like-avatar-20261018/`，该目录保存数据库备份回执。5项本地测试通过；隔离真实 HTTP 验证 GET/POST 补全结果与 Waline 登录头像一致、上传头像、最小公开字段及匿名401；隔离容器使用与正式服务相同的数据库网络和出站网络。生产点赞接口已返回当前账户头像，公开图片200；登录页、评论读取、no-store及匿名401检查通过，容器内控制器SHA-256与本地一致。用户浏览器刷新后的实际显示仍待本人确认。回退仅恢复该目录的 `compose.yaml` 并重建 Waline 容器，不回滚数据库。

## 互动邮件 outbox（已部署，测试邮件获 SMTP 接受）

2026-10-21 已按用户“提交部署”授权安装 006 迁移，并将 Waline 与独立 worker 切换到 `dcelysion/waline-interaction-mail:20261021-dc4817fd`。收件配置为 `lin507793465@gmail.com`，新通道已开启；2026-10-22 复核两个容器持续运行、无重启。首次测试曾出现 SMTP 连接超时，后台有限重试后在北京时间 2026-10-21 23:34 第 4 次尝试获得 SMTP 接受，测试事件已完成；复核时无未完成或耗尽任务。**用户收件箱/垃圾邮件实际收信仍待确认。** 未为排除此短暂故障修改 SMTP 或网络配置。备份、部署及回执详见[上线记录](../../../docs/plans/2026-10-21-interaction-mail-release.md)。

新配置 `INTERACTION_NOTIFY_EMAIL=lin507793465@gmail.com` 是互动通知收件人，独立于原 `AUTHOR_EMAIL`（保留其现有身份语义）和 SMTP 发件账号。`INTERACTION_NOTIFY_ENABLED` 默认 `false`；仅填写收件人不会关闭原作者邮件。启用后，新增文章/动态账户点赞、新留言和评论由独立邮件 worker 发出，不因微信等其他通知渠道返回成功而跳过邮件。原评论回复者通知及其他渠道保留；原作者邮件回退停用以避免同事件双发。

`006_interaction_mail.sql` 在实际 `wl_comment`、`dc_content_likes` 上安装 INSERT 触发器，与互动数据同一事务写入 `dc_interaction_mail`。管理员、收件邮箱对应账户或 `AUTHOR_EMAIL` 对应账户的本人互动不提醒（不以 SMTP 发件地址判断本人）。普通访客自回复仍属于新的留言，向站长通知。待审评论立即通知并标记状态，审批不重复提醒；垃圾评论不入队。取消点赞不通知；同一账户同一路径终身只建立一个通知键，取消再赞及并发重复请求不重发。迁移前已存在的内容点赞只建立去重墓碑，旧评论不补发。旧匿名 reaction0 / 评论点赞无账户归属，仍不在本通道范围。

独立 `interaction-mail` Compose profile 持续运行 `/app/src/lib/interaction-mail-worker.js`，无需后续 HTTP 请求唤醒，无公开端口。正常空闲轮询间隔 2 秒，SMTP 接受不等于收件箱实际送达。单条任务最多尝试 5 次，失败后间隔 30 秒、2 分钟、10 分钟、30 分钟；进程崩溃留下的租约 2 分钟后可重领，认领次数也计入上限。多 worker 使用 `FOR UPDATE SKIP LOCKED` 原子认领。最后一次崩溃仍会保留 `WORKER_INTERRUPTED`，耗尽后等待人工检查。SMTP 未配置也记录失败而非误记成功；持久化与日志仅记录固定错误码。成功/本人跳过后清除 payload，保留去重键；失败 payload 仅在私有数据库保留，含通知所需昵称、邮箱及正文，不进入公开点赞响应。邮件 HTML 转义访客输入，正文最长 20000 字符，链接重新验证站内路径并固定到配置的 HTTPS `SITE_URL`。

**生产安装步骤（本次已获授权执行，后续重装参考）：**

1. 备份当前数据库及 Compose/镜像配置，确认已安装 005；应用 `006_interaction_mail.sql`。迁移与触发器必须完整安装，不能只部署 worker。触发器安装后的新事件即持久化，勿将安装与正式启用间隔过久。
2. 用当前完整覆盖层重建 Waline 镜像；`waline` 与 `interaction-mail` 必须使用同一个新镜像标签。保留服务器当前镜像/其余服务配置，不盲目覆盖。worker 沿用现有 PG 与 SMTP 环境配置，缺少真实 SMTP 配置时不能完成生产启用。
3. `.env` 配置收件人及 `INTERACTION_NOTIFY_ENABLED=true`，执行 `docker compose --profile interaction-mail up -d --no-deps interaction-mail` 启动 worker；确认进程稳定及数据库队列可读取后再重建 Waline 容器加载同一开关。此顺序让旧服务保留回退直到 worker 可用；短暂交接窗口可能收到重复邮件。
4. 部署授权涵盖邮件验收时，以访客账户产生一条新内容点赞和评论，核对实际收件箱、队列完成与本人/撤销不提醒。只看 SMTP 日志不能替代收信验收。检查队列可用只读聚合：`SELECT count(*) FILTER (WHERE finished_at IS NULL AND attempts<5) AS pending, count(*) FILTER (WHERE finished_at IS NULL AND attempts>=5) AS exhausted FROM dc_interaction_mail;` 不输出邮箱、正文或凭据。

SMTP 失败和发送退避独立于原点赞/评论请求；**数据库触发器/入队故障会回滚该次互动写入**，以保证成功写入的事件不会悄悄丢失。SMTP 成功后、数据库标记完成前若进程终止，重试可能重复投递，这是 SMTP 无事务接口的实际边界，不能承诺绝对一次。worker 意外停止时事件继续入队，须恢复 worker；默认 `docker compose up -d` 不会启用该 profile，后续部署须保留已启用的 profile。回退时先关闭 Waline 的新开关并重建以恢复旧作者邮件，再停 worker，保留 outbox/触发器和数据。再次启用会续发尚未完成且未耗尽的事件，必须先确认积压处理意图。

本地验证：`node --test deploy/tencent/waline-overlay/interaction-mail.test.cjs`，5 项通过。使用固定版本原始 `vendor/waline.pgsql` 与隔离 PGlite 执行真实迁移/触发器，覆盖迁移重入、事务回滚、点赞永久去重、待审/垃圾/管理员过滤、并发认领、持久失败及重新认领、无 SMTP 的有限重试、worker 无请求时持续运行和 SIGTERM 清理、HTML 转义、站外路径拒绝及旧作者/回复者邮件开关回归。本地邮件使用注入的假 transporter，不外发邮件；后续已进行生产迁移、部署及一条专用 outbox 测试事件的发送尝试，结果与尚未完成的收信验收以上线记录为准。

## management-v1（第六阶段）

- `logic/management.js`：只允许当前 Waline administrator 的 GET；其他方法405。page/pageSize、正整数ID及搜索/路径/状态有界。
- `controller/management.js` + `lib/management-read.js`：仅通过现有 `getModel('Comment'/'Users')` select/count 读取，固定字段及排序。提供评论分页总数、原始正文、正文搜索、精确路径/user_id/状态过滤；用户昵称/邮箱搜索、详情；线程限定同一url的根/回复，删除数量使用上游实际 objectId/pid/rid OR 条件。每次复制 field 数组，因为固定 SQL adapter 会 push id。密码、2FA、IP、user-agent等不进入读取 DTO。用户 auth_version 仅供服务端条件更新/指纹，新后台不透传。
- 新后台写评论仍走原 `/api/comment` POST/PUT/DELETE。原服务删除自身、pid或rid指向目标的回复；审批待审回复和新回复可能触发原通知/hooks。不要把“回复接口返回超时”当作未落库或未发邮件。
- `controller/user.js` 的 `_managementState` 分支只允许 administrator 管理其他 guest/banned，校验 expectedType/expectedVersion；不走上游 DELETE（其可能删除未验证用户）。`service/storage/postgresql.js` 基于官方 [@waline/vercel 1.41.6 npm 源码](https://registry.npmjs.org/@waline/vercel/-/vercel-1.41.6.tgz)，保留原实现并添加单条匹配id/type/auth_version的UPDATE。上游普通 update()是先SELECT再按id UPDATE，不能拿它伪称CAS。新方法同时递增auth_version，防止封禁后解禁复用旧JWT。其他storage没有该方法时明确拒绝状态变更。
- `003_security_version.sql` 是已有 password-reset 迁移之后的增量补丁，给密码/邮箱版本触发器增加type及`"2fa"`实际变化；原重置链接撤销触发器继续消费版本变化。该补丁涉及真实数据库，需部署阶段授权；不能仅改旧迁移来假设已安装环境生效。

PostgreSQL适配器复制自固定官方版本，遵循GPL-2.0并保留项目既有 `../vendor/LICENSE`。其余新增接口与后台接入说明见 `../../../admin/README.md` 第六阶段。管理令牌不进入浏览器；本人改密先通过原 `/api/token` 当前密码/二步码再认证。安全页 `/ui/profile` 仍使用现有Waline管理脚本处理二步验证，新后台用服务端 `ADMIN_WALINE_SECURITY_URL` 区分浏览器入口与内网API地址；未配置时不显示无效入口。

## 本地头像上传

`avatar-upload-v1.js` 在固定管理客户端 0.34.2 的 `/ui/profile` 捕获头像点击，选择本地 JPG/PNG/WebP/GIF（最多 10 MB），在原图上拖动取景、以滑块缩放（1–4 倍），或聚焦裁剪区域后使用方向键微调；支持重置裁剪和实时圆形预览。确认后保存为 256×256 静态 PNG，取消不上传。动图在读取时固定为一帧。复用 Waline 当前登录令牌，仅向同源 `window.serverURL` 发送 `POST avatar`；不更改固定上游 bundle。页面语言为中文时显示中文，其余语言回退英文。2026-10-15 已部署手动裁剪脚本及头像读取修复，脚本HTTP回读与本地SHA-256一致；真实浏览器拖动、缩放和保存仍待本人验收。

评论域尚未公开时，管理页将规范头像链接 `https://comments.dcelysion.cn/api/avatar?id=…` 映射到当前同源 Waline API 代理显示，数据库仍保存评论域链接；此映射覆盖管理页头像并支持 React 重入。它不新增公开入口或绕过后台 Access。

启用前先在 **Waline 数据库**执行 `004_user_avatars.sql`，重建带覆盖层的 Waline 镜像，并安装 `/srv/dcelysion/admin-assets/avatar-upload-v1.js`。既有 `nginx-comments-private.conf` 与正式 `nginx-admin-access.conf` 都已加入脚本注入；部署时必须保留服务器当前配置、先 `nginx -t` 再 reload。不能仅安装 UI 脚本而跳过迁移/镜像更新。`SERVER_URL` 必须是当前评论服务的可信 HTTP(S) 地址；头像永久链接指向该地址 `/api/avatar?id=<digest>`，不能指向需要 Access 登录的后台域名。

服务端只接受不超过 384 KiB、边长不超过 256、8-bit RGB/RGBA 的非交错 PNG，校验块 CRC、解压长度和过滤类型，去掉元数据，拒绝 SVG/动画。数据库按用户保存一份当前头像；事务更新本人 `wl_users.avatar` 和图片，重新检查 `auth_version` 与有效用户角色，同一用户两次保存间隔至少 5 秒。公开 GET 仅返回 PNG 字节，不返回账户信息，图片 URL 可供评论展示。更新头像后旧图片链接至多缓存 5 分钟；备份 Waline 数据库即包含头像。

本地定向验证：`node --test deploy/tencent/avatar-upload.test.cjs deploy/tencent/waline-overlay/avatar.test.cjs`，涵盖模拟页面交互、ThinkJS 成功响应控制流和 PGlite 数据库事务。2026-10-11 已完成隔离真实 HTTP 上传/回读及正式服务安装，真实用户浏览器上传尚待本人验收。回退先移除两处脚本注入再回退镜像；保留新表和数据，避免破坏用户已上传头像。

management-v1 阶段本地验证记录：`node --test deploy/tencent/waline-overlay/management.test.cjs`（3项）检查只读鉴权/最小字段、实际隔离PGlite版本触发器、条件更新在目标已提升管理员时拒绝。修改JS均做 `node --check`。当时的本地验证不等于完整ThinkJS/Waline HTTP实例、真实PostgreSQL或邮件通知联调，未执行生产评论/用户/会话写入、数据库迁移或部署。
