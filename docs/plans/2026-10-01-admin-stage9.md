# 第九阶段：整体验收与上线准备

结论：本地整合主链与停写备份恢复已完成；**生产上线验收未完成，当前不能据此启用真实后台发布**。没有真实项目提交/推送、服务器部署、DNS、Sites、R2/腾讯写入或生产数据库操作。

## 环境与证据

| 范围 | 本阶段结果 | 证据/限制 |
| --- | --- | --- |
| 统一后台 | 模拟 Waline/R2/Umami + 磁盘 PGlite；真实业务 API、临时 Git 与 bare remote、本地 release | `admin/tests/acceptance-preview.ts`；生产入口不导入测试代码 |
| 一次主链 | 浏览器登录→新稿→上传/选用预览并链接原图→保存/重开 r3→固定差异→受保护预览→发布→HTTP公开正文/图片→查看任务→回退 | `cache/stage9-evidence/before-publish.json`、`after-publish.json`、`after-rollback.json`；fixture 构建明确标识，绝非不可信 MDX 容器构建 |
| 发布门禁 | 公开前媒体目录为空，匿名附件/预览/私有稿401，正文公开入口404；公开后原图SHA一致 | 候选实际包含 `src/content/posts/stage9-main.md` 和固定 `media-distribution.json`，无工作区私有文件或 `.env`；仅本地 bare remote |
| 回退 | current恢复基准 `20261001-7d40b7dd3df0`，新稿路径404；远端commit仍为 `385fafb6412ceb3354df3a782a1d0a815874b5fb`，媒体仍200/hash一致 | Windows文本指针适配器，不能代替腾讯Linux symlink/SSH实测 |
| 手机 | 同环境模拟登录、打开主稿、自动保存 r4、读取发布状态；375×812视口无横向溢出 | CSS内容宽360/scroll360（滚动条占宽）；`mobile.png`。r4未发布，固定发布任务仍r3 |
| 代表模块 | 配置源清单保留2首歌、1个相册和站点设置；评论3/用户2、Umami模拟PV120/UV7可读 | 不重跑这些模块的CRUD/错误矩阵；正常重启丢失进程内Waline bearer需重新登录，符合第六阶段边界 |
| 重启与恢复 | 1223文件的私有停写快照，含空目录；恢复r4、5个媒体引用、任务/effects/release及媒体哈希；完成任务没有重放 | `recovery.json`、`recovery-run.log`；**PGlite目录快照，不是pg_dump/pg_restore实测** |
| 恢复保护 | 会话撤销；未完成任务failed/restore_quarantine；当月两类预算满额预占后拒绝reserve(1)；恢复进程发布targets为空 | 原effects保留；拒绝已有目标、越界目标、坏摘要。运行时仍使用文件系统mock，不持有外部凭据 |
| 双来源 | 复用第八阶段可信Astro产物，核对核心选路源码一致和媒体key/hash一致，响应内只映射到新fixture端口 | `routing-reuse.json`、`routing-http.json`；首屏R2、一次capacity+双源probe、之后腾讯请求。本次主稿不具备真实腾讯资格，两类证据独立 |
| 既有证据复用 | 第八阶段10项隔离测试、前台检查、后台构建、可信博客构建及Swup/刷新/播放器/375px浏览器记录 | 来自第八阶段最终交付与 `admin/README.md`；本阶段未重跑八阶段矩阵或完整博客构建 |
| 必要检查 | 配置/鉴权相关5项测试通过；后台类型/Svelte 0错误0警告、后台构建通过；新增脚本类型通过 | `targeted-tests.log`、`admin-check.log`、`admin-build.log`、`scripts-types.log`；局部Biome记录按最终修复结果核对 |
| 备份最小回归 | 1项定向测试验证空目录、中文正文路径、停写确认和大写秘密文件拒绝；预算落盘fsync后仍拒绝新预占 | `backup-guard-test.log`；没有重跑主链/恢复矩阵 |
| 本机资源采样 | 恢复进程空闲/一次代表读取工作集约141/143MiB，CPU累计2.094→2.125秒；内容盘可用约15GiB | `process-sample.json`和概览采样；主链观察RSS约0.32GiB，不是压测/峰值或腾讯2核2GB容量证明 |

