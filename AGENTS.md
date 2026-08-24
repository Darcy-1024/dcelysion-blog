# DcElysion 项目协作指南

本文件面向在本仓库中工作的 AI Agent 与开发者。它描述当前代码的真实结构、主要数据流和修改边界；动手前应先根据任务阅读对应模块，而不是只凭目录名推断实现。

## 1. 项目概览

DcElysion 是一个配置驱动的个人博客/内容站点，当前核心技术栈为：

- Astro 7：文件路由、内容集合、服务端/构建期渲染和页面外壳。
- Svelte 5：搜索、显示设置、动态流、番剧与 VNDB 列表等需要持续状态的交互岛。
- TypeScript：配置、工具函数与数据模型。
- Tailwind CSS 4 + Stylus + 普通 CSS：工具类、主题变量和各功能样式。
- Swup：在多个固定容器之间执行局部页面切换；站点并非只依赖传统整页加载。
- Astro Content Collections：管理文章、特殊页面和动态内容。
- Remark/Rehype：扩展 Markdown，处理阅读时间、图片网格、数学、Mermaid、PlantUML、指令、外链等。
- Pagefind：生产构建后的静态全文搜索索引。

项目默认生成静态站点到 `dist/`。设置 `CF_WORKERS` 时，`astro.config.mjs` 会启用 Cloudflare adapter；仓库同时保留 Vercel 和 Cloudflare Workers 部署配置。

## 2. 总体数据流

```text
src/config/* ───────────────┐
src/content/* ── Content API ├─> src/pages/* ─> MainGridLayout ─> Layout ─> HTML
public/ 与 src/assets/* ────┘          │               │
                                       │               ├─> 全局功能、主题、分析、音乐
                                       └─> Astro 组件 + Svelte 交互岛

Markdown/MDX
  -> content.config.ts 校验
  -> astro.config.mjs 中的 remark/rehype 管线
  -> 页面 render(entry)
  -> Markdown.astro / 文章页呈现

pnpm build
  -> 生成 GitHub 卡片缓存数据
  -> 生成 LQIP 数据
  -> 按配置生成 VNDB 封面缓存
  -> Astro 构建
  -> 裁剪未使用的 Pio 资源
  -> 本地字体子集化
  -> 压缩构建产物中的内联脚本
  -> Pagefind 建立 dist 搜索索引
```

## 3. 根目录结构

| 路径 | 职责 | 修改提示 |
| --- | --- | --- |
| `src/` | 站点源代码和内容 | 绝大多数功能修改发生在这里 |
| `.agents/skills/` | 仓库级 Codex 工作流 | 当前包含动态发布 Skill，修改后需运行对应校验器 |
| `public/` | 原样复制并按根路径访问的静态资源 | 相册、Pio 模型、第三方脚本等放在这里；`public/assets/music/` 仅保留本地工作副本，线上音乐见下文 R2 约定 |
| `scripts/` | 内容脚手架和构建期生成脚本 | 注意脚本可能改写受版本控制的生成数据 |
| `workers/` | 独立 Cloudflare Worker | 包含 Twikoo 反向代理与 Sites 静态资源入口，不属于 Astro 页面代码 |
| `docs/` | README 使用的说明图片和多语言文档 | 不参与站点运行时 |
| `astro.config.mjs` | Astro 集成、Markdown 管线、Swup、字体、图片和 Vite 配置 | Markdown/构建行为的首要入口 |
| `src/content.config.ts` | 内容集合与 frontmatter schema | 新增字段时必须先更新这里 |
| `package.json` / `pnpm-workspace.yaml` | 命令、依赖、pnpm 版本与构建脚本许可的事实来源 | 使用 `pnpm`，不要生成其他锁文件 |
| `biome.json` | 格式化和静态检查规则 | CSS 被排除，Astro/Svelte 有局部放宽 |
| `tsconfig.json` | TypeScript 与路径别名 | 优先使用既有别名 |
| `vercel.json` / `wrangler.jsonc` | 部署与响应头配置 | 不要把密钥写入仓库 |
| `dist/`, `.astro/`, `node_modules/` | 构建产物、生成类型和依赖 | 不手工编辑，且不提交 |

