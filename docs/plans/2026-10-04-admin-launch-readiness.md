# 统一管理后台：最近更新与上线准备（2026-10-04）

本记录合并各阶段交付、当前工作区和最新联调记录。它是上线准备基线，不代表本次重新验证服务器、提交 Git 或执行上线。范围以完整后台为目标；仅编辑版材料保留作回退参考。

## 最近更新

| 模块 | 最新已完成结果 | 上线时需要处理 |
| --- | --- | --- |
| 后台主体 | 文章/动态私有修订、评论/用户、BGM/相册/设置、发布任务、媒体库与概览已实现 | 使用当前完整源码生成一个整体包，不拼接旧服务包与零散补丁 |
| PostgreSQL / Waline | 独立真实测试实例的权限、2FA、CAS、私有编辑、账号失效和逻辑恢复通过 | 正式账号与数据库不得沿用合成测试身份；复用联调证据，按实际版本补必要迁移 |
| R2 私有暂存 | 原件和预览同步、重启后持久状态与对象校验通过 | 部署正式受保护配置，不将上传直接公开 |
| R2 按用途交付 | article、gallery、wallpaper、music 四用途真实对象交付通过 | 保留用途、固定发布目的地和旧对象 URL，不搬迁历史媒体 |
| 自建 Umami | 腾讯 Umami 3.4.0、TLS、只读看板、真实统计读取及每日本地/R2备份通过 | 正式后台消费自建配置；主站部署后记录实际采集切换时间 |
| 构建服务 | 服务器专用 rootless 运行时、受限接口及固定依赖镜像已准备 | 最近真实请求返回 422，未证明 MDX 构建/预览/完整发布成功；用户要求暂缓 |
| 前台会话选路 | 单会话选路、Swup复用、有限备用、播放来源锁定已有本地证据 | 腾讯公开副本/入口及容量保护尚未联调，正式策略保持关闭 |
| 备份/回退 | 后台真实测试库恢复、Linux测试release回退通过；Umami dump/R2回读通过 | Umami完整恢复未实测；正式后台备份范围与版本切换要包含新配置和迁移 |

R2 目的地：文章使用 `dcelysion-admin-public` / `admin-media.dcelysion.cn`，相册使用 `dcelysion-gallery` / `gallery.dcelysion.cn`，壁纸使用 `dcelysion-wallpapers` / `wallpapers.dcelysion.cn`，音乐使用 `dcelysion-music` / `music.dcelysion.cn`。未发布素材先进入 `dcelysion-admin-private`。音乐桶本轮用图片验证封面交付，没有重新验证音频 Range 或全歌单播放。

Umami 采集配置已在源码指向 `stats.dcelysion.cn`，网站 ID 为 `3317734c-d6c0-44f7-8e45-a2945dce43fd`。Cloud历史保留，不合并、不同时加载两份采集脚本。管理API仍受私有入口限制；后台使用回环或受隔离的内部地址，不解除公网管理限制。

## 必须统一的部署输入

1. 完整后台当前源码、客户端产物及 Linux 运行依赖。旧包和 `index.before-umami.mjs` 仅供回退；Umami任务曾局部替换统计模块，不能当作最终整体部署包。
2. 当前后台迁移至 `007_media_purpose.sql`；先核对正式数据库已应用版本，再按需增量，不重跑一次性联调初始化脚本。
3. R2用途目的地、私有桶、受保护凭据、固定公开域名和对应本地目录。恢复后的满额预算 journal 是保护证据，不能清空后直接转为正式预算。
4. `ADMIN_UMAMI_SOURCE=self-hosted`、正确站点 ID、只读 API key 和内部API根。 `/opt/dcelysion-umami/dashboard.env` 是受保护配置来源；其中公网API根不能直接用于被禁止的外部管理访问。
5. 正式 Waline 管理员身份、后台独立持久存储、发布目标和备份。测试 owner、测试库、合成任务与QA统计都不能伪装为正式数据。
6. 正式主站产物中的自建统计脚本、域名白名单及最新媒体清单。当前前台源码已改，但正式主站尚未部署采集切换。

## 发布门槛与授权

- 既有“接通后统一上线”、服务器专用 rootless 安装、R2建桶/指定域名/用途调整、自建Umami部署授权应随接续记录保留，不反复询问笼统许可。
- 最新明确限制仍有效：不在用户电脑安装构建环境；MDX构建暂缓。准备上线不自动撤销该暂停；再次实际构建前需确认恢复这一项。
- 完整预览/发布启用前必须解决并验证构建入口 422。不得用普通宿主子进程、fixture发布或已制作镜像替代真实隔离构建证据。
- 腾讯双来源启用需要真实公开入口、双副本回执与容量保护。5Mbps速率和400GB月流量是不同约束；应用子预算不证明全服务器保障。
- Umami最新已真实接通，不再列为“缺Cloud key”的阻断。永久媒体清理保持禁用；内容撤回尚未接入，不能宣称已实现。
- 本轮请求是整理更新、准备上线。本次不执行真实Git提交/推送、正式release切换或Sites；既有master推送会触发自动部署，准备时单独标示影响。

