# 腾讯私有后台联调（2026-10-02）

状态：真实 PostgreSQL、Waline＋2FA、后台浏览器编辑主链、Linux 隔离 release/回退协议和测试数据库恢复已完成。恢复后的私有实例已启动并通过认证读取。MDX 容器构建、后台 R2 同步、真实 Umami 和全机出口限制仍未验证，不能据此正式上线。本记录补充[第九阶段本地证据](2026-10-01-admin-stage9.md)，没有重复此前 fixture 验收。

## 范围与实测环境

- 源码基准 `d2397f040d8d35b8ef213dc9e9ade903eb5380cd`；部署包包含当前工作区后台实现，前阶段成果与任务外改动保留。本轮应用源码修复为零，调整仅涉及忽略目录内的联调打包、启动材料及文档记录。
- SSH 实测 `ubuntu@124.220.196.115` / `VM-0-15-ubuntu`，使用现有受保护私钥与 known_hosts，保持严格主机校验。ED25519 指纹 `SHA256:+sHIpPqeHf/UAFIHfb7zPubSnli7bd7I7WhSlQaUjb4`。
- 2 CPU、1962MiB 内存、2047MiB swap，初检约 35GB 可用磁盘。宿主没有 Node/pnpm/corepack；已有 Python 3.14.4、Nginx 1.28.3、root Docker/cgroup v2，没有已验证 rootless endpoint。复用已有镜像运行 Node 24.20.0、Waline 1.41.6、PostgreSQL 17.11，没有安装系统运行时。
- 生产 PostgreSQL 角色权限不适合作共享隔离验证，改用新的独立 PostgreSQL 容器/空数据卷；未调整生产角色、PUBLIC 权限或 pg_hba。
- 原有 PostgreSQL、Waline、password-reset、共享 Nginx 和备份 timer 未重启或改写；未读取真实用户/评论行，不使用真实博主凭据，不发送邮件/通知。

## 本轮隔离资源

远端根 `/home/ubuntu/dc-admin-private-20261002` 为 0700，OWNER 标记 `dc-admin-private-integration-20261002`；秘密配置为 0600。以下 Docker 资源标签均为 `dc.task=admin-private-20261002`。

| 资源 | 实际状态 |
| --- | --- |
| 容器 | `dc-admin-it-20261002-pg`、`dc-admin-it-20261002-waline`、`dc-admin-it-20261002-admin` |
| 网络与卷 | 独立 internal bridge `dc-admin-it-20261002-internal`；独立数据卷 `dc-admin-it-20261002-pgdata` |
| 数据库 | 原始 `dc_admin_it_20261002` / `dc_waline_it_20261002` 保留；当前服务连接 `dc_admin_restore_20261002` / `dc_waline_restore_20261002` |
| 角色 | `it_admin_migration`、`it_admin_runtime`、`it_waline_migration`、`it_waline_runtime`、`it_waline_reader`；初始化/dump 使用仅限该实例的 `it_operator` |
| 媒体 | 当前使用 `restored-20261002/media-private`，public 目录为空，没有公开双副本回执 |
| 私有入口 | 后台在测试 Waline 网络命名空间监听 `127.0.0.1:4322`；专用 Unix relay＋独立 Nginx 提供宿主 `127.0.0.1:18444` TLS |
| Git/release | `release-drill/remote.git`、`release-drill/git-source` 的 `private-it` 分支及该目录内专用 site 根 |

后台 512MiB、Waline/PG 各 256MiB，均限制 0.5 CPU、128 PID、swap 不超过内存额度。后台/Waline 使用 uid/gid 1000、只读根、cap-drop ALL、no-new-privileges；后台没有 Docker socket。测试公网地址探测返回 ENETUNREACH。最终样本可用内存约 949MiB，后台/Waline/PG 分别约 35/163/74MiB；该样本不代表持续负载保证。

固定镜像 ID：

- PG：`sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`
- Waline/后台 Node：`sha256:1fffeb988fa7a5eb437d366a4a7a1ea1f4deacc102d5fe57415b3054976a7cb7`

## 通过的真实验证与限制

