# 腾讯云私有部署记录

> 2026-09-26：邮箱找回和中文邮件服务已部署至腾讯云私有环境；公网仍使用 Twikoo，待备案完成后再切换 Waline。下文 2026-09-25 状态保留为历史记录。

本目录用于将 DcElysion 静态博客、Waline 注册登录/评论/留言和 R2 媒体迁移到 Ubuntu 轻量应用服务器。域名备案尚未完成，当前保持私有预览，**尚未完成正式公网切换**。

## 历史状态（2026-09-25）

- PostgreSQL 17 与 Waline 1.41.6 已启动。数据库无公网映射；Waline 只监听 `127.0.0.1:8360`。
- 9 条 Twikoo 评论、7 条访问计数已导入，并逐字段核对。用户同意将 1 条缺失父评论的回复改为独立评论；原始导出保留。旧博主徽标无法自动映射为新账号徽标，毫秒时间按官方 schema 舍入到秒。
- 2026-09-25 已用授权邮箱完成真实注册确认与找回密码邮件验收：两封邮件均由 Waline SMTP 发出并到达 Gmail 垃圾邮件，确认链接使账号转为 guest，找回链接中的令牌可读取该账号资料；原密码哈希、昵称和网址保持一致。管理员现有密码登录、9 条历史评论管理列表及专用测试评论的编辑、批准、公开显示、标垃圾、删除均通过；测试行清理后历史 9 条整行指纹与总数不变，未触发评论提交通知。该访客账号的原密码登录尚需本人执行（用户本次暂时无法测试）。首次注册发送曾出现一次 SMTP 连接超时，复测 SMTP 认证及两封实发邮件成功。
- 前后端均设为 `login=enable` / `LOGIN=enable`，保留注册登录，也允许匿名评论和留言；昵称、邮箱、网址均非必填。`COMMENT_AUDIT=false` 关闭审核，新评论立即显示。独立数据库实测无登录、无昵称/邮箱提交成功并进入 `approved`，公开列表立即可读，测试禁用了邮件。未填昵称时前端显示“匿名用户”。主服务的无正文请求进入字段校验，9 条历史评论渲染保持一致。博客正文继续由仓库维护，访客不能编辑文章。
- R2 三个桶共 152 个文件、743,848,570 字节已复制并下载校验，源文件未改动。音乐 31、壁纸 5、相册 116。全部 HTTP HEAD、MIME、CORS 及每桶 Range 206 检查通过；保留原对象路径。
- 腾讯云专用完整构建通过，上传包 SHA-256：`77dbc1324e5d6697494dd546d3d09d1d0a32a78fa2a058fe46dbd329cf43ed9c`。
- 浏览器验证：留言页 Swup 往返后仍只有一个评论面板，真实动态评论路径正确。最新浏览器检查通过：匿名输入表单、“提交”和“登录”按钮同时存在，匿名显示文案为“匿名用户”；留言页往返及动态评论均通过。测试拦截访问量递增请求，未更改真实访问计数。
- 数据库每日北京时间约 03:30 自动备份（随机延迟最多 5 分钟），随后自动上传至私有 R2 桶 `dcelysion-db-backups/database/` 并回读校验。2026-09-25 18:23:52–18:24:31 北京时间完整 systemd 服务实测成功，两个 ExecStart 均退出 0；当前 R2 有 8 份 dump 及 8 份 SHA-256 文件，timer active，检查时下次运行时间为 2026-09-26 03:32:58。最新 R2 备份已下载恢复至独立数据库，9 条评论、9 条计数、1 个管理员检查通过，评论与计数全部行指纹和主库一致；未写入主库。
- `comments.dcelysion.cn` 的 A 记录已指向服务器。HTTP 验证被未备案拦截后，恢复 Cloudflare 插件 OAuth 并通过插件更新 DNS TXT，证书已签发，有效期至 2026-12-23。HTTPS 评论代理监听 `127.0.0.1:8443`，本机 HTTP 预览代理监听 `127.0.0.1:8361`；两者均不对公网开放。主站及媒体域名未切换，R2 原件仍保留。
- 本次源码改动未 Git 提交、未推送，未部署 OpenAI Sites。

## 私有预览