## 执行顺序和必要验证

1. 从当前工作区选定本任务文件，生成候选文件清单与包摘要。`git diff --stat` 不包含未跟踪的 `admin/` 等目录，不能据此打包遗漏；排除秘密、缓存、截图、测试数据及任务外 `.review-build.log`，保留工作区原文件。
2. 把R2用途配置、自建Umami及后台当前迁移作为整体部署输入，准备受限配置模板、版本记录和回退步骤。若有源码变更，只修复实际阻断或契约不一致。
3. 复用R2四用途、真实PG/Waline、统计和回退证据。整体包构建一次；有集成代码修复才补对应类型/定向测试，不重跑九阶段矩阵。
4. 将整体候选包先用于既有隔离测试实例，进行一次登录、读取/保存私有草稿、读取自建真实统计和匿名拒绝确认，核对R2配置角色与状态，不重复写四用途对象。
5. 单列仍待恢复的MDX构建和腾讯双源条件。条件未满足时不宣称完整正式上线完成，不自行改成仅编辑版统一切换。
6. 正式切换前固化实际目标、旧版本/数据库迁移状态、备份与基本回退。只补正式入口的必要确认；非阻断体验/兼容问题列后续，不扩大测试。

## 证据来源与本次状态

- [九阶段本地验收与恢复](2026-10-01-admin-stage9.md)
- [真实 PostgreSQL / Waline / Linux / 恢复联调](2026-10-02-admin-private-integration.md)
- [构建服务与四用途R2交付](2026-10-03-admin-runtime-integration.md)
- [自建Umami、真实数据与备份](2026-10-04-umami-selfhost.md)
- [仅编辑版回退参考](2026-10-03-admin-edit-only-launch.md)

本次仅检查当前工作区、配置和上述交付记录，统一文档状态；没有重跑历史联调、访问生产凭据、变更服务器或发布。正式后台和主站整体切换仍待执行；自建Umami及R2域名服务已由此前获授权任务完成部署，不能概括为“所有服务均未部署”。

## 2026-10-04 完整候选包整合交付

本节更新上文“仅整理文档”的本轮状态：已从当前工作区生成完整源码快照，在腾讯专用 rootless 依赖镜像内重新构建整个后台客户端/API，并替换**已有隔离联调后台**完成一次融合验收。正式后台、主站、DNS、Sites 和生产数据库没有切换；没有 Git 暂存、提交或推送。没有修改后台业务源码，新增的是打包、隔离构建/部署/验收材料及正式配置模板。

### 版本与可审查材料

- 源码基准 `d2397f040d8d35b8ef213dc9e9ade903eb5380cd`，工作区版本 `6.16.8`，含此前未提交/未跟踪成果。源码包是该基准的当前文件快照，不含 `.git`；正式内容工作树应保留独立 Git 元数据，不能把快照当 Git 仓库。
- 本地交付根 `cache/admin-launch-20261004/`（Git 忽略）：`source.tar.gz`、逐文件 `source-manifest.json` / `source-files.txt`、`source-archive.json`、`admin-candidate.tar.gz`、运行包 `manifest.json` 和最小验收 `smoke.json`。源码摘要在外部 sidecar 中，避免把包自身摘要写回包内文档。正式源码选取包含 `admin/`、迁移、部署/媒体/统计适配器、前台、既有内容和资产；排除用户 `AGENTS.md`、`.review-build.log`、秘密、测试状态、截图及缓存。没有 `git add -A`。
- **后台运行包**：9,147,600 字节，SHA-256 `c007dae3287415fafe3575551d9de88ba536b69467d15ae3daac142f65cc2d0c`；141 个文件，由整个当前 API bundle、本轮 `admin/dist`、迁移 001–007、builder 辅助文件及 Linux 原生运行依赖组成。不是旧入口拼接 Umami 补丁，也不含数据库、env、媒体私有数据或 Git/R2/统计凭据。
- Node `24.20.0`，符合项目 `>=22.23.0`；pnpm `11.22.0`。依赖镜像 `sha256:7d80192eb45362b46bc601b7ef5243cb772ae456f8a48b8d3fa034c4de8c9210`；实际 Linux x64 **musl**，不是仓库 Dockerfile 的 Debian/glibc。镜像内 package/lock/workspace 的 SHA 与当前构建输入逐项一致；entrypoint/read-input 与既有镜像准备记录一致。sharp `0.35.4` / libvips `8.18.6` 来自此固定镜像，候选包本身生成 1×1 WebP 成功，未带 Windows 原生依赖。
- 后台运行时仍用隔离 Node 镜像 `sha256:1fffeb988fa7a5eb437d366a4a7a1ea1f4deacc102d5fe57415b3054976a7cb7`；正式后端也必须提供匹配 Node/libc 的运行环境，不能把本包放进 glibc 后直接宣称 sharp 可用。

