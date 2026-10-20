# Memos 阶段二：同步器与隔离验证

日期：2026-10-18（Asia/Shanghai）。范围：同步器开发、本地/隔离验证。**Memos 实际安装、生产联调和正式发布仍未执行**；第一阶段只读与准备成果没有被改写为已部署。

## 已实现

入口为 [scripts/memos-sync/index.mjs](../../scripts/memos-sync/index.mjs)，运维说明见 [deploy/memos/SYNC.md](../../deploy/memos/SYNC.md)，占位配置见 [sync.example.json](../../deploy/memos/sync.example.json)。使用现有 Node、Sharp、marked、yaml，不改依赖或 package.json，不重做编辑器。

| 文件 | 职责 |
| --- | --- |
| `scripts/memos-sync/client.mjs` | 固定 v0.31.0 REST GET、作者 PAT、分页/响应/流式字节上限、超时和有界重试，拒绝重定向。 |
| `scripts/memos-sync/content.mjs` | 公开资格、语义摘要、安全 Markdown 子集、附件校验/保留原件/转码/动画、图片顺序与去重、站点时区文件名。 |
| `scripts/memos-sync/store.mjs` | 私有持久映射、状态绑定、双锁、文件所有权 SHA、journal、原子文件替换、进程中断恢复。 |
| `scripts/memos-sync/index.mjs` | 有界完整双读、详情复核、候选清单、apply、稳定身份/时间/评论路径、撤回及回执；强制 `publish:false`。 |
| `scripts/memos-sync/sync.test.mjs` | 真实本地 HTTP fixture 与文件系统测试，未调用远端实例。 |
| `scripts/memos-sync/prepare-build-fixture.mjs` | 当前源码隔离副本、合成动态/图片、历史文件哈希清单；依赖联接复用。 |
| `scripts/memos-sync/verify-build.mjs` | 完整构建流程、生成 JSON/图片/预览/历史 ID/评论页产物核对。 |
| `deploy/memos/SYNC.md`、`sync.example.json` | 可运行入口、配置、安全限制、运维与恢复说明。 |
| 本报告及原交接文档 | 阶段结果、限制与下一阶段依赖。 |

只导出明确 PUBLIC、NORMAL、指定作者的主动态。PRIVATE/PROTECTED/SPACE/归档/评论不导出；不会用 draft 保存私密正文。持久映射保存稳定 slug、文件名、首次实际观察到公开的时刻、源摘要和附件映射，撤回后仍保留身份。首次发布时间以带 Z 的 ISO 写入 frontmatter，文件名按 Asia/Shanghai 格式化；编辑、再公开不改变评论路径 `/dynamic/<slug>/`。

保留正文、标点、表情，只转换必要图片地址，映射 pinned 与 location.placeholder；不自动校对润色。原始 HTML/复杂图片/外链图片/危险链接等无法安全映射的内容整批失败，不静默修改原文。静态图片转 AVIF80，不缩放裁切，校正朝向并保留透明度；GIF/WebP 动画保留下载字节，无法安全转换时拒绝。原件私存、公开图片按哈希去重。保留的是 Memos 下载字节，未承诺等于用户上传前原件。

分页不完整、身份证明失败、附件下载/解码失败、源双读变化都不应用。已有记录消失必须结合完整扫描、作者认证和重复详情404；403/超时不当删除。手工改动、文件缺失、同名或 slug 冲突使整次停止。状态与输出目录互斥，旧任务不能越过新任务写入；绑定实例、作者、输出根目录、时区，禁止悄悄复用旧映射。

每文件临时写入+fsync+rename；先 journal、最后提交状态。未提交批次重启先回滚已知中间状态、再取新源，不重放陈旧公开候选。已提交但 journal 未清理时识别提交标记。它是受控单写者的进程恢复，不能宣称目录多文件对并发读者一次性切换或断电恢复。

## 已执行验证

