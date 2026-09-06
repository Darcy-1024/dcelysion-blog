# 架构与浏览器行为参考

仅在任务涉及相应模块时阅读相关小节。路径以仓库根目录为基准，当前代码与配置是事实来源。

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
| `.agents/skills/` | 仓库级 Codex 工作流 | 动态发布入口见 `.agents/skills/publish-dynamic/SKILL.md` |
| `public/` | 原样复制并按根路径访问的静态资源 | Pio 模型、第三方脚本及媒体本地副本等放在这里；音乐、视频与相册的线上交付见下文 R2 约定 |
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
| `archive.astro`, `categories/index.astro`, `tags/index.astro` | 从文章集合派生的归档、分类和标签聚合页 |
| `series/index.astro` | 按文章 `series` 元数据生成系列聚合与有序篇章列表 |
| `search.astro` | 挂载 Pagefind 驱动的 `AdvancedSearch.svelte` |
| `dynamic/index.astro` | 动态流页面；数据来自本地 JSON API、外部 API 或 Memos |
| `dynamic/comments.astro` | 动态内嵌评论 iframe 页面及跨窗口主题/高度通信 |
| `gallery/index.astro`, `gallery/[album].astro` | 配置驱动的相册列表和相册详情 |
| `bilibili.astro`, `bangumi.astro`, `myanimelist.astro` | 获取哔哩哔哩、Bangumi 或 MyAnimeList 收藏数据并挂载 Svelte 列表 |
| `vndb.astro` | 按 static/dynamic 模式展示 VNDB 收藏；静态模式可在构建期下载封面 |
| `booknav.astro` | 从 `booknavConfig` 生成书签导航页 |
| `rss.astro`, `rss.xml.ts` | RSS 说明页与经过渲染/清理的订阅源 |
| `og/[...slug].ts` | 使用 Takumi 静态生成文章 OG 图片 |
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
- `controls/`：搜索、主题/显示设置、返回顶部、悬浮目录和沉浸阅读等用户控制。
- `features/`：加密内容、Fancybox、KaTeX、字体、音乐、壁纸播放器、樱花、Live2D/Spine 等跨页面能力。
- `widget/`：由侧边栏配置选择和排序的资料、公告、日历、分类、标签、动态、音乐、统计、广告组件。
- `pages/`：只服务某个页面的组件；复杂页面按 `bilibili/`、`bangumi/`、`mal/`、`dynamic/`、`gallery/`、`vndb/` 再分组。
- `comment/`：评论选择器与 Artalk、Disqus、Giscus、Twikoo、Waline 适配。
- `analytics/`：Google Analytics、Microsoft Clarity、Umami、51la 接入。
- `misc/`：许可证、相关文章、系列导航和分享海报等辅助功能。

选择组件类型时：静态输出和轻量 DOM 增强优先 `.astro`；确实需要响应式状态与生命周期时才使用 `.svelte`，并在调用处明确 `client:*` 指令。避免把可在构建期完成的工作发送到浏览器。

### `src/config/` 与 `src/types/`：配置驱动层

`src/config/index.ts` 是统一出口，业务代码优先从 `@/config` 导入。主要配置包括站点、导航、沉浸阅读、侧边栏、背景、评论、分析、字体、代码块、图表、音乐、动态、相册、书签导航、Bilibili、Bangumi、MyAnimeList、VNDB、友链、赞助和看板娘。

规则：

1. 配置对象应满足 `src/types/` 中对应类型。
2. 改配置结构时同时修改类型、默认配置和所有读取方。
3. 新的公共配置应从 `src/config/index.ts` 导出；公共类型经 `src/types/config.ts` 或 config barrel 导出。
4. 页面开关属于 `siteConfig.pages`，具体页面行为属于该功能自己的配置文件。
5. API key、token、评论服务密钥等敏感值不得硬编码提交；使用部署平台环境变量。

### `src/content/`：内容源

集合在 `src/content.config.ts` 中定义：

- `posts/`：支持 `.md` 和 `.mdx`。必填 `title`、`published`；其余常用字段为 `updated`、`draft`、`description`、`image`、`tags`、`category`、`series`、`seriesOrder`、`lang`、`pinned`、`author`、`sourceLink`、`licenseName`、`licenseUrl`、`comment`、`password`、`passwordHint`。同名 `series` 的文章会按 `seriesOrder` 排序；`prev*`/`next*` 是内部字段，由 `getSortedPosts()` 注入，不应在文章里手填。
- `dynamic/`：仅 `.md`，必填 `published`，可用 `draft`、`pinned`、`location`。
- `spec/`：about、friends、guestbook 等固定页面正文，schema 当前不接受自定义 frontmatter 字段。

生产环境会过滤 `draft: true`，开发环境会显示草稿。文章排序为“置顶优先，再按发布时间倒序”。文章 ID/相对路径决定 URL；处理 URL 时使用 `url-utils.ts`，不要手工拼接 base path。

同步上游时，上游新增、移动或更新的教学、指南和功能示例文章必须默认保持 `draft: true`；即使上游 frontmatter 未填写 `draft` 或设为 `false`，合并后也要改为草稿。只有用户明确要求公开时才能改为 `draft: false`。个人正式文章不属于此默认规则。

内容资源的选择：