生成源码快照：`node scripts/prepare-admin-candidate.mjs cache/admin-launch-20261004 --source-only`。默认不带 `--source-only` 会额外生成后台构建输入。服务器可信打包入口为 `deploy/tencent/build-admin-candidate.mjs`，隔离构建、部署及最小验收入口分别是 `admin-launch-build.py`、`admin-launch-isolated.py`、`admin-launch-smoke.py`。这些 Python 入口固定本次 OWNER/资源名及数据库，属于本次联调材料；**不是正式切换的一键脚本，不可重复初始化旧测试库**。

### 服务器构建与融合结果

可信后台构建限制为 512MiB 内存、总 memory-swap 768MiB、0.5CPU、192PID、15分钟；断网、只读镜像、cap-drop/no-new-privileges，没有任何秘密或生产数据挂载。使用 rootless daemon 所有者映射的容器 uid0 处理可信打包目录，不运行用户 MDX。没有安装本机运行时，没有停止 Umami 或生产服务。构建前可用952MiB；最终约1070MiB，未发生容器 OOM 或宿主余量停止。

必要结果：

| 项目 | 本轮实际结果 |
| --- | --- |
| TypeScript / Svelte | 服务器当前输入检查通过，Svelte 0错误/0警告 |
| 完整客户端/API | Vite构建通过；整个当前API重新bundle；客户端HTTP资产摘要与候选包一致 |
| 真实认证 | 现有合成账号通过真实Waline＋TOTP；Secure/HttpOnly/SameSite Strict cookie成立 |
| 草稿 | 现有合成私有草稿读取→原文保存→回读，revision 2→3；原文未改 |
| 自建统计 | 同Docker内部入口读取成功；PV2 / UV1 / visits1，未合并Cloud历史 |
| 私有门禁 | 匿名 me、统计、正文、原件、预览、保存均401 |
| 媒体配置 | syncConfigured=true，四用途已启用，固定桶/域名/目的地核对；旧私有原件/预览SHA与既有记录一致 |
| 发布暂停 | 未创建发布执行器，已认证发布请求503 TARGET_NOT_CONFIGURED；未启动MDX容器或Git/release副作用 |

构建过程中记录了 pnpm11 自动依赖目录保护、320MiB Node heap不足以及 Vite向只读依赖目录写临时配置三个环境问题；分别以核对输入后调用固定CLI、在容器额度不变时使用416MiB heap完成类型检查、使用runner配置加载方式解决。原生依赖复制遇到 sharp package exports 限制后改为从已安装pnpm目录复制，随后实际加载/处理通过。检查和客户端/API产物通过后复用，不重复编译或扩展测试矩阵。完整日志保留服务器 `launch-20261004/build*.log`，最终 `build-result.json` exitCode=0、oomKilled=false。

前台自建统计和可信 Astro 产物复用[Umami最新记录](2026-10-04-umami-selfhost.md)；本轮没有重新执行主站完整构建，也没有生成新的MDX预览。R2四用途HTTPS交付与持久状态复用[用途交付记录](2026-10-03-admin-runtime-integration.md)，未重传对象。隔离后台网络仍为 internal、没有公网出口；本轮只核对R2配置/目的地和既有私有读取，**未验证候选服务器的新SDK同步网络路径**。正式配置必须准备仅允许所需S3端点/桶子域名的受限出口，不能直接解除所有外网限制。

### 隔离版本、迁移与回退

远端候选根 `/home/ubuntu/dc-admin-private-20261002/launch-20261004`，新容器 `dc-admin-it-20261004-candidate`；旧 `dc-admin-it-20261002-admin` **停止但保留**。PG/Waline及原数据卷未重建；原后台目录、Umami补丁入口、配置、预算journal和此前备份保留。仅一个媒体worker访问原恢复私有根。启动前确认没有queued/running媒体，未对历史failed媒体执行重试，也未清空恢复后的保守满额预算。

隔离库仍为 `dc_admin_restore_20261002`。复用已验收001–006，核对8张表与005/006增量列；007前媒体仅有 `media_pkey`，本轮只应用缺失的007两项用途/目的地约束。正式库必须独立检查实际对象/约束，不按这个测试库状态推断版本。007为增量约束，没有搬数据或改旧媒体document。