```text
node --test scripts/memos-sync/sync.test.mjs
node node_modules/@biomejs/biome/bin/biome check scripts/memos-sync deploy/memos/sync.example.json
node scripts/memos-sync/index.mjs --help
node scripts/memos-sync/prepare-build-fixture.mjs
node scripts/memos-sync/verify-build.mjs --root F:/DcElysion-blog/cache/memos-stage2-U4xt0F/source --id 2026-10-18-120000-memos-01b89f9f1a4f5271 --direct-existing-tools
```

- 当前定向测试 **46/46 通过**，无跳过/取消：公开过滤、认证/协议、正文与图片顺序、原件/公开图片去重、透明度、GIF动画、EXIF朝向、HTML/危险链接/引用式图片拒绝、身份/首次时间/评论路径、同秒身份、重复运行、私密/归档/删除撤回及再次公开、403/分页失败/循环token/非法列表形状/附件失败保护、人工冲突、源变化、双锁、累计附件限额、崩溃前后恢复、成功跨页、重定向/流式超限、slug/状态绑定冲突、YAML时间及置顶/位置。List/Get 的计算字段或省略默认值不会被误认为源变化。最终运行约 12.3 秒。
- 新增脚本及配置的限定 Biome 只读检查通过；CLI help 与 Node 执行语法正常。没有运行全仓写入格式化；同步器为独立 mjs，未修改 Astro/Svelte/TS 业务实现。
- 合成动态 ID 为 `2026-10-18-120000-memos-01b89f9f1a4f5271`，两张静态测试图片故意使附件数组顺序与正文顺序不同，检验蓝图在前、透明红图在后。下载原件与转码结果对照图已查看，画面与透明度表现一致；这不是用户真实照片或 Memos UI 验收。
- 隔离副本创建时的 **39 个既有动态/图片文件**哈希不变。测试没有写入实际 `src/content/dynamic`；运行期间工作区有其他任务新增动态及 LQIP 改动，均保留，不属于本次合成构建验证。

### 完整构建结果

**完整构建流程与产物核对通过，退出码 0。** runner 为 `direct-existing-tools`，按 package.json 全部 10 个步骤执行，Astro 静态构建最终约 3 分 20 秒。LQIP 新增两张合成图，原有内容保持；完成静态页面/图片、Pio裁剪、字体子集、内联压缩、Pagefind、Sites本地产物准备和本地正式包跳过分支，没有任何部署动作。

`dist/api/dynamic.json` 包含 **15 条公开动态：14 条历史 + 1 条合成**，完整 ID 集与副本源内容匹配，无重复或缺失。合成正文及标点/表情、中间文字完整；首次时刻为 `2026-10-18T04:00:00.000Z`，避免 +8 小时时区误差。两张图片顺序为“蓝色在前”“透明红色在后”，原图均为 `/_astro/*.avif`，字节 SHA 与同步输出一致；逐项验证 6 个 WebP 预览/srcSet 文件和两个动态 HTML 页面，共 10 个生成资源存在。评论路径由稳定 ID 和既有 DynamicFeed 源码路径拼装契约核对，为 `/dynamic/2026-10-18-120000-memos-01b89f9f1a4f5271/`；未进行真实 Waline 浏览器交互。

Pagefind 有仓库现有非阻断提示：5 个页面无外层 html、zh-cn 不支持词干归并；索引步骤退出 0，此次未扩展搜索修复范围。最终生成 JSON 的 SHA、正文/时间、图片映射与历史文件复核见 `cache/memos-stage2-U4xt0F/artifact-proof.json`，完整日志见同目录 `build.log`，单测日志见 `tests.log`。

隔离目录为已忽略的 `cache/memos-stage2-U4xt0F/source`，私有合成状态在旁侧 `private-state`，日志与 fixture 回执在同一父目录。原件/图片对照图为 `image-comparison.png`。构建源码是创建副本时的当前工作区，含当时未提交的既有功能；不能将结果归于单一 Git SHA，也不涵盖随后并行新增内容。

修复复制清单后再次运行 prepare 工具也成功，生成 `cache/memos-stage2-hNGsND/source`，保留当时已增至 41 个既有动态/图片文件，配置及 worker 必需输入断言均通过。该后续副本只用于验证准备工具，未冒充上述已完成的完整构建副本。

### 环境问题与已修复的验证工具问题