- 与文章一起维护、需要 Astro 处理的图片可放在文章目录或 `src/assets/`。
- 必须以稳定根路径原样访问、体积较大或由外部库读取的资源放 `public/`。
- 相册由 `galleryConfig.ts` 声明元数据，并在构建期从 `public/gallery/<album-id>/` 扫描本地副本；可用 `cover.*`、`urls.txt` 和可选密码。设置 `assetBaseUrl` 后，本地图片映射为 R2 URL，第三方 `urls.txt` 外链保持原样。

### `src/plugins/`：Markdown AST 扩展

插件在 `astro.config.mjs` 中按顺序组成处理管线。Remark 阶段包括告示块兼容、数学、阅读时间、图片网格、摘要、指令、section、Mermaid 和 PlantUML；Rehype 阶段包括 KaTeX、callout、slug、图表渲染/缩放、figure、图片 referrer policy、外链、邮件保护、GitHub 卡片和标题锚点。

修改插件时必须考虑 AST 前后顺序，并至少用覆盖该语法的 Markdown 页面执行完整构建。插件相关浏览器脚本也在此目录中，不能只验证服务端转换结果。

### 其他源码目录

- `src/utils/`：无 UI 的共享逻辑。重点包括内容查询/推荐、日期、URL、图片/LQIP、布局响应式、导航、设置持久化、目录、动态/Memos、书签导航、Bilibili、MyAnimeList、VNDB、NSFW 处理、GitHub 卡片和加密。
- `src/styles/`：`main.css` 是全局入口，继续导入布局及功能 CSS；`variables.styl` 管主题变量，`markdown-extend.styl` 管正文扩展样式。
- `src/i18n/`：`i18nKey.ts` 定义键，`languages/*.ts` 提供语言字典，`translation.ts` 负责查找。新增用户可见文本时应补齐所有语言或提供明确回退。
- `src/constants/`：站点常量、图标数据、LQIP 和相册预览映射。`icons-data.json`、`lqips.json`、`gallery-previews.json` 是生成数据，不要无理由手改；其中相册预览映射由 `pnpm gallery-previews` 生成。
- `src/assets/`：由构建系统管理的图片等源码资源。
- `src/workers/`：浏览器 Web Worker；当前用于樱花效果计算，与根目录 `workers/` 的部署 Worker 不同。

### 文章自动排版

- 文章默认启用排版，frontmatter 可设置 `typography: false` 为单篇关闭。仅文章页把该值传给 `Markdown.astro`；不改写原始 Markdown，示例草稿保持草稿。
- `ArticleTypography.astro` 按需加载固定版本 `@tiqian/prose`，增强可支持的中文段落；页面不显示排版开关，加载失败或无 JavaScript 时仍显示原文。
- 排版增强会在初始化前排除居中、右对齐及末端对齐的段落，保留作者指定的结束语与署名位置。
- 自定义元素管理 Swup 换页与解密插入的连接/清理；库负责字体、容器尺寸变化后的重排。代码、表格、公式及不支持的富文本保留原生渲染，须验证目录、复制、查找和移动端。
- `markdown.css` 为中文文章提供显示层的中西文间距及严格断行，代码和公式排除。显式关闭排版的文章不加载排版引擎；暂不使用构建期预排。

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
- 视觉修改应检查本次变更实际影响的桌面/移动端、明暗主题、普通整页加载与 Swup 导航组合。全局布局或生命周期修改应覆盖完整组合；局部改动可缩小范围，有影响结论的未覆盖项时在交付中说明。

### Scroll Performance Constraints

Scroll-linked work in `src/utils/` is rAF-throttled and must stay cheap on mobile — do not regress these:

- `fullscreen-wallpaper-utils.ts` — hero fullscreen-mode title fade + blur ramp. The blur value `--fullscreen-blur` is **quantized to 2px steps** (skips writes when unchanged) and the max blur (`--overlay-blur`) is **cached** (read once; refreshed by a MutationObserver on `#wallpaper-wrapper` style). Avoid per-frame `getComputedStyle` or continuous full-screen `filter: blur()` writes — each change re-rasterizes the whole viewport on mobile.
- `grid-layout-utils.ts` — `updateSidebarStickySpacing()` is the per-scroll path and **must not read layout** (`offsetHeight` etc.). The sidebar top-container visibility (`hasVisibleTop`) is cached by `refreshSidebarStickyState()`, which runs on init/navigation only.
- Fullscreen blur ramp can be disabled per device via `backgroundWallpaper.fullscreen.blurRamp.enable.{desktop,mobile}` — when off, fullscreen mode has no blur on that device (home + other pages) and the settings-panel blur slider is hidden. Documented in `Firefly-Docs/` (zh/en).

### Path Aliases (tsconfig.json)

`@components/*`, `@assets/*`, `@constants/*`, `@utils/*`, `@i18n/*`, `@layouts/*` → `./src/<dir>/*`; `@/*` → `./src/*`

## Code Style

- **Biome** enforces: tab indentation, double quotes, recommended lint rules
- Relaxed rules for `.svelte`/`.astro`/`.vue` files (`useConst`, `useImportType`, `noUnusedVariables`, `noUnusedImports` off)
- `pnpm lint`/`pnpm format` run `biome check --write` / `biome format --write` over both `./src` and `./scripts`; for a scoped, read-only check prefer `pnpm exec biome check <file>` instead of rewriting unrelated files
- `scripts/subset-font.d.ts` is a hand-written ambient declaration for the untyped `subset-font` package
- Commit convention: **Conventional Commits** (`feat:`, `fix:`, `chore:`, etc.)
