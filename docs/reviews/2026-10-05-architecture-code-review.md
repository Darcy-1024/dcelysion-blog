# DcElysion 架构与模块代码审查

审查日期：2026-10-05。基线：`48e0155ea115`。范围：当前工作区的博客、私有后台、构建脚本、Workers 和腾讯部署代码。

本轮只审查并生成本报告，未修复源码、提交、推送或部署。保留原有 `AGENTS.md` 修改和 `.review-build.log`。没有读取真实密码或服务凭据，没有访问生产数据库或执行生产操作。

## 结论

当前“静态内容站点 + Svelte 交互岛 + Swup 导航 + 独立私有后台”的划分适合项目。内容生成、前台浏览、后台写入和候选发布之间已有明确边界，没有发现需要改成全站 SSR 或整体重写的依据。

发现 **9 项需要处理的问题：1 项 P1、8 项 P2**。其中 P1 是文章与相册共用的加密实现；其他问题涉及异步请求、内容路径、sitemap、测试和外部 HTML。外部 HTML 问题有启用条件，当前默认关闭 Memos，不能据此断言线上已被利用。

优先级含义：P1 应优先修复；P2 应安排修复；后文优化建议不等于已发生故障。

## 1. 需要处理的问题

### F1 · P1 · 加密参数重复，同时暴露了低成本的密码校验值

位置：[crypto-utils.ts:28](F:/DcElysion-blog/src/utils/crypto-utils.ts:28)。文章与密码相册都使用这个函数。