## 4. `src/` 模块边界

### `src/pages/`：路由与页面编排

页面文件负责读取内容/配置、准备页面级数据并组装组件。可复用逻辑应下沉到 `components` 或 `utils`，不要继续扩大大型页面文件。

主要路由：

| 路由文件 | 输出/职责 |
| --- | --- |
| `[...page].astro` | 首页和分页文章列表；使用 Astro `paginate` |
| `posts/[...slug].astro` | 文章静态路径、正文渲染、前后篇、推荐、加密、评论、分享与结构化数据 |
| `about.astro`, `friends.astro`, `guestbook.astro` | 从 `spec` 集合读取固定内容；后两者还组合配置或评论 |
| `archive.astro`, `categories/index.astro`, `tags/index.astro` | 从文章集合派生的聚合页 |
| `search.astro` | 挂载 Pagefind 驱动的 `AdvancedSearch.svelte` |
| `dynamic/index.astro` | 动态流页面；数据来自本地 JSON API、外部 API 或 Memos |
| `dynamic/comments.astro` | 动态内嵌评论 iframe 页面及跨窗口主题/高度通信 |
| `gallery/index.astro`, `gallery/[album].astro` | 配置驱动的相册列表和相册详情 |
| `bilibili.astro`, `bangumi.astro`, `myanimelist.astro` | 获取哔哩哔哩、Bangumi 或 MyAnimeList 收藏数据并挂载 Svelte 列表 |
| `vndb.astro` | 按 static/dynamic 模式展示 VNDB 收藏；静态模式可在构建期下载封面 |
| `booknav.astro` | 从 `booknavConfig` 生成书签导航页 |
| `rss.astro`, `rss.xml.ts` | RSS 说明页与经过渲染/清理的订阅源 |
| `og/[...slug].ts` | 使用 Satori 静态生成文章 OG 图片 |
| `api/allPostMeta.json.ts` | 日历和推荐组件使用的文章元数据 |
| `api/dynamic.json.ts` | 将本地 `dynamic` 集合转换为前端消费的 JSON，并解析动态正文中的本地图片 |
| `robots.txt.ts`, `404.astro` | 爬虫规则与错误页 |

`siteConfig.pages` 控制 friends、sponsor、guestbook、bilibili、bangumi、vndb、mal、gallery、dynamic、booknav 等页面是否开放。关闭的页面会通过各路由守卫重定向到 `/404/`，导航栏按 `pageKey` 过滤链接；sitemap 在 `astro.config.mjs` 中另行维护过滤规则。新增或调整页面开关时，必须逐项核对页面守卫、导航 `pageKey`、页面子路由和 sitemap 过滤，不能假定这些入口会自动保持一致。

### `src/layouts/`：页面骨架

- `Layout.astro` 是最底层 HTML 外壳，负责 `<head>`、SEO、favicon、全局 CSS、字体、分析服务、主题初始化、全局音乐/特效、Swup 生命周期和通用浏览器增强。
- `MainGridLayout.astro` 构建可变壁纸/横幅、导航栏、分类栏、主内容区、左右侧边栏、页脚、悬浮控件和看板娘。它根据页面类型、设备和 `sidebarConfig` 计算网格。

普通站内页面优先使用 `MainGridLayout`；只有需要极简外壳的嵌入页面才直接使用 `Layout`。不要随意改动这些稳定 DOM 标识：`#swup-container`、`#banner-overlay-container`、`#banner-dim-container`、`#left-sidebar-dynamic`、`#right-sidebar-dynamic`、`#floating-toc-wrapper`，它们是 Swup 多容器切换契约的一部分。

### `src/components/`：按职责分组的 UI