通过 SSH 隧道连接服务器，端口映射为：

| 本机 | 服务器 | 用途 |
| --- | --- | --- |
| `127.0.0.1:18880` | `127.0.0.1:8080` | 博客预览 |
| `127.0.0.1:18360` | `127.0.0.1:8361` | 评论和管理界面（Nginx 私有代理，含登录输入框样式修复） |

按下方命令启动隧道；关闭隧道或重启电脑后需重新连接。私钥必须具有适当的当前用户读取权限。

```powershell
ssh -4 -i '<受限权限私钥路径>' -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -N -L 127.0.0.1:18880:127.0.0.1:8080 -L 127.0.0.1:18360:127.0.0.1:8361 ubuntu@124.220.196.115
```

预览：`http://127.0.0.1:18880/`；管理：`http://127.0.0.1:18360/ui/login`。
仅私有 Nginx 预览会把页面内评论服务地址替换为本机隧道地址，正式静态文件仍使用 HTTPS 域名。
更新 `nginx-comments-private.conf` 后须在服务器执行 `nginx -t` 并重载 Nginx；旧隧道若仍指向 Waline 的 `8360`，需按上方命令重新连接到 `8361` 才能看到管理后台输入框修复。
管理员初始凭据位于本机 Git 忽略且仅当前用户可读取的 `cache/tencent-private/admin-initial.json`，以及服务器 root 专用的 `/opt/dcelysion/admin-initial.json`；不得提交或复制进文档。

## 文件与数据

| 服务器路径 | 用途 |
| --- | --- |
| `/opt/dcelysion/compose.yaml` | 固定镜像摘要的数据库/评论服务 |
| `/opt/dcelysion/.env` | 数据库、JWT、SMTP 密钥，0600 |
| `/opt/dcelysion/data/postgres` | 数据库持久目录 |
| `/opt/dcelysion/backups` | pg_dump 自定义格式及 SHA-256 |
| `/opt/dcelysion/migration-source` | 原始评论导出与迁移 SQL，私有 |
| `/opt/dcelysion/media-manifests` | R2 清单、校验日志和本地 SHA-256 |
| `/opt/dcelysion/rclone.conf` | 临时媒体迁移 R2 只读凭据，0600 |
| `/opt/dcelysion/backup-r2.conf` | 持续异地备份 R2 凭据，root 专用，0600；不得随迁移令牌一并撤销 |
| `/srv/dcelysion/releases`、`current` | 静态发布版本及当前符号链接 |
| `/srv/dcelysion/media/{music,wallpapers,gallery}` | 媒体文件，独立于发布目录 |

本机异地备份为 `cache/tencent-private/database-backups.tar.gz`，包含数据库备份、迁移源数据及媒体校验清单。它含个人数据，保持私有。

## 构建与运维

不设置环境覆盖时仍使用现有 Twikoo，避免影响尚未切换的其他部署。

```powershell
$env:PUBLIC_COMMENT_PROVIDER = 'waline'
$env:PUBLIC_WALINE_SERVER_URL = 'https://comments.dcelysion.cn'
corepack pnpm build
```

上传 `site.tar.gz` 后使用 `sudo bash ~/dcelysion-deploy/install-staging.sh <包的 SHA-256 小写值>` 校验并切换私有静态版本；旧版本保留。
安装脚本先核对压缩包摘要，再在唯一临时目录解包，检查非空首页、404、Pagefind 入口、`_astro` 资源和首页引用的本地关键资源。这里检查的是 Nginx 静态站入口，不要求无关的服务端入口。完成后才以原子重命名发布 release，并写入包含完整压缩包 SHA-256 的完成标记。已有 release 的标记缺失或摘要不匹配时会拒绝复用，需人工调查，不会自动删除。配置文件和 `current` 链接采用临时路径替换；Nginx 语法检查、重载或本机 HTTP 健康检查失败时回退本次变更。若回退本身失败，脚本会报告并保留 `.install-staging-state.*` 快照路径供人工恢复。脚本使用锁防止并发部署，HTTP 检查设有连接和总超时。

服务器常用命令（需要 sudo）：

```bash
cd /opt/dcelysion
docker compose ps
docker compose config --quiet  # 勿打印展开后的密钥
./backup.sh
systemctl list-timers dcelysion-backup.timer
```