`salt` 和 `iv` 由密码、slug 的 HMAC 固定生成。同一页面保留密码并更新正文时，AES-GCM 的密钥和 IV 都不变。取得两个版本密文的人可以算出对应明文的异或关系，已知一版内容时可以恢复另一版的对应字节。GCM 要求同一密钥下 IV 不重复，依据见 [NIST SP 800-38D，第 8 节及附录 A](https://nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-38d.pdf)。

另一个独立问题是：输出开头的 `salt` 就是 `HMAC(password, "salt:" + slug)` 的截断值。对候选密码做一次 HMAC 即可比对公开的 salt，不必执行原本用于增加猜测成本的 100000 次 PBKDF2。这个问题只需要取得一个版本的密文。

**已验证：**调用真实 `encryptContent()`，仅使用合成密码、slug 和两个等长合成正文，得到：

```json
{"saltReused":true,"ivReused":true,"ciphertextXorEqualsPlaintextXor":true,"hmacAloneValidatesPassword":true}
```

**建议：**每次加密独立生成随机 16 字节 salt 和 12 字节 IV，保留现有密文封装格式。[Node.js PBKDF2 文档](https://nodejs.org/api/crypto.html#cryptopbkdf2syncpassword-salt-iterations-keylen-digest)也建议使用随机、至少 16 字节的 salt。

客户端已经从密文读取 salt/IV，见 [EncryptedContent.astro:157](F:/DcElysion-blog/src/components/features/EncryptedContent.astro:157)，所以可兼容这一修改。浏览器缓存的是密码字符串，并非固定密文，随机化不会破坏其正常复用。若后续修复需要重新生成并发布已有加密页面，应单独核对旧版本暴露范围和发布授权；本轮没有进行这些操作。

### F2 · P2 · 搜索页会被较早请求的结果覆盖

位置：[AdvancedSearch.svelte:43](F:/DcElysion-blog/src/components/pages/AdvancedSearch.svelte:43)。

连续输入两个关键词时，两次 `pagefind.search()` 和结果数据加载可以并行。代码没有请求序号，较早的请求最后完成仍会覆盖 `results`，并提前或延后改写 `isSearching`。组件卸载时，也未清理 debounce 定时器及尚未触发的 `pagefindready` 监听。

**已验证：**提取实际组件脚本，以合成 Pagefind 响应控制完成顺序。新查询先完成、旧查询后完成，最后状态是：

```json
{"advancedSearchFinalKeyword":"newer","advancedSearchDisplayedTitle":"older"}
```

**建议：**复用 [Search.svelte:105](F:/DcElysion-blog/src/components/controls/Search.svelte:105) 已有的请求序号模式，只有最新请求允许更新结果和加载状态；卸载时失效请求、清理定时器和监听。Pagefind 查询不一定支持直接取消，序号检查仍能解决结果覆盖。

### F3 · P2 · 动态页卸载后，旧请求仍修改新页面的 URL 和 DOM

位置：[DynamicFeed.svelte:325](F:/DcElysion-blog/src/components/pages/dynamic/DynamicFeed.svelte:325)，清理逻辑位于 [DynamicFeed.svelte:361](F:/DcElysion-blog/src/components/pages/dynamic/DynamicFeed.svelte:361)。

`load()` 完成后会全局查询计数元素、读取当前地址并调用 `history.replaceState()`。卸载时仅移除筛选监听，没有取消 fetch 或阻止旧异步任务继续写入。Swup 快速切走再进入动态页时，旧实例可能改动新实例的页码和计数。

**已验证：**执行实际组件脚本的挂载和清理逻辑，用延迟合成响应模拟旧请求；清理后把地址设为 `/dynamic/?page=2`，再返回旧实例的空数据，地址被改成 `/dynamic/`：

```json
{"lateResponseAfterUnmountChangedPageTwoUrl":true,"finalUrl":"https://synthetic.invalid/dynamic/"}
```

这证明卸载后的副作用仍会发生；未声称已在真实浏览器复现所有 Swup 切换状态。

**建议：**本地 fetch 加 `AbortController`，同时用 `disposed` 或实例序号保护所有 await 后的副作用。涉及去重共享请求时，不应由一个消费者随意中止其他消费者的请求，仍需实例失效判断。计数查询应限定在当前页面容器内。侧栏动态组件也应沿用相同约定。

### F4 · P2 · 请求去重工具在调用方已捕获失败后仍产生未处理拒绝

位置：[fetch-dedup.ts:17](F:/DcElysion-blog/src/utils/fetch-dedup.ts:17)、[memos-adapter.ts:141](F:/DcElysion-blog/src/utils/memos-adapter.ts:141)。

`promise.finally(cleanup)` 创建并返回另一个 Promise。当前忽略这个返回值，却把原始 Promise 返回给调用方。接口失败时，即使调用方已经 catch，额外生成的 Promise 仍会拒绝且无人处理。影响动态侧栏和 Memos 请求，产生额外 `unhandledrejection`；本轮没有把它描述为已经导致生产进程退出。

**已验证：**实际导入 `fetchWithDedup()`，注入失败的合成 fetch，并 catch 调用结果，仍监听到额外的 `unhandledRejection`：

```json
{"caughtCallerStillEmitsUnhandledRejection":true}
```

**建议：**把清理后的 Promise 作为缓存及返回值，或者用成功、失败两个处理分支执行不会抛出的清理。保留现有请求合并功能。

### F5 · P2 · Wiki Link 的默认文章 ID 与 Astro 不一致

位置：[remark-wiki-link.js:77](F:/DcElysion-blog/src/plugins/remark-wiki-link.js:77)。

未声明 frontmatter `slug` 时，插件直接使用原始文件路径。当前安装的 Astro glob loader 则逐段调用 GitHub slug 规则，再处理 `/index`。包含大写、空格或部分标点的文件名，会得到不同 URL。

**已验证：**以合成文件路径 `src/content/posts/My Note.md` 执行插件的实际路径函数，插件得到 `/posts/My%20Note/`，而安装版本的 Astro 规则得到 `my-note`。因此这类受支持的文件名会生成错误的文章链接；未断言当前已有文章恰好使用了这个文件名。

**建议：**统一文章身份规则，按当前 loader 的行为处理显式 slug 和默认 slug。后台 [identity.ts](F:/DcElysion-blog/admin/shared/identity.ts) 已有相应规则，可整理为前后台及插件都能使用的轻量纯模块。修复时需验证显式 slug、嵌套目录和 index，避免仅处理空格。

### F6 · P2 · 页面开关与 sitemap 过滤不一致

位置：[astro.config.mjs:238](F:/DcElysion-blog/astro.config.mjs:238)。

`projects` 默认关闭，项目列表及详情路由都检查这个开关并重定向到 `/404/`，但 sitemap 没有过滤 `/projects/` 及其子路由。动态页过滤仅匹配 `/dynamic/`，评论子路由也未完整跟随 `pages.dynamic`。这会把关闭后不可用的页面作为可索引页面列出。

**依据：**代码守卫与 sitemap 条件直接不一致。现有 `dist/sitemap-0.xml` 也包含 `/projects/`，该文件生成时间为 2026-10-04，作为补充证据，不当作本轮新构建或线上现状的证明。页面开关可被环境变量覆盖，本项结论是“关闭开关时过滤规则不完整”。

**建议：**近期补齐项目及动态子路由过滤；后续把页面路径、开关、是否允许索引集中到小型路由表，供导航、sitemap、llms 和守卫使用，减少多处手工维护。

### F7 · P2 · 后台配置迁移回归测试已经失败

位置：[configuration.test.ts:33](F:/DcElysion-blog/admin/tests/configuration.test.ts:33)。

测试从 `HEAD` 复制 `musicConfig.ts`、`galleryConfig.ts` 到临时目录，然后独立 import。当前配置已经依赖 `manifest-adapters` 和 JSON manifest，临时目录没有这些文件，因此报 `Cannot find module './manifest-adapters'`。

此外，`HEAD` 随提交变化，并不能长期代表“迁移前配置”。只补复制依赖可以消除 import 错误，但仍不能保证这个测试持续验证迁移保真。

**已验证：**在正常权限下执行完整后台测试，36 项中 35 项通过，唯一失败就是该用例。失败属于测试基线和装载方式问题，不是“后台整体无法运行”的证据。

**建议：**使用固定的迁移前合成 fixture，明确保留音乐列表、相册扫描/预览和受支持设置的比较；如果确需历史源码，应固定版本并提供完整依赖，避免跟随可变 HEAD。

### F8 · P2 · CI 未执行私有后台的独立检查和测试

位置：[build.yml:41](F:/DcElysion-blog/.github/workflows/build.yml:41)、[biome.yml:20](F:/DcElysion-blog/.github/workflows/biome.yml:20)。

工作流执行博客 `check`、根目录 type-check 和博客构建；质量检查仅覆盖 `src`。根 tsconfig 的主要范围是 `src`、`scripts`，没有专门执行 `admin:check`、`admin:test` 或 `admin:build`。后台登录、权限、草稿版本和发布流程的回归测试因此没有成为 CI 门槛，F7 也不会被现有测试步骤发现。

**建议：**增加一个使用项目固定 pnpm 的后台 job，运行已有三条后台命令。侧栏布局的 7 项轻量测试也可纳入现有检查。按实际改动补充必要检查即可，不需要每次增加全站浏览器矩阵。

### F9 · P2 · 外部动态/Memos HTML 缺少净化边界（有启用条件）

位置：[memos-adapter.ts:44](F:/DcElysion-blog/src/utils/memos-adapter.ts:44)、[DynamicFeed.svelte:246](F:/DcElysion-blog/src/components/pages/dynamic/DynamicFeed.svelte:246)。

Marked 默认保留原始 HTML；自定义链接渲染也直接插入 href/title。动态流随后把 HTML 写入真实 DOM 的 `innerHTML`。若启用外部源，带事件属性或危险链接的内容可以进入页面。[Marked 官方文档](https://marked.js.org/)明确说明其 HTML 输出不自动净化。

**已验证：**给真实 `fetchMemos()` 注入合成 PUBLIC memo，其中包含带 `onerror` 属性的 `<img>`，输出 HTML 保留了该属性。此处验证的是危险 HTML 没有被移除，没有在真实站点运行脚本。

**当前条件：**[dynamicConfig.ts:30](F:/DcElysion-blog/src/config/dynamicConfig.ts:30) 默认 `memos.enable: false`，数据源为本地构建的 `/api/dynamic.json`。所以应在启用外部源前修复，不能把它报告成已经发生的外部攻击。

**建议：**在外部数据进入系统时校验 DTO，并对生成的 HTML 做标签、属性和 URL 协议白名单净化。保留可信本地内容约定，避免为修复外部边界而擅自改变用户正文。

## 2. 按模块的审查覆盖与判断

本次按功能模块审查主要目录的关键实现、调用方、生命周期及权限边界，辅以现有测试和合成运行证据。没有逐行读完全部源码，也没有对所有配置、视口和浏览器做穷举。“未发现新增明确问题”表示本轮覆盖内没有足够依据列为缺陷，不代表形式化安全证明。

| 模块 | 主要审查入口 | 判断与优化方向 |
| --- | --- | --- |
| 内容集合、文章、归档、分类、系列、RSS/Atom/OG/llms | `content.config.ts`、`content-utils.ts`、文章及聚合路由、`feed-utils.ts` | 静态生成适合现有内容。feed 对密码正文使用提示文本，元数据 API 只输出密码保护布尔值。加密本身见 F1。 |
| 项目展示、页面开关与 SEO | `pages/projects`、`projects-utils.ts`、页面开关工具、sitemap | 页面守卫、导航和索引规则分散；F6 是已出现的不一致，应逐步收敛。 |
| 页面外壳、导航、侧栏与沉浸阅读 | `Layout`、`MainGridLayout`、layout-init、Swup transitions、sidebar-effective、目录/滚动相关脚本 | 普通布局计算已经共享，7 项测试通过。保留现有容器 ID、断点与事件约定；生命周期的具体遗漏见 F2/F3。 |
| 搜索 | Navbar Pagefind 加载器、`Search.svelte`、`AdvancedSearch.svelte` | Navbar 搜索已具备请求序号，独立搜索页尚未对齐。见 F2。 |
| 动态、侧栏动态与 Memos | JSON API、`DynamicFeed`、`DynamicSidebar`、Memos adapter、inline comments/gallery | F3/F4/F9。外部数据校验、请求清理和页面局部 DOM 查询应统一。 |
| 评论前端 | 评论选择器、Waline 初始化、动态评论 iframe 通信 | 现有初始化和跨窗口通信有专门实现。本轮没有新增足够证据列为独立缺陷；真实登录和跨导航 UI 未在浏览器验收。 |
| 图片、相册、LQIP、灯箱、R2/腾讯媒体路由 | `ImageWrapper`、gallery utils、media contract/router/client、Fancybox | 多源选择有容量准入、超时及失败回退，后台测试覆盖相关规则。密码相册受 F1 影响。无 JS 回退模板有重复，见优化建议。 |
| 音乐、背景视频、壁纸与特效 | MusicManager、music-player-view、background-video-player、Wallpaper、Spine/Live2D、樱花/波浪 | 保留跨页面音乐单例及已有延迟初始化。可选特效的完整清理仍值得在下一次修改时做浏览器验证，本轮未据静态怀疑报成运行故障。 |
| Markdown、数学与图表 | Remark/Rehype 管线、Wiki Link、Mermaid、PlantUML、图片/指令/外链插件 | Wiki 路径见 F5；Wiki 元信息扫描有优化空间。图表运行时未进行新的全量页面构建验收。 |
| 配置、i18n、显示设置与样式 | config/types、manifest adapters、translation、显示设置、主题/布局样式 | 类型检查通过。大组件可按职责逐步拆分；没有测量证据支持现在大改 CSS 或配置导出方式。 |
| Bangumi/Bilibili/MAL/VNDB/书签等页面 | 各页面、Grid、对应 API utils | 构建期外部请求与动态请求应补齐统一的超时和缓存回退，见优化建议。当前关闭的功能不冒充线上故障。 |
| 前台统计与后台 analytics | UmamiAnalytics、`admin/server/analytics.ts` | 前台异步加载；后台凭据从服务端环境读取，并有超时、响应体限制、限流、短缓存和旧数据回退。应保留这套边界。 |
| 后台客户端与编辑状态 | admin client、editor-session、配置/媒体编辑组件 | 专用类型和 Svelte 检查通过，现有测试验证草稿、版本冲突等核心行为。没有新做完整浏览器编辑流程验收。 |
| 后台登录、API 与私有预览 | auth、api、config、preview、paths | 登录与会话撤销测试通过；写请求有 Origin 检查，预览有 sandbox/CSP，路径处理有独立边界。保持这些保护。 |
| 后台草稿、候选执行与发布恢复 | drafts、jobs、candidate、executor、publishing config | 已有版本检查、作业恢复和状态测试。本轮未访问生产 Git/服务、未启用发布；测试有效性和 CI 缺口见 F7/F8。 |
| 后台媒体上传与分发 | media storage、purpose/destination config、media library、staging scripts | 现有测试覆盖用途隔离、校验、Range 与回退；本轮没有进行新的真实 R2 上传和腾讯源回读。 |
| 腾讯评论账号与迁移 | Waline overlay、password-reset、转换器及对应测试 | 本地测试验证密码重置、会话版本、角色条件、身份冲突、匿名标签及迁移包完整性，全部相关用例最终通过。 |
| 备份与恢复 | admin state-backup、Waline backup/offsite、Umami backup | 有离线写入确认、路径限制、校验清单或远程回读设计。未执行生产备份/恢复；生产定时任务及真实恢复有效性需另行验证。 |
| 构建、字体、搜索索引与部署 | 字体子集脚本、Pagefind、Sites 打包、静态 Worker、Nginx/staging、CI | 现有脚本分阶段处理产物，静态 Worker 保持简单。核心缺口是后台独立门槛 F8；本轮未新跑完整构建或部署。 |

## 3. 有收益的优化方向

以下是代码结构或失败恢复方面的优化建议，尚未用性能基准证明具体收益，不当作当前故障计数。

1. **先统一异步收尾规范。**组件所有 await 后先判断实例是否有效；清理事件、timer 和可取消请求。以现有 Navbar 搜索为样板，先处理 F2/F3，避免引入额外框架。
2. **外部 API 增加有上限的等待与旧数据回退。**Bilibili、MAL、VNDB 和部分 Bangumi/Memos 调用没有明确的 AbortSignal 超时。构建期请求不应无限依赖上游响应；可以保存最近成功结果，并区分“加载失败”和“确实为空”。GitHub 卡片及后台 analytics 已有可借鉴实现。
3. **Wiki Link 每轮构建维护一个文章索引。**`readPostMeta()` 每次调用都重新遍历文章目录，frontmatter 缓存只减少了读取文件的成本，未消除目录遍历/stat。建立路径、slug、裸文件名索引，同时正确处理开发模式的文件增删和修改。
4. **收敛路由与内容身份规则。**共享的小型纯模块可以消除 F5/F6 这类重复规则偏差；无需把整个站点改成新的路由框架。
5. **把大组件按实际职责拆分。**`DisplaySettingsIntegrated.svelte` 约千行，涉及多个设置面板；后续修改时可抽出主题、布局和字体子面板，保持公共事件与 i18n。后台样式可按编辑器、媒体库、统计页分组，不以拆文件本身作为性能优化。
6. **合并图片无 JS 回退。**`ImageWrapper.astro` 为同一托管懒加载图片在 LQIP、overlay 和末尾分别生成 `<noscript><img>`。可以保留一个语义清晰的回退，避免重复图片节点和替代文本；真实无 JS 布局尚未在浏览器检查。

## 4. 本轮验证结果与限制

| 检查 | 结果 |
| --- | --- |
| Astro check | 277 个文件，0 errors / 0 warnings / 0 hints |
| 前台 TypeScript 检查 | 通过 |
| 后台 TypeScript + Svelte 检查 | 通过，Svelte 0 errors / 0 warnings |
| 后台测试 | 36 项：35 通过，1 失败，见 F7 |
| 侧栏布局测试 | 7/7 通过 |
| 密码重置、会话及邮件模板本地测试 | 11/11 通过 |
| 评论身份、匿名标签、转换与 management 测试 | 14 项均最终通过；其中 CLI 用例在正常权限下单独复核通过 |
| 合成运行复现 | F1、F2、F3、F4 和 F9 的具体行为已复现；F5 的实际路径函数已验证 |
| 新的完整构建、浏览器矩阵、生产服务验收 | 本轮未执行 |

使用现有依赖入口执行的主要命令：

```text
node node_modules/astro/bin/astro.mjs check
node node_modules/typescript/bin/tsc --noEmit --isolatedDeclarations
node node_modules/typescript/bin/tsc --noEmit --project admin/tsconfig.json
node node_modules/svelte-check/bin/svelte-check --tsconfig admin/tsconfig.json
node --import tsx --test admin/tests/*.test.ts
node --import tsx --test src/utils/sidebar-effective-utils.test.ts
# 在 deploy/tencent/password-reset 目录：
node --test --test-isolation=none *.test.js
# 在仓库根目录：
node --test deploy/tencent/anonymous-label.test.cjs deploy/tencent/login-identity.test.cjs deploy/tencent/convert-twikoo.test.mjs deploy/tencent/waline-overlay/management.test.cjs
node --test --test-name-pattern="CLI publishes" deploy/tencent/convert-twikoo.test.mjs
```

初次沙箱执行曾出现依赖读取/子进程权限异常，部分类型检查和测试因此失败。相关检查在正常权限下复核后通过，未作为源码缺陷保留。F7 在正常权限下仍失败。没有安装或升级依赖，旧 `.review-build.log` 没有作为当前构建通过的依据。

合成 Svelte 复现使用实际组件脚本和受控依赖，验证了异步顺序与副作用；它不是完整组件水合、Swup 或真实浏览器验收。数据库相关本地测试使用内存模型或 PGlite，不等于生产 PostgreSQL、真实 SMTP 投递及完整线上认证验收。

## 5. 建议的处理顺序

1. 修复 F1，保持客户端封装兼容，验证不同版本的 salt/IV 不复用及密码缓存仍可解密。
2. 修复 F2/F3/F4，验证请求乱序、失败与组件卸载；在本地生产预览做少量对应的 Swup/搜索验证。
3. 修复 F5/F6，验证 slug 边界和关闭页面的索引过滤。
4. 修复 F7 并接入 F8 的后台 CI；启用外部动态/Memos 前完成 F9。
5. 后续按实际性能证据处理外部 API、Wiki 索引和大组件拆分，无需整体重写。

本报告只提出修复建议，以上步骤尚未实施。