- `layout/`：Navbar、Footer、SideBar、PostCard、PostPage、PostMeta、CategoryBar 等站点结构组件。
- `common/`：按钮、下拉面板、图片包装、Markdown 包装、分页、通用 Widget 外壳。
- `controls/`：搜索、主题/显示设置、返回顶部、悬浮目录等用户控制。
- `features/`：加密内容、Fancybox、KaTeX、字体、音乐、壁纸播放器、樱花、Live2D/Spine 等跨页面能力。
- `widget/`：由侧边栏配置选择和排序的资料、公告、日历、分类、标签、动态、音乐、统计、广告组件。
- `pages/`：只服务某个页面的组件；复杂页面按 `bilibili/`、`bangumi/`、`mal/`、`dynamic/`、`gallery/`、`vndb/` 再分组。
- `comment/`：评论选择器与 Artalk、Disqus、Giscus、Twikoo、Waline 适配。
- `analytics/`：Google Analytics、Microsoft Clarity、Umami、51la 接入。
- `misc/`：许可证、相关文章和分享海报等辅助功能。

选择组件类型时：静态输出和轻量 DOM 增强优先 `.astro`；确实需要响应式状态与生命周期时才使用 `.svelte`，并在调用处明确 `client:*` 指令。避免把可在构建期完成的工作发送到浏览器。

### `src/config/` 与 `src/types/`：配置驱动层

`src/config/index.ts` 是统一出口，业务代码优先从 `@/config` 导入。主要配置包括站点、导航、侧边栏、背景、评论、分析、字体、代码块、图表、音乐、动态、相册、书签导航、Bilibili、Bangumi、MyAnimeList、VNDB、友链、赞助和看板娘。

规则：

1. 配置对象应满足 `src/types/` 中对应类型。
2. 改配置结构时同时修改类型、默认配置和所有读取方。
3. 新的公共配置应从 `src/config/index.ts` 导出；公共类型经 `src/types/config.ts` 或 config barrel 导出。
4. 页面开关属于 `siteConfig.pages`，具体页面行为属于该功能自己的配置文件。
5. API key、token、评论服务密钥等敏感值不得硬编码提交；使用部署平台环境变量。

### `src/content/`：内容源

集合在 `src/content.config.ts` 中定义：

- `posts/`：支持 `.md` 和 `.mdx`。必填 `title`、`published`；其余常用字段为 `updated`、`draft`、`description`、`image`、`tags`、`category`、`lang`、`pinned`、`author`、`sourceLink`、`licenseName`、`licenseUrl`、`comment`、`password`、`passwordHint`。`prev*`/`next*` 是内部字段，由 `getSortedPosts()` 注入，不应在文章里手填。
- `dynamic/`：仅 `.md`，必填 `published`，可用 `draft`、`pinned`、`location`。
- `spec/`：about、friends、guestbook 等固定页面正文，schema 当前不接受自定义 frontmatter 字段。

生产环境会过滤 `draft: true`，开发环境会显示草稿。文章排序为“置顶优先，再按发布时间倒序”。文章 ID/相对路径决定 URL；处理 URL 时使用 `url-utils.ts`，不要手工拼接 base path。

同步上游时，上游新增、移动或更新的教学、指南和功能示例文章必须默认保持 `draft: true`；即使上游 frontmatter 未填写 `draft` 或设为 `false`，合并后也要改为草稿。只有用户明确要求公开时才能改为 `draft: false`。个人正式文章不属于此默认规则。

内容资源的选择：

- 与文章一起维护、需要 Astro 处理的图片可放在文章目录或 `src/assets/`。
- 必须以稳定根路径原样访问、体积较大或由外部库读取的资源放 `public/`。
- 相册由 `galleryConfig.ts` 声明元数据，并从 `public/gallery/<album-id>/` 扫描图片；可用 `cover.*`、`urls.txt` 和可选密码。

### `src/plugins/`：Markdown AST 扩展

插件在 `astro.config.mjs` 中按顺序组成处理管线。Remark 阶段包括告示块兼容、数学、阅读时间、图片网格、摘要、指令、section、Mermaid 和 PlantUML；Rehype 阶段包括 KaTeX、callout、slug、图表渲染/缩放、figure、图片 referrer policy、外链、邮件保护、GitHub 卡片和标题锚点。