原第八阶段服务2126已退出，不假定旧进程可用；可信产物目录仍在 `cache/stage8-routing-blog`。`routing-reuse.ts`验证核心源码与媒体一致，复用产物而不重建或改写dist。未重新验证所有相册、播放器或异常选路。完整前台仍以第八阶段证据为主。

恢复诊断过程中保留了4个合成queued任务标记，最终都变为 `RESTORE_REQUIRES_REVIEW`；这些是恢复隔离验证数据，主链发布和预览任务仍是succeeded。恢复后只为读取代表配置创建了BGM/相册/设置私有r1快照，没有修改源配置或创建发布任务。

## 本次修复

- 生产模式禁止HTTP来源和 `ADMIN_ALLOW_INSECURE_LOCAL=1`；避免复制本地模板形成不安全生产入口。
- 配置执行器时必须枚举指定 Waline/Twikoo；Waline缺服务地址拒绝启动，不静默回落Twikoo。
- 媒体根部分配置、R2部分配置或未确认私有桶拒绝启动；全空表示未配置。
- 发布确认文案同步显示受控媒体分发快照，吻合第八阶段实际候选文件。
- 新备份工具的恢复试验发现漏掉PostgreSQL空目录，导致PGlite启动WASM Aborted；已将目录库存纳入manifest并实际恢复通过。未把失败称为通过；空目录修复后才通过最终演练。
- 整合fixture修复目录首页解析；这是本地验收服务器修复，没有改变正式Astro静态服务。

## 本地复现和当前入口

```powershell
corepack pnpm admin:build
corepack pnpm exec tsx admin/tests/acceptance-preview.ts
# 输出空闲端口、临时仓库和独立状态根；preview / preview，二步码123456。
```

主链通过现有UI执行，不提供伪成功按钮。`acceptance-audit.ts published`核对HTTP、媒体SHA、候选文件和本地remote；回退后 `acceptance-audit.ts rollback`保存证据并通过鉴权控制入口停写/关闭数据库。然后 `acceptance-recovery.ts`完成隔离快照、恢复、隔离SQL、预算和重启验证。恢复脚本只能用于这份合成环境，不是生产恢复入口。不要重复运行主链以替代已有证据。

本次恢复环境后台 **http://127.0.0.1:9445/**，当前基准前台 **http://127.0.0.1:9444/**。主链历史产物可访问 **http://127.0.0.1:9444/__fixture/release/20261001-1a42c3da805b/posts/stage9-main/**。可信Astro双来源演示 **http://127.0.0.1:8439/route-fixture/**。端口仅在本次进程运行期间有效；机器/进程退出后需重启。

恢复环境配置路径在 `cache/stage9-evidence/recovery.json` 的 `restored`。重新启动使用 `ADMIN_ACCEPTANCE_DIRECTORY=<restored>` 再运行同一入口。恢复环境targets为空，阻止旧任务/人工重试执行发布；不重新开放真实凭据。原始备份与恢复根位于系统临时目录 `dc-admin-stage9-drill-z82tN0`，不在公开静态目录。截图与机器证据都在忽略的 `cache/stage9-evidence`，不得当公开运维资料上传。

## 上线步骤与阻断项

以下是**待授权环境**的顺序操作，本阶段没有执行。模板为 `deploy/tencent/admin.env.example`、`dc-admin.service`、`nginx-admin-private.conf`，完整变量和运行角色GRANT见 `admin/README.md`；媒体独立服务继续沿用 `media-routing.md`。