- Windows 沙箱创建 node_modules junction 报 `EPERM`，仅对已授权的隔离副本准备执行受限提权后完成；未安装或改依赖。
- pnpm 11 自动依赖检查先遇联接 EPERM，随后安全拒绝 `ERR_PNPM_UNSAFE_MODULES_DIR`，没有绕过其删除保护。改为按当前 package.scripts.build 所有步骤顺序使用现有 tsx/Astro/Node；因此只能报告“完整构建流程经直接工具执行”，不能报告 pnpm build 成功。
- 初版验证工具漏复制带点名称的根配置及 workers 目录，分别出现 `ConfigNotFound`/`Failed to load ./astro.config.mjs` 和 Sites 产物准备的 `ENOENT ... workers/sites-static/index.js`；已修复复制清单，补齐副本后复测。Sites 步骤仅生成本地静态 worker，没有网络部署。
- 隔离副本使用本地 wrapper 配置覆盖 Astro/Vite 缓存到自己的 cache 子目录，避免 node_modules junction 让默认缓存写回主目录。未改主项目配置或主目录 dist；未恢复暂停的后台 MDX 执行器。完整静态构建仍使用仓库本就存在的静态 MDX 链。
- 单测初次曾因系统临时目录权限/Windows清理时序失败，改为仓库内独占 fixture 临时目录和限定清理重试；后续真实断言通过，未将环境失败计作成功。

## 仍须真实实例与第三阶段验收

1. 先取得实际安装/试用授权，按阶段一部署计划在服务器安装固定镜像、原版 UI 初始化/账号/PAT、私有入口、匿名/附件/分享访问策略、备份恢复与重启。当前没有执行这些操作。
2. 使用真实 v0.31.0 实例验证 `/api/v1/auth/me`、NORMAL/ARCHIVED完整分页、各可见性/评论/附件字段、文件鉴权、真实404/403、元数据与 UI 图片顺序。当前 fixture 基于固定源码契约，不能替代真实认证与联调。
3. 测量实际服务器资源限制下的原图解码/AVIF 编码峰值，验收照片朝向/色彩、动画、透明度及手机上传。384 MiB 试用额度没有因此被证明足够，不自动提高额度。
4. 阶段三另行授权独立发布 checkout、机器人 Git 权限、提交/推送及已有 GitHub→Cloudflare/EdgeOne 静态发布链。串行同步和构建，发布前再次核对最新源资格，验证撤回不会被旧构建覆盖；不调用暂停的后台 builder。
5. 以用户认可测试动态做真实 Waline 评论、上传/编辑/改私密/删除、双域版本/公开树/图片与线上回退验收。原有 `dynamicConfig.memos.enable=false` 保持未改，不迁移历史内容、不替换其他后台。

双读不是源事务，最终核对后的竞态仍需发布层处理。撤回删除 Markdown，**历史图片按原计划不自动物理删除**，Git 历史/旧构建/CDN也不被安全抹除；如有敏感图片清理需求另定范围。冲突目前整批停止。状态中的 `lastPublishedVersion` 为 null，回执明确本地同步、Git/部署禁用；未配置真实调度、发布或 CDN 清理。

本任务未执行 Git 提交/推送、服务器安装或生产写入、DNS、Sites同步/版本/部署、正式博客发布；未自动进入第三阶段或创建下一阶段对话。所有既有修改及未跟踪文件保留。

## 契约证据

本阶段补查固定 commit 的 [auth proto](https://github.com/usememos/memos/blob/2b2192d4e153bd04f1d325b60fd880cf00d68b01/proto/api/v1/auth_service.proto)（GET `/api/v1/auth/me` → user），[memo proto](https://github.com/usememos/memos/blob/2b2192d4e153bd04f1d325b60fd880cf00d68b01/proto/api/v1/memo_service.proto) 及 [memo 实现](https://github.com/usememos/memos/blob/2b2192d4e153bd04f1d325b60fd880cf00d68b01/server/api/v1/memo_service.go)。其余版本、部署和源契约证据沿用并区分 [阶段一报告](2026-10-18-memos-stage1-readiness.md) 的只读准备状态。