修改插件时必须考虑 AST 前后顺序，并至少用覆盖该语法的 Markdown 页面执行完整构建。插件相关浏览器脚本也在此目录中，不能只验证服务端转换结果。

### 其他源码目录

- `src/utils/`：无 UI 的共享逻辑。重点包括内容查询/推荐、日期、URL、图片/LQIP、布局响应式、导航、设置持久化、目录、动态/Memos、书签导航、Bilibili、MyAnimeList、VNDB、NSFW 处理、GitHub 卡片和加密。
- `src/styles/`：`main.css` 是全局入口，继续导入布局及功能 CSS；`variables.styl` 管主题变量，`markdown-extend.styl` 管正文扩展样式。
- `src/i18n/`：`i18nKey.ts` 定义键，`languages/*.ts` 提供语言字典，`translation.ts` 负责查找。新增用户可见文本时应补齐所有语言或提供明确回退。
- `src/constants/`：站点常量、图标数据和 LQIP 映射。`icons-data.json`、`lqips.json` 是生成数据，不要无理由手改。
- `src/assets/`：由构建系统管理的图片等源码资源。
- `src/workers/`：浏览器 Web Worker；当前用于樱花效果计算，与根目录 `workers/` 的部署 Worker 不同。

## 5. 浏览器端与 Swup 生命周期

这是本项目最容易引入回归的区域。Swup 会替换多个内容容器，但某些全局组件和 `window` 状态会跨导航保留。

- 初始化逻辑不能只依赖 `DOMContentLoaded`；根据组件所在容器处理 `astro:page-load`、Swup 事件或项目自定义的 `firefly:page:loaded`。
- 重复进入页面时必须避免重复绑定监听器、重复创建播放器/观察器或重复注册自定义元素。
- 长生命周期功能应提供清理逻辑。Svelte 使用挂载清理函数；原生脚本保存 handler 引用后在换页/卸载时移除。
- 全局状态已有约定，如 `window.__fireflyMusic`、`window.__allPostMetaCache`；新增全局变量前先搜索现有命名和类型声明。
- 主题、壁纸、布局、目录和音乐通过 CustomEvent 协作。修改事件名或 payload 时必须同步全部发送方和接收方。
- 新增页面级脚本要验证：首次直达、站内进入、离开后再次进入、前进/后退、移动端尺寸变化。

## 6. 样式与响应式布局

- Tailwind 4 从 `src/styles/main.css` 引入，项目大量使用 CSS 变量和自定义 utility。
- Biome 不格式化 CSS；修改 CSS 时保持相邻文件现有风格。
- 站点布局不仅有常规断点，还受左右/双侧边栏、平板侧边栏、文章页隐藏侧栏、壁纸模式与用户显示设置影响。
- 修改网格时先查看 `responsive-utils.ts`、`MainGridLayout.astro` 和 `sidebarConfig.ts`，不要只改一个 class。
- 通用颜色与圆角优先复用 `--primary`、`--page-bg`、`--card-bg`、`--radius-*` 等现有变量，避免写死主题颜色。
- 视觉修改应检查本次变更实际影响的桌面/移动端、明暗主题、普通整页加载与 Swup 导航组合。全局布局或生命周期修改应覆盖完整组合；局部改动可缩小范围，但交付时要说明未覆盖项。

## 7. 构建、生成文件与外部依赖

只使用 pnpm 11（需要 Node.js 22 或更高版本）；`package.json` 固定具体 pnpm 版本，`pnpm-workspace.yaml` 固定本地 store 并显式许可依赖构建脚本，`preinstall` 会拒绝其他包管理器。

```bash
pnpm dev             # Astro 开发服务器
pnpm check           # Astro 诊断
pnpm type-check      # TypeScript --noEmit --isolatedDeclarations
pnpm format          # Biome 格式化并写入 src 与 scripts
pnpm lint            # Biome 检查、格式化并写入 src 与 scripts
pnpm lqips           # 重新生成 src/constants/lqips.json
pnpm github-cards    # 重新生成 src/constants/github-card-data.json
pnpm build           # GitHub 卡片 -> LQIP -> VNDB 封面 -> Astro -> Pio 裁剪 -> 字体 -> 内联脚本压缩 -> Pagefind -> Sites 入口
pnpm preview         # 预览 dist
pnpm new-post <name> # 新建文章
pnpm new-dynamic ... # 新建动态
```