`convert-twikoo.mjs` 默认拒绝孤立回复，只有用户明确同意后才使用 `--orphan-policy=root`。迁移 SQL 在事务中检查目标评论/计数表为空，防止重复导入。`test-import.sh` 的独立数据库保留用于审阅，不能反复当作幂等脚本执行。`cleanup-browser-probes.py` 只用于本次交付前恢复已知测试计数，**正常使用后不得再次运行**。
重新转换评论时，为每次运行指定一个不存在的私有输出目录，例如 `node deploy/tencent/convert-twikoo.mjs comments.json counters.json migration-20260925`。转换器先解析并校验输入，再经同级临时目录一次性发布完整包；已有输出目录不会被覆盖。`manifest.json` 记录源 JSON 和 SQL 的 SHA-256，`check-migration-package.py <目录>` 可先在本地预检。`import-comments.sh` 在备份和 PostgreSQL 导入前执行同一预检；摘要不符或旧格式包会直接拒绝，须从原始导出重新生成。预检只证明文件与清单一致，导入后仍由 `verify-import.py` 逐字段核对。源文件及 SQL 含个人数据，始终保存在私有位置。

`test-anonymous.sh` 使用独立数据库 `waline_anonymous_direct_check` 验证匿名提交与即时展示，禁用所有 SMTP 配置，结束后停止测试容器并保留测试数据库；该脚本同样不能直接重复执行。`check-comments.py` 在主服务只读取历史评论和提交缺少正文的无效请求，不创建测试评论。

## 正式切换前剩余事项

1. 完成腾讯云备案。备案前保持博客和评论私有；未使用代理绕过备案开放网站。
2. 评论证书已通过 DNS TXT 签发。虽然 Certbot 自带续期计划任务，本次 DNS hook 仍需要协调器通过插件更新 TXT，**尚不具备无人值守自动续期能力**；备案后须切换为可自动验证的续期配置并 dry-run。
3. 访客使用原密码登录并验收个人资料页；注册确认和找回密码实收及评论管理 API 已通过。两封测试邮件被 Gmail 归为垃圾邮件，收件人可标记非垃圾邮件；正式上线后继续观察送达分类。
4. 切换前再次同步 R2 增量，并检查旧 Twikoo 是否有新增评论，避免遗漏等待期间的数据。
5. 为主站、媒体配置 HTTPS 和公网虚拟主机，放行 443；确认后切换原域名。当前 Worker/R2 自定义域名记录需按相应产品解绑再切换，不能直接用同名普通 A 记录覆盖受管理记录。
6. 启用并验证自动证书续期；持续 R2 异地备份及独立恢复已通过，后续定期演练并观察定时服务结果。完成媒体迁移后撤销临时媒体迁移 R2 令牌，保留持续备份所用令牌。

## 上游来源