1. 先在隔离Linux暂存环境确定单管理员ID、现有Waline overlay版本及数据库位置。按既有顺序应用Waline身份版本迁移（含003_security_version），后台按001–006顺序用迁移角色运行 `corepack pnpm admin:migrate`。后台DB与WalineDB若分开，二者均需备份。运行账号只保留README列出的表/序列权限；真实PostgreSQL权限、多连接CAS、Waline/2FA/版本撤销仍待实测。
2. 固定Node、项目pnpm和构建镜像digest。本机本次只查一次Docker/Podman可用性，仍无可用容器；不可信MDX隔离执行器继续阻断。须在暂存环境实际验证禁网/只读宿主输入/输出校验、资源限制与无数据库/Git凭据，不得用普通子进程降级。本地fixture构建与可信Astro构建都不能替代它。
3. 建立仓库只读源、独立 `/srv/dcelysion/admin-state`、`media-private`、`media-public`，私有根权限0700，配置0600。API和worker目前同一进程；systemd模板不是新增独立worker服务。媒体edge用独立只读账号，预算目录可写。不要把Docker socket直接给后台后宣称最小权限隔离；执行器宿主/受限daemon访问方案尚须在Linux核对。systemd模板的内存额度只是候选，必须结合PostgreSQL、Waline、构建容器总量验收，未证明2核2GB足够。
4. 服务器秘密由独立受保护配置提供，不放Git、公开构建变量或备份日志；Umami真实只读key、Git仓库级受限凭据、仅私有/公共桶范围R2权限及受限SSH release接口分别核对。Git远端URL不嵌token；SSH key不进构建容器。后台日志不得打印请求正文、密码、bearer、cookie或完整环境。现有错误日志与私有journal按运维策略限制访问/保留，例如14天；Nginx模板关闭私有访问日志，错误日志结合既有logrotate配置核对，不自动修改全机日志策略。
5. 先验证PostgreSQL/Waline健康，再构建admin并用固定 `NODE_ENV=production` 启动。模板仅回环监听；Nginx保留私有loopback TLS和现有SSH隧道，替换域名/证书路径后执行 `nginx -t`，确认Origin/Host/安全cookie、私有预览CSP、上传限制。模板未在Linux/systemd/Nginx加载验证，HTTPS入口未部署。没有新健康端点：`/api/status`仅表明配置就绪，不能证明依赖健康；须再用已授权管理员执行只读鉴权、草稿与发布能力读取。缺依赖必须显示不可用。
6. 将真实发布目标最后配置并检查确认页。先隔离Git/release试发布，再授权真实目标；推送GitHub **master会触发现有自动部署**，Git push成功与腾讯安装成功分别核对。腾讯 `admin-release.py` 沿用既有包摘要、release完成标记、部署锁、current原子切换。真实GitHub/SSH/腾讯Linux安装和中断恢复未联调；不要称模板准备等于部署完成。
7. 生产双来源保持关闭。只有真实R2/腾讯同版本副本SHA/MIME/长度、HEAD/CORS/TAO、音视频Range/206、HTTPS、capacity入口全部通过，再授予交付回执并启用策略。应用共享限速/并发/月子预算不覆盖其他服务器进程、协议或旧同步器；腾讯全服务器5Mbps/400GB保护仍是阻断项，需真实全出口控制及计量核对。本地延迟优势不能证明公网收益。
8. 独立备份/恢复演练（下一节）完成后再安排上线窗口。真实Umami、Waline/邮件通知、R2/腾讯、生产PG及不可信构建尚未联调；真实权限或环境缺失只阻塞对应联调。本阶段不索要生产权限，也未安装容器/修改系统虚拟化。

媒体历史Git/MDX/手工外链索引仍不完整，永久清理保持禁用。内容撤回仍未接入。它们不会由第九阶段验收自动变为已实现。

## 备份、恢复与回退操作

现有 `backup.sh`/`offsite-backup.sh`继续只负责既有Waline数据库，**不替代后台全状态备份**。不自动把新包加入既有R2上传或定时作业。公有R2副本不替代原件。

新增 `admin/scripts/state-backup.ts` 是停写的私有目录快照工具：要求明确停写参数，目标必须是批准父目录的新 `admin-recovery-*` 直接子目录；拒绝已有目标、链接/特殊文件、路径越界和常见秘密文件。manifest记录文件SHA/长度、目录（包括空目录）、时间与非秘密metadata；完成标记最后写入。恢复先核对完整目录/文件库存与摘要，之后只复制到新目录，失败不启动服务。它不会自行停止生产服务、恢复数据库或撤销会话；**必须完成后面的隔离步骤才能启动消费者**。