007前新测试库custom dump：`launch-20261004/before-007.dump`，SHA-256 `37f86eaaa1a74cb249c251be7a951759100f4bc6bb3ab999b76aca481ced73ff`；受保护 `previous-container.json` 含原启动参数/环境，`candidate.env` 与 `r2-runtime.json` 为0600，不纳入可分发包。`deployed.json`、`schema-before.json` 与 `smoke.json` 是非秘密证据。此轮没有重做已通过的数据库恢复或Linux静态release回退。

本次隔离后台回退模板（先核对OWNER/任务标签；仅具名容器）：

```sh
test "$(cat /home/ubuntu/dc-admin-private-20261002/OWNER)" = dc-admin-private-integration-20261002
sudo docker inspect dc-admin-it-20261004-candidate --format '{{index .Config.Labels "dc.task"}}'
sudo docker stop --time 60 dc-admin-it-20261004-candidate
sudo docker start dc-admin-it-20261002-admin
```

回退重新使用旧容器完整包和受保护配置，不恢复/覆盖数据库；007兼容旧记录且可保留，不能把回退当降迁移。候选保存后的合成revision3也保留。原TLS relay仍指向同一4322端口，故无需共享Nginx reload。候选最小验收脚本失败会恢复旧隔离容器；本次通过，候选保持运行。

私有查看方式沿用 `https://comments.dcelysion.cn:18444`：SSH只监听本机回环的18444转发＋专用浏览器把comments域名映射至127.0.0.1，严格验证TLS；合成账号仅从原0600 `synthetic-account.json`读取。本轮TLS验收从服务器回环完成，未重新证明这台Windows电脑的隧道/浏览器连通。该地址是**隔离后台**，不是正式个人后台。

### 正式切换清单与命令模板（本轮未执行）

1. 固定正式后台域名/服务路径、真实Waline owner、独立正式后台DB和Waline reader；使用 `deploy/tencent/admin-unified.env.example` 生成受保护配置。模板包含四用途、私有上传、自建内网统计及受限发布目标；完整填好前有意不具备启动条件。key从受保护文件注入，不通过命令行展开、不dump环境。正式配置不沿用测试库/owner/预算；独立备份纳入DB、媒体、状态journal、版本manifest和配置（秘密另行受保护保管）。
2. 为正式应用提供匹配的Node24/musl运行镜像、私有TLS入口和受限S3出口；后台使用同机回环或固定内部Umami地址，保持公网管理403。保留当前版本目录及启动参数；不要把静态站的 `admin-release.py` 当后台安装器。
3. 正式迁移前在明确正式库核对8表/005–006列及007约束并备份。示例增量只能在缺007时以独立迁移账号执行：`PGSERVICEFILE=/etc/dcelysion/admin-migration.pgservice PGSERVICE=admin-migration psql -v ON_ERROR_STOP=1 -f admin/server/migrations/007_media_purpose.sql`。先准备0600的libpq service文件，明确正式目标，密码不展开到命令行；迁移配置不进入runtime，不得重跑一次性测试provision/restore。
4. 后台候选解包到新版本目录并逐文件验证；切换前停止旧后台媒体/发布worker，保证私有状态只由一个实例使用。指向新版本的完整入口 `node <NEW_VERSION>/admin/server/index.mjs`；失败则停止新实例、启动保留的旧版本＋旧配置。记录实际镜像、包SHA和版本目录，而不是混用旧index补丁。
5. **等待用户明确恢复此前暂停的MDX**后，解决真实入口422，以既定资源上限验证隔离构建和真实预览/发布链，再配置executor/remote/branch/release目标。完整发布目标尚未成立时不自行改为仅编辑版正式上线。腾讯双源须另外补同版本公网副本、回执及全机5Mbps/400GB保护，保持关闭。
6. 主站使用完整源码/清单重新生成正式产物并按既有统一路径切换；保留旧site包、摘要、current/previous、数据库备份。静态站回退采用stdin JSON协议：先准备 `rollback-request.json`，内容为 `{"action":"rollback","id":"<OLD_RELEASE>","expected":"<CURRENT_RELEASE>"}`，实际核对版本后用 `sudo /usr/local/libexec/dcelysion-admin-release < rollback-request.json`；后台API回退另有目标fingerprint确认，不能用后台运行包代替site.tar.gz。Git master推送会触发 `.github/workflows/deploy.yml` 的Pages构建与部署；本轮未推送。届时分别记录Git、自动部署、腾讯release及自建采集切换时间；Sites仍需要单独明确授权。

尚待项为已暂停的MDX构建/完整发布、候选服务器受限S3同步出口、正式身份/持久存储与服务切换、腾讯公网双源与全机限额。永久清理仍禁用，内容撤回仍未实现；非阻断体验项留后续。现已交付完整候选包和可回退的隔离融合结果，不宣称正式上线完成。