构建注意事项：

- `astro.config.mjs` 为 Astro 的 Vite `astro` 和 `ssr` 开发环境把 module-runner transport 超时设为 180 秒；Windows 上首次 manifest 加载可能超过 Vite 默认的 60 秒。该设置依赖 `package.json` 中直接固定的 Vite 版本，升级 Vite/Astro 时需重新核对 Environment API。
- `pnpm build` 会更新 `src/constants/lqips.json`；提交前检查差异是否来自本次资源变更。
- `pnpm build` 会先更新 `src/constants/github-card-data.json`；无网络或 API 失败时脚本保留已有缓存，提交前检查差异是否合理。
- `pnpm format` 与 `pnpm lint` 都带有 `--write`，且作用于整个 `src/` 和 `scripts/`。已有无关改动或只需验证少量文件时，优先使用 `pnpm exec biome check <相关文件>` 做限定范围的只读检查；不要为验证而改写任务外文件。
- `scripts/generate-vndb-covers.ts` 只在 VNDB 页面启用、模式为 `static`、配置了 `userId` 且开启封面下载时请求外部 API；未配置用户 ID 时会直接跳过。
- `scripts/prune-pio-assets.ts` 在 Astro 构建后从 `dist/` 移除未启用的 Pio/Live2D 产物；不要手工修改其输出。
- 字体子集脚本在 Astro 构建后扫描 `dist/**/*.html`，输出到 `dist/_astro/fonts`。
- `scripts/minify-inline-scripts.ts` 会在字体处理后压缩 `dist/` 中的内联脚本。
- Pagefind 只在完整构建后生成，因此开发服务器中的搜索可用性与生产预览不同。
- `scripts/prepare-sites-dist.ts` 在构建末尾生成 `dist/server/index.js`，供 OpenAI Sites 使用 `ASSETS` binding 托管静态产物；不要手工修改该生成文件。
- GitHub 卡片、Bangumi、MyAnimeList、VNDB、OG 字体等流程可能访问外部服务；失败时先区分代码错误、缺少配置、网络问题和本地缓存回退。
- `scripts/quarantine-bad-posts.mjs` 会移动文件且不是常规构建步骤，未经明确要求不要运行。

### 音乐与壁纸媒体的 Cloudflare R2

- `src/config/musicConfig.ts` 的当前歌单通过 Cloudflare R2 存储桶 `dcelysion-music` 及 `https://music.dcelysion.cn` 提供音频和封面。`src/config/backgroundWallpaper.ts` 的视频壁纸使用独立存储桶 `dcelysion-wallpapers` 及 `https://wallpapers.dcelysion.cn`；对象按 `desktop/`、`mobile/` 前缀组织，可为不同终端配置独立裁剪版本和主体位置。
- `public/assets/music/` 和 `public/assets/videos/` 只作为本地工作副本；必须保留并提交 `public/.assetsignore`，使 Workers Static Assets 上传排除这两个目录。该文件不等同于 `.gitignore`，暂存前仍须检查媒体二进制。
- R2 视频使用 H.264 + `yuv420p` MP4，写入 `video/mp4` 和版本化长缓存头，并启用 faststart；上传后必须验证自定义域名的 `206 Partial Content` Range 响应和实际播放。
- 播放器使用匿名跨域媒体。新增或更换站点访问域时，必须同步音乐桶与壁纸桶 R2 CORS 的精确 Origin；当前包括 `https://blog.dcelysion.cn`、`https://dcelysion-blog.lin507793465.workers.dev`、`http://localhost:4321` 和 `http://127.0.0.1:4321`。规则变化后清理对应媒体域名的 CDN 缓存，并验证 Range 请求与实际播放。

## 8. 常见修改路径

### 新增文章或内容字段