生产停写窗口按顺序停后台worker/API、媒体edge、其他写原件/预算的同步器；Waline身份若同时备份也须进入同一维护窗口。用受保护PG service/.pgpass配置（0600）调用，避免URL密码出现在命令/日志：

```bash
umask 077
# 私有暂存目录必须是全新目录，按实际运维路径选择；不要复制postgres实时数据目录。
mkdir /srv/dcelysion/admin-backups/prepared-UNIQUE
pg_dump --dbname='service=admin_backup' --format=custom --file=/srv/dcelysion/admin-backups/prepared-UNIQUE/admin.dump
pg_restore --list /srv/dcelysion/admin-backups/prepared-UNIQUE/admin.dump >/dev/null
# Waline若不同库，另用其受保护PG service执行同样的dump/list。
```

spec JSON仅包含 `components`（标签→已停写准备目录）和 `metadata`（源码commit、镜像digest、数据库/schema标识、current release ID等）；包含dump、媒体private originals/preview/manifest、public objects/distribution、执行器任务/effects/产物、source Git bundle、release包/文件/元信息、sync/edge预算journal、非秘密配置模板。先准备清单再运行：

```bash
corepack pnpm exec tsx admin/scripts/state-backup.ts backup /srv/dcelysion/admin-backups /srv/dcelysion/admin-backups/admin-recovery-UNIQUE /private/operator/spec.json --writers-stopped
corepack pnpm exec tsx admin/scripts/state-backup.ts restore /private/drill /private/drill/admin-recovery-UNIQUE /srv/dcelysion/admin-backups/admin-recovery-UNIQUE
```

工具默认拒绝`.git`；执行器临时git/缓存不打包，使用无凭据Git bundle保留必要基准/候选历史，核对effects commit均在bundle中。release的Linux current符号链接须以经过既有release接口核对的**ID**记入metadata，准备快照时不复制符号链接；恢复后用既有release校验/切换接口重新创建。旧worker/media锁不恢复为有效锁，保留原包取证。每份包含私有正文、数据库/会话摘要和媒体，始终私有，按独立备份加密/访问/保留策略保护；工具本身不做加密或异地复制。`.env`、SSH/R2/Umami秘密另用受保护运维密钥库恢复说明，绝不放包内或仓库。

只在新隔离PostgreSQL实例、新演练数据库（建议固定 `dc_admin_restore_*` 前缀）创建恢复目标；createdb须拒绝已有库，`pg_restore --exit-on-error --no-owner`，禁止`--clean`覆盖。运行角色权限重新核对，连接参数只来自演练专用PG service，**不得用生产ADMIN_DATABASE_URL**。目前没有可用隔离PostgreSQL，因此以上命令尚未实测。

首次启动前在新库执行 `deploy/tencent/admin-restore-quarantine.sql`：撤销后台会话，将queued/running发布任务和未完成媒体同步隔离，不清空effects或伪造ready。恢复运行环境不配置真实Git/SSH/R2写凭据/目标；人工retry仍属于写操作，必须先核对远端commit、current、digest、媒体副本和权限再逐项解除。恢复Waline生产身份时还须独立核对JWT密钥轮换/旧token失效，不能仅把备份auth_version加1当全局失效证明。

预算旧journal另存取证，在两份恢复journal为**当前UTC月**写实际配置额度的满额预占，fsync后才允许启动消费者；本次演练按80GB sync和250GB edge保守拒绝reserve(1)。未知/缺失计量不返还额度。跨月前继续禁用外部写入/edge，人工核对后才放开，不能单靠本月预占自动解除。实际备份调度应在上线授权后安排维护窗口、失败告警、容量/异地摘要回读及周期恢复；本阶段没有创建timer或真实备份作业。

正常回退：先核对保留release摘要/完成标记，使用后台回退确认或既有腾讯接口指定期望current和目标release，原子切换并HTTP核对。**不反写Git、不回滚整库、不删除媒体**。Git已push而安装失败时保持部分完成并核对收据，禁止强推或盲目重复安装；恢复环境中的待核对任务不自动重发邮件/push。schema变更的代码回退须单独核对兼容性，禁止用数据库备份覆盖日常新增内容。