`vendor/waline.pgsql` 来自 [Waline 官方仓库固定提交](https://github.com/walinejs/waline/blob/43a1e85edcb07b03e26713223eb89dd81cbaa0c4/assets/waline.pgsql)，SHA-256 为 `44c5c4f841a46afc504d5423f71aa5222231e31b92523a6b05cde327bfa9c91c`。上游 LICENSE 为 GPL-2.0，已附 `vendor/LICENSE`（取自 1.41.6 npm 包）；镜像摘要见 compose 文件。

参考：[Waline 数据库](https://waline.js.org/guide/database.html)、[环境变量](https://waline.js.org/reference/server/env.html)、[腾讯云备案期间说明](https://cloud.tencent.com/document/product/243/19637)。

## Waline 管理资源同源部署

管理脚本固定为 `@waline/admin@0.34.2`，通过 `WALINE_ADMIN_MODULE_ASSET_URL=/admin-assets/0.34.2/admin.js` 加载。Nginx 将该路径映射至 `/srv/dcelysion/admin-assets/0.34.2/admin.js`，版本路径缓存一年；文件 SHA-256 为 `fb745bd9bd983a6170877861f701752304b1534b835fe72b9db12c36999c627f`。资源来自官方 npm 发布包，由部署脚本获取并核验，浏览器加载管理脚本不再依赖 unpkg。升级必须更新版本、校验值和环境变量路径，并重新验收兼容性。

登录页的“显示密码”选项及注册页“个人网站（选填）”提示由 `show-password.js` 提供。部署脚本将它安装为 `/admin-assets/show-password-v1.js`，Nginx 仅在管理页 HTML 中加载；更新此脚本时须同步更改资源文件名和注入路径，以避开一年缓存。

私有 HTTP 代理仅监听 `127.0.0.1:8361`，与 HTTPS `127.0.0.1:8443` 共用配置；预览隧道必须指向 8361，直接访问 Waline 8360 无法获取静态管理脚本。未来正式域名使用相同资源路径。当前没有增加公网监听。

上传 `compose.yaml`、`nginx-comments-private.conf`、`show-password.js` 和 `install-admin-assets.sh` 至 `~/dcelysion-deploy/` 后，执行 `sudo bash ~/dcelysion-deploy/install-admin-assets.sh`。脚本校验下载资源、保存原配置、检查 Nginx/Compose，并只重建 Waline；数据库目录和密钥文件不变。资源位于容器外，容器重建后仍然保留。

每次执行输出 `/opt/dcelysion/config-backups/admin-assets-<时间>-<PID>`。回退时从该目录恢复 `compose.yaml` 至 `/opt/dcelysion/compose.yaml`、`nginx-comments-private.conf` 至 `/etc/nginx/sites-available/dcelysion-comments-private`，执行 `nginx -t`、`systemctl reload nginx`，再于 `/opt/dcelysion` 执行 `docker compose up -d --no-deps waline`。若回退配置没有 8361，将预览隧道目标恢复为 8360。版本化静态文件可保留，不影响回退。

私有管理页的 API 地址按 Nginx 监听端口替换：8361 使用本机隧道 http://127.0.0.1:18360/api/，8443 保留正式域名。这样私有预览不会等待尚未开放的公网 API；此替换仅作用于 /ui/ 的 HTML。

注册确认邮件由 Waline 服务端按 `/api/user` 注册请求的 `lang` 参数选择语言。评论区虽已设置 `lang: "zh-CN"`，管理页或直接 API 注册仍可能发送英文邮件。`nginx-comments-private.conf` 对 `POST /api/user` 固定传入 `lang=zh-CN`，使注册确认邮件使用 Waline 内置的简体中文标题和正文；同一路径的其他方法保留原查询参数，原有注册限流不变。此配置只在评论代理更新并重载 Nginx 后生效，不需要重建静态博客或 Waline 容器。部署时先备份现有 Nginx 配置，安装新文件并执行 `nginx -t`，成功后重载；失败则恢复备份。实际收信仍需用已授权的测试邮箱验收。

## 邮箱找回密码与邮件中文化

镜像构建上下文使用 `.dockerignore` 白名单，仅包含覆盖源码、服务文件和锁定依赖清单，避免将服务器上的 `.env`、数据库或备份送入构建上下文。上传部署材料时也要包含这个隐藏文件和 `password-reset/package-lock.json`。

本 worktree 从原工作区继承腾讯云部署材料、Waline 前端适配及其 package/lockfile；这些属于先前未提交的迁移基线。本次新增 `password-reset/`、`waline-overlay/`、`Dockerfile.waline-reset`、`install-password-reset.sh`，并调整本目录的 Compose 与私有 Nginx 配置。2026-09-26 已将这些成果整合回主工作区。

固定 Waline 服务端 1.41.6 的旧 `PUT /api/user/password` 会发无过期时间的普通登录 JWT。自有镜像在固定摘要基础镜像上覆盖该控制器，使其返回 410；Nginx 也对旧路径返回 410。新管理页 `/ui/forgot` 调用 `POST /api/password-reset/request`（JSON `{ "email": "..." }`），成功时一律返回 HTTP 202 与 `{ "errno": 0, "data": { "message": "..." } }`；有效格式但不存在、未验证或封禁的邮箱同样如此且不发信。邮箱冷却期 60 秒、每小时最多 5 次；超限统一返回 429。新页面 `/ui/reset-password#token=...` 在浏览器读取并立即清除地址中的凭证；只有提交 `POST /api/password-reset/confirm`（JSON `{ "token": "...", "password": "..." }`）才消费，成功返回 HTTP 200 和 `errno: 0`。失效链接为 400，密码规则错误为 422，服务故障为 503。

重置凭证由 32 字节随机源生成、只存 SHA-256 摘要，15 分钟有效。迁移 `password-reset/001_password_reset.sql` 建立专用表与邮箱维度限额表，给 Waline 用户增添 `auth_version`；密码或邮箱变化的数据库触发器递增版本并撤销重置链接。提交时事务锁用户与凭证行、再次检查账号状态和邮箱、更新 Waline 使用的 phpass 哈希。新会话 JWT 携带 `purpose=session` 与版本；旧格式 JWT 仅对版本仍为 0 的账号继续有效。账号完成重置后，它的旧登录/找回 JWT 均失效，其他账号不受影响。二步验证字段和用户、评论关联不变。评论、注册和找回邮件在服务端使用固定简体中文模板，评论原文、昵称与链接继续按原样插入；前端界面仍可随浏览器语言显示中文或英文。所有新邮件均通过同源 SMTP 配置发送，找回接口使用有界内存发送队列；SMTP 失败会移除对应未送达令牌并写脱敏日志。进程在发信前意外退出时，未发出的令牌会在 15 分钟后过期，用户可在冷却期后重试。

2026-09-26 已获授权并完成私有服务部署。部署前确认私有预览使用的 `PASSWORD_RESET_ORIGIN` 为**该隔离环境可访问的服务端可信地址**，正式环境则为 HTTPS 评论域名。它不读取客户端 Host 或跳转参数；不得为了本地隧道修改生产 `SERVER_URL`。将本目录所需文件上传到服务器同一目录，执行 `sudo bash install-password-reset.sh`。脚本先备份数据库和原配置、安装版本化页面、构建固定基础镜像、关闭旧找回路径，再运行可重复的数据库迁移，最后启动新 Waline 与找回服务并检查本地页面与无效凭证响应。服务端继续仅监听 loopback 8360/8361/8362/8443；脚本不会做公网切换。

若安装失败，先保留 Nginx 对旧找回接口的 410 禁用，不要直接恢复旧 Nginx 配置使永久登录 JWT 再次可申请。可在私有预览中暂时把新找回入口设为不可用并保持普通评论、登录服务；需要回退镜像时应继续阻断旧路由，并保留已迁移的 `auth_version` 和密码数据。不要回滚整个用户数据库或轮换全站 JWT 密钥。配置备份位于脚本输出的 `/opt/dcelysion/config-backups/password-reset-*`，数据库备份由既有 `backup.sh` 写入私有 `backups/`。正式部署还须使用指定测试邮箱核对真实 SMTP 送达、私有预览里新密码登录/旧密码失败/旧会话失效、管理员与 2FA、评论通知及真实回调链接可达性；不得对真实评论用户群发测试邮件。

本地验证：`npm ci --prefix deploy/tencent/password-reset` 与 `npm test --prefix deploy/tencent/password-reset`，11 项测试通过；嵌入式 PostgreSQL 执行官方表结构和重复迁移，验证原子重置相关 SQL、密码哈希与触发器，HTTP 请求通过本地 SMTP 接收器收信。浏览器用本地模拟接口验证 `/ui/forgot` 通用提示、重置页立即清除 URL 凭证、刷新后失效提示与表单隐藏。`npm audit` 对测试包及生产依赖均为 0 项。2026-09-26 已在目标服务器完成 Docker 镜像构建、Compose/Nginx 配置检查和数据库迁移，私有登录/找回页面 HTTP 200，旧重置接口 HTTP 410，新接口拒绝无效凭证 HTTP 400；9 条历史评论读取及匿名字段校验通过。新流程尚未向真实邮箱发送测试邮件，也未修改真实账号密码。

## 持续 R2 异地备份

`dcelysion-backup.service` 按顺序执行 `/opt/dcelysion/backup.sh` 和 `/opt/dcelysion/offsite-backup.sh`。后者校验本地 SHA-256，以不可覆盖模式上传各数据库备份及校验文件，再从 R2 回读核对；任一步失败会令服务失败并保留日志。本次通过手动启动同一定时服务验证完整流程，下一次自然定时触发尚未观察。

备份桶 `dcelysion-db-backups` 的 r2.dev 公共访问关闭、无自定义域名。用户明确选择使用其提供的账户全部桶对象读写令牌，程序目标固定为该备份桶；凭据只存放在服务器 root 可读的配置中，不写入源码。没有自动删除本地或 R2 历史备份的策略，容量和全量回读工作量会随时间增加。此自动流程备份 Waline 数据库，不包含媒体原件、服务器密钥和系统配置；原有本机迁移资料副本仍保留。

运维命令（在服务器执行）：

```bash
sudo systemctl start dcelysion-backup.service
sudo systemctl show dcelysion-backup.service -p Result -p ExecMainStatus
sudo systemctl list-timers dcelysion-backup.timer
sudo journalctl -u dcelysion-backup.service -n 50 --no-pager
sudo /opt/dcelysion/test-offsite-restore.sh
```

恢复脚本从 R2 下载最新备份和 SHA 文件，在私有临时目录校验后恢复到新的独立数据库，并比较其评论、计数全部行指纹与当前主库；备份后若主库新增评论或计数变化，指纹比较可能因正常写入失败，需结合时间判断。测试库保留供检查，临时下载文件清理。2026-09-25 实测使用 `waline-20260925T102352Z.dump`，恢复库为 `waline_offsite_restore_20260925T102452Z`。

当前服务器 rclone `v1.60.1-DEV` 首次上传新对象出现过 `501 NotImplemented`，自动第二次重试成功；所有对象随后完整回读校验通过，服务最终成功。`--no-update-modtime` 未消除该现象，根因尚未确定，不能视为已修复。后续若上传最终失败，应以 systemd 失败状态和日志处理，不能仅凭重试信息判定备份成功。

重新配置凭据可使用 `set-backup-credentials.ps1` 隐蔽读取 S3 Access Key ID 和 Secret Access Key，通过 SSH 标准输入交给服务器 `configure-backup-r2.py`。后者以 0600 新建配置，遇到已有配置会拒绝覆盖；轮换前应先明确备份旧配置和替换步骤。PowerShell 辅助脚本默认引用本机本次部署的 SSH 文件路径，更换电脑或私钥后需显式传入 `-IdentityFile`、`-KnownHostsFile`。

## 2026-09-26 整合发布

- 用户指定仅更新腾讯云私有预览并推送 GitHub；公网 Waline 切换等待备案完成，不部署 OpenAI Sites。
- 本次沿用已有类型检查、默认构建和 11 项重置模块本地测试；额外生成最新脚本优化后的 Waline 目标产物。
- Linux 独立临时目录中的静态部署故障注入测试通过，覆盖发布失败回滚、配置符号链接恢复、残缺版本拒绝；未接触生产数据。
- 重置回调 `PASSWORD_RESET_ORIGIN=http://127.0.0.1:18360` 已写入服务器私有环境配置，需开启 SSH 隧道；正式开放时需改回可信 HTTPS 评论域名。`SERVER_URL` 未为预览修改。
- 安装时发现容器启动后立即探测会遇到空响应；脚本补充 Waline HTTP 就绪重试。服务实际就绪后的页面与接口检查通过。
- 本次服务配置快照：`/opt/dcelysion/config-backups/password-reset-20260925T175913-1125146`；数据库备份 `waline-20260925T175913Z.dump` 已校验。- 私有静态版本已切换至 `/srv/dcelysion/releases/20260925-6e933ab57684`，包 SHA-256：`6e933ab57684ff0d843824d3b69d2d8a824cd612177533ad09b00eec828f665c`。包校验、静态入口检查、Nginx 语法及 HTTP 健康检查通过。
- 部署后浏览器烟雾检查通过：留言页 Swup 往返始终只有一个评论表单，匿名评论与登录入口同时可用，动态评论路径正确；测试拦截访问计数请求，未写评论或真实计数。
- 两个无扩展名的重置页面显式设置 `text/html; charset=utf-8`，避免 Nginx 默认将页面作为二进制下载；目标服务响应类型、no-store 和 no-referrer 已检查。