| 验证 | 证据与口径 |
| --- | --- |
| PostgreSQL | 当前后台 001–006 迁移及 Waline vendor→password-reset→昵称唯一→security-version 迁移在新空库执行；真实 TCP runtime 身份正确，DDL、跨库连接、reader UPDATE 和敏感列读取均被拒绝 |
| revision | 数据层 CAS 1→2，旧 revision 不匹配；真实后台过期保存返回 409 REVISION_CONFLICT |
| 身份 | 合成管理员真实注册/登录并开启 2FA，缺码拒绝、正确码通过；第二合成管理员被后台唯一 owner 限制拒绝 |
| 浏览器主链 | HTTPS＋Secure/HttpOnly/SameSite Strict 的 `__Host-dc_admin` cookie；登录→上传→新草稿→正文/附件→保存→返回→重开 r2，使用真实 API/PostgreSQL |
| 媒体 | Linux sharp 生成 WebP，认证原件回读 SHA 一致；匿名草稿/原件/预览返回 401。预览 job 路径仅验证认证门禁，没有生成 Astro 预览 |
| 评论/账号 | 后台通过真实 Waline 读写合成评论并回读；本人密码＋2FA 修改成功，signedOut 后 `/api/me` 返回 401。没有修改真实账号 |
| 移动视口 | 375×812，scrollWidth 375，保存正文可读；只证明移动读取和布局 |
| Linux release | 导入当前 `admin-release.py`，仅将路径常量固定到测试根，复用锁/fsync/验证/切换协议；候选 HTTP 可读，回退后 baseline HTTP 可读，Linux current symlink 指向 baseline |
| 逻辑恢复 | 停止本轮写入者，pg_dump/custom→pg_restore/list→新空库恢复；恢复前行指纹一致，quarantine 后会话撤销、合成 queued marker 隔离、合成 completed marker/effects 保留；媒体 SHA 一致 |
| 恢复启动 | 仅替换测试容器配置/测试 JWT；严格 TLS＋真实 2FA 登录、owner1、r2 草稿正文和 jobs 读取通过 |
| 恢复预算 | 恢复目录 fsync 保守满额 sync 80GB / edge 250GB journal；真实 MediaBudget 代码在无网络容器内拒绝 reserve(1) |

Waline 固定镜像的 OAuth 服务发现会访问外网；测试启动材料在同一回环提供 `{services:[]}`，避免无关外发阻塞，密码、2FA、存储与 management 仍由真实 Waline 执行。早期 `waline-checks.json` 的 `management_errno=1001` 来自错误查询路径，不计为通过；随后通过后台真实 management 路由完成读写回读。

草稿 `e06e12f4-ac52-4c47-8c1f-653746697e46`，路径 `private-integration-main.md`，标题“腾讯私有联调合成草稿”，正文“仅用于隔离联调的合成正文。”，r2、draft=true。媒体 `54e67f3f-dc8f-408a-a316-159f651a6fcb`：PNG 原件 94B、WebP 预览 64B。

- 原件 SHA：`402551f65cbbac07b5641274c66a02e0a95956490932eb02b9ef1102ac4ae48f`
- 预览 SHA：`7d0e92444a084dab9505dc2b98ba365a58c0ac668cf423c1c62ec138b4a327b1`

release 演练使用小型合成静态协议包（含合成 pagefind 标记），不是 Astro 全构建或后台发布流水线。baseline `20261002-e9398d9c55be`，candidate `20261002-c97f5c672a71`；测试 bare remote 保留 candidate，回退仅改变测试 current。恢复 jobs 是明确标记的合成恢复行，不冒称真实构建/发布任务。

## R2 部分验证

只读 API 确认 `dcelysion-db-backups` 无 custom domain、r2.dev 关闭，检查到的两个账号 Worker 无 R2 binding；不宣称排除所有可能访问路径。专用前缀 `admin-private-it/20261002/` 写前为空。

操作员使用已有 root-only 备份配置，通过 rclone 写入 47B 合成对象：

`admin-private-it/20261002/probe-bd80448ac96b85a74950feb17246c7d40fa135f081a5e854b8978380a10110a3.txt`

对象已存在，精确回读 SHA 为 `bd80448ac96b85a74950feb17246c7d40fa135f081a5e854b8978380a10110a3`，长度一致。但上传命令返回非零、失败 stderr 未保留，原因未确定；没有再次上传、覆盖或删除，对象保留。后台未取得该配置，ADMIN_R2 未配置；后台 SDK/同步、公开双来源、Range/交付回执仍未验证。

一次诊断输出曾带出本轮测试 Waline runtime 密码，已立即轮换并更新受保护配置；最终凭据未输出，生产秘密未读取或输出。

## 材料、备份与证据