1. 用 `pnpm new-post` 创建文章，或按 `content.config.ts` schema 手工添加。
2. 新字段先更新 schema 和数据类型，再更新消费组件。
3. 检查列表卡片、文章详情、RSS、OG、搜索/API 是否也需要该字段。
4. 本地图片变更后运行完整构建并检查 LQIP 差异。

### 通过 Agent 发布动态

优先使用仓库级 `$publish-dynamic` Skill（`.agents/skills/publish-dynamic/`）执行以下流程：

1. 用户提供正文和可选附件即可；未指定时使用 `siteConfig.timezone` 下的当前时间生成文件名和 `published`，默认立即公开、不置顶且不填写位置。只有用户明确要求时才设置 `draft`、`pinned` 或 `location`。
2. 保持用户给出的正文原意和措辞；润色、补充标签或添加表情必须由用户明确提出。
3. 图片附件按用户指定顺序排列；未指定顺序时沿用附件顺序。需要转换的图片统一输出为 AVIF，使用语义清晰且不冲突的文件名，存放到 `src/content/dynamic/images/`，并在动态 Markdown 中通过 `./images/<file>.avif` 引用。
4. 动态图片必须经过 `api/dynamic.json.ts` 的本地资源解析，构建后检查 API 返回的是可访问的 `/_astro/` 资源地址，并确认对应文件存在于 `dist/`。
5. 新增或转换图片后运行完整 `pnpm build`，复查 `src/constants/lqips.json` 只包含预期变更，并保留用户提供的原始附件不动。
6. 每次完成动态内容、图片处理和验证后，都要主动询问用户是否立即提交、推送并触发部署；在用户明确确认前，不执行相应的 Git 或线上部署操作。

### 新增普通页面

1. 在 `src/pages/` 建路由，默认用 `MainGridLayout`。
2. 页面专属 UI 放 `src/components/pages/<feature>/`，共享 UI 放合适的通用域。
3. 若页面可关闭，同步 `SiteConfig` 类型、`siteConfig.pages`、页面守卫、导航生成和 sitemap 过滤。
4. 新文案进入 i18n；新增样式从全局入口或页面明确引入。

### 新增侧边栏 Widget

1. 在 `src/components/widget/` 实现组件。
2. 扩展 `WidgetComponentType` 和对应配置类型。
3. 更新 `SideBar.astro` 的组件映射/渲染分支。
4. 在 `sidebarConfig.ts` 配置位置、顺序和响应式行为。

### 新增交互功能

1. 先判断 Astro + 少量原生脚本是否足够；需要持久状态再用 Svelte。
2. 确认脚本所在区域是否会被 Swup 替换。
3. 实现重复初始化保护和清理。
4. 检查键盘操作、ARIA、焦点、减弱动画和移动端交互。

### 修改 Markdown 能力

1. 确定修改属于 Remark（Markdown AST）还是 Rehype（HTML AST）。
2. 在 `src/plugins/` 实现，并在 `astro.config.mjs` 的正确顺序注册。
3. 添加或更新一篇示例内容用于人工回归。
4. 验证文章页、RSS、安全清理、加密内容解锁后的二次初始化。

## 9. 文档同步维护

代码、配置、目录或工作流发生变化时，Agent 必须主动判断现有文档是否已经失真，并在同一任务中同步更新受影响的文档；不需要等待用户再次提醒。

重点检查范围：

- `AGENTS.md`：项目架构、目录职责、路由、数据流、命令、生成文件、修改边界或协作规则发生变化时更新。
- `CLAUDE.md`：项目概览、命令、架构摘要、代码风格、构建管线或用户偏好规则发生变化时更新；必须与 `AGENTS.md` 保持一致，不得相互矛盾。
- `README.md` 与 `README.en.md`：面向使用者的功能、安装、配置、命令、部署方式或内容写法发生变化时同步更新；两种语言的事实信息应保持一致。
- `docs/README.ja.md` 与 `docs/README.zh-TW.md`：对应的公共说明发生变化且这些译文包含该部分时同步维护。
- `src/config/README.md`：新增、删除或重命名配置文件、配置项、开关和示例时更新。
- `src/components/README.md`：新增、删除、移动组件或改变组件分组与职责时更新。
- 功能示例、文章示例和代码注释：公开语法、frontmatter、Markdown 扩展或 API 契约变化时更新。