本地均在忽略目录 `cache/admin-private-integration/`，非秘密 JSON 位于 `evidence/`，截图为 `browser-main.png` 和 `browser-mobile.png`。远端记录为 `pg-checks.json`、`waline-checks.json`、`release-checks.json`、`r2-checks.json`、`restore-checks.json`、`restored-runtime-checks.json`。

| 材料 | SHA-256 |
| --- | --- |
| 当前 backend-final.tar | `ba3f9bea4f1607133a6a6963ad7ee38345fc882ffe8c67d1a48d7dc207a9c1ec` |
| materials.tar：迁移/overlay/release/restore | `b7237638998e55c36f6cd622c52c0b26c617fcfdde2abe21ab79b0f612d047ae` |
| builder-context.tar：五个可信构建配置文件 | `f7f66a5879f82664e2ac35ce78c836749d6004f0573618ca6c84998868b35987` |
| 后台 dump，27255B | `81b931ade17f3d3d362bc26fabf998c4fb75b9b2d15a175c53746f9ae825ce42` |
| Waline dump，19083B | `0d716d3ce8d1686205a68af89c444bd7e7f09de924384c8fe2f54ca9c979a655` |

后台 bundle 保留当前 server/shared 实现及已有 admin/dist，178 文件 manifest 已在远端核对。esbuild 外置 Vite 动态配置、修正 require banner 别名；Linux musl sharp 依赖按锁文件 SHA-512 校验。没有以 Windows node_modules 冒充 Linux 原生依赖，没有重复全量博客构建。

备份在远端 `backup-20261002/`（0700），含两份逻辑 dump、媒体、测试 release metadata、Git bundle 与逐文件 manifest；恢复根 `restored-20261002/`。不含 `.env` 或凭据，也未建立生产备份计划/异地恢复保证。旧失败打包材料仅供排错，不作为当前运行包；一次性 provision/restore 脚本不可盲目重跑。

## 私有访问、保留与停止

当前 Origin 为 `https://comments.dcelysion.cn:18444`。独立 Nginx 复用已有有效证书、只监听宿主回环，不修改或重新加载共享服务。访问需要 SSH 将本机 `127.0.0.1:18444` 转至远端同端口，且专用浏览器将域名解析到 127.0.0.1；普通浏览器默认 DNS 不能直接访问。禁止忽略证书错误或改用不安全 cookie。

agent-browser 会话 `admin-private-20261002` 使用 `--host-resolver-rules=MAP comments.dcelysion.cn 127.0.0.1,--no-proxy-server`；每次 CLI 操作需保持该启动参数。测试密码/TOTP 仅在远端 0600 `synthetic-account.json`，不放聊天或文档。最终浏览器已因密码变更退出登录。

测试资源、合成 R2 对象和备份保留供检查；容器没有配置开机自动恢复，不承诺主机重启后入口仍可用。停止前核对 OWNER/标签，仅停止上述三个具名测试容器；独立 Nginx 使用 `sudo nginx -p /home/ubuntu/dc-admin-private-20261002/tls/ -c nginx.conf -s quit`，按 `bridge.pid` 核对命令行再结束专用 relay。本机隧道 PID 在 `cache/admin-private-integration/tunnel.pid`，核对命令行后可结束该 SSH 进程。停止不删除数据库卷、测试根或对象，禁止全局 docker prune/pkill/nginx restart。

## 剩余条件与发布状态

1. 用户确认暂无独立构建环境。1536MiB 构建额度超过约 949MiB 主机余量，后台也没有安全 Docker endpoint/固定构建镜像；MDX 执行和完整发布流水线保持禁用。五文件 builder context 已备妥但未构建镜像；后续需在独立可信环境制作并固定 digest，核对实际 endpoint、inspect/stop 与无网络/无宿主写入边界。
2. 后台 R2 同步需另配置隔离目标/受限凭据。本轮探针上传失败状态不能用回读成功覆盖，公开腾讯/R2 双来源仍关闭。
3. 没有找到已有后台 Umami Cloud key，未调用真实 API、生成 token 或改统计配置。
4. 全机 5Mbps/400GB 限额没有实测保障，只读 tc 现状不含已验证全机整形；未更改防火墙/tc/DNS，不将子预算等同全机上限。
5. Git 提交/推送：无；生产自动部署/正式 release 切换：无；Sites 同步/版本保存/部署：无。线上验证仅覆盖专用私有测试入口，不代表正式站点验收。