执行规则：

1. 修改前搜索相关名称在文档中的所有引用，避免只更新一个入口。
2. 只同步与本次变更直接相关的内容，不借机大范围重写或翻译无关章节。
3. 文档描述以当前代码、`package.json` 和配置类型为事实来源；删除已经失效的说明，不保留“将来会实现”的推测。
4. 如果某份多语言文档无法可靠翻译，至少更新默认语言文档，并在交付说明中明确列出尚未同步的译文，不能静默遗漏。
5. 纯内部重构且不改变结构、行为、接口或操作方式时，可以不改用户文档，但仍需检查 `AGENTS.md` 与 `CLAUDE.md` 中的架构说明是否受影响。
6. 交付时说明同步修改了哪些文档；若判断无需修改，也应在内部完成文档影响检查。

## 10. 验证要求

仓库没有独立单元测试框架。按变更风险选择验证，但不要把“没有测试目录”理解为无需验证。

| 变更类型 | 最低验证 |
| --- | --- |
| 文档或纯配置注释 | 检查差异和引用路径 |
| TypeScript/组件逻辑 | `pnpm check` + `pnpm type-check` |
| 页面、内容 schema、Markdown 插件 | `pnpm check` + `pnpm type-check` + `pnpm build` |
| 图片、字体、搜索索引或其他参与生成流程的资源 | 完整 `pnpm build`，并检查 LQIP、缓存和 `dist/` 差异 |
| 不参与生成流程的静态资源 | 检查引用路径；按影响范围决定是否需要完整构建 |
| 视觉、交互、Swup 生命周期 | `pnpm check` + `pnpm type-check`，并用 `pnpm dev` 或 `pnpm preview` 验证受影响组合；涉及构建期行为时再加 `pnpm build` |
| 搜索、字体子集、RSS、OG、部署产物 | 必须完整 `pnpm build`，必要时检查 `dist/` |

若某项验证因外部 API、网络或缺少部署变量无法执行，应明确记录未验证项和原因，不要把环境失败描述为代码通过。

## 11. 编码与提交约定

- 遵循 Biome：制表符缩进，JavaScript/TypeScript 使用双引号。
- Astro/Svelte 组件用 `PascalCase`；配置文件用 `camelCase` 并以 `Config.ts` 结尾；工具文件使用描述性 kebab-case。
- 路径别名：`@/*`、`@components/*`、`@assets/*`、`@constants/*`、`@utils/*`、`@i18n/*`、`@layouts/*`。优先沿用当前模块附近的导入风格。
- 只修改任务涉及的文件，避免顺手格式化整个仓库。工作区可能已有用户改动，必须先查看 `git status` 并保留它们。
- 不手工编辑 `dist/`、`.astro/`、依赖目录或锁文件之外的安装产物。
- 不提交 `.env`、服务密钥、访问 token、私人 API key 或真实密码。
- Commit 使用 Conventional Commits，例如 `feat: ...`、`fix: ...`、`docs: ...`、`chore: ...`。
- PR 保持单一关注点，写明变更摘要、验证命令、已知限制；视觉修改附桌面和移动端截图。

## 12. Agent 开工检查表

1. 运行 `git status --short`，识别并保护现有改动。
2. 阅读任务直接涉及的页面、组件、配置、类型和工具函数。
3. 搜索同一配置键、DOM id、事件名和全局变量的所有使用处。
4. 判断逻辑运行在构建期、服务端、浏览器首次加载还是 Swup 再导航阶段。
5. 用最小范围实现，避免破坏配置驱动和模块边界。
6. 检查相关文档是否需要随代码、配置或结构变化同步更新。
7. 执行与风险匹配的验证，并复查生成文件差异。
8. 交付时说明修改文件、文档同步情况、行为变化、验证结果和任何未覆盖项。
