# 构建与验证参考

仅在任务涉及构建、依赖、生成资源或验证选择时阅读相关小节。路径以仓库根目录为基准；命令以当前 package.json 为准。

## 7. 构建、生成文件与外部依赖

只使用 pnpm 11（需要 Node.js 22 或更高版本）；`package.json` 固定具体 pnpm 版本，`pnpm-workspace.yaml` 固定本地 store 并显式许可依赖构建脚本，`preinstall` 会拒绝其他包管理器。

```bash
pnpm dev             # Astro 开发服务器
pnpm check           # Astro 诊断
pnpm type-check      # TypeScript --noEmit --isolatedDeclarations
pnpm format          # Biome 格式化并写入 src 与 scripts
pnpm lint            # Biome 检查、格式化并写入 src 与 scripts
pnpm lqips           # 重新生成 src/constants/lqips.json
pnpm gallery-previews # 生成最大宽度 1200px 的 AVIF 相册预览和映射
pnpm github-cards    # 重新生成 src/constants/github-card-data.json
pnpm build           # GitHub 卡片 -> LQIP -> VNDB 封面 -> Astro -> Pio 裁剪 -> 字体 -> 内联脚本压缩 -> Pagefind -> Sites 入口
pnpm preview         # 预览 dist
pnpm new-post <name> # 新建文章
pnpm new-dynamic ... # 新建动态
```

构建注意事项：

- `pnpm-workspace.yaml` 把 pnpm store 放在仓库内，因此 `astro.config.mjs` 必须继续从 Vite watcher 排除 `**/.pnpm-store/**`；否则 Windows 启动时会遍历数万个依赖缓存文件。依赖安装或升级后应重启开发服务器，而不是依赖 store 文件的热更新。Cloudflare adapter 也只在设置 `CF_WORKERS` 时动态加载，普通 `pnpm dev` 和静态构建不应提前初始化 Wrangler/Miniflare。
- `pnpm build` 会更新 `src/constants/lqips.json`；提交前检查差异是否来自本次资源变更。
- `pnpm build` 会先更新 `src/constants/github-card-data.json`；瞬时 DNS/连接/超时、HTTP 429 和 5xx 会短暂等待后重试一次，仍失败时保留已有缓存。提交前检查差异是否合理。
- `pnpm gallery-previews` 是独立的媒体维护命令，不属于普通 `pnpm build`。它为已配置相册的本地图片生成最大宽度 1200px、不会放大的 AVIF 预览，把待上传文件写入已忽略的 `.gallery-previews/`，并更新受版本控制的 `src/constants/gallery-previews.json`。部署引用新映射的 HTML 前必须先上传并验证映射中的全部 R2 对象。
- `pnpm format` 与 `pnpm lint` 都带有 `--write`，且作用于整个 `src/` 和 `scripts/`。已有无关改动或只需验证少量文件时，优先使用 `pnpm exec biome check <相关文件>` 做限定范围的只读检查；不要为验证而改写任务外文件。
- `scripts/generate-vndb-covers.ts` 只在 VNDB 页面启用、模式为 `static`、配置了 `userId` 且开启封面下载时请求外部 API；未配置用户 ID 时会直接跳过。
- `scripts/prune-pio-assets.ts` 在 Astro 构建后从 `dist/` 移除未启用的 Pio/Live2D 产物；Live2D 关闭时 Vite 的 chunk 警告阈值为 700 KiB，用于容纳这个随后被删除的已知孤立 chunk，启用时仍使用默认 500 KiB。不要手工修改其输出。
- 字体子集脚本在 Astro 构建后扫描 `dist/**/*.html` 与 `dist/**/*.json`，输出到 `dist/_astro/fonts`。
- `scripts/minify-inline-scripts.ts` 会在字体处理后压缩 `dist/` 中的内联脚本。
- Pagefind 只在完整构建后生成，因此开发服务器中的搜索可用性与生产预览不同。
- `scripts/prepare-sites-dist.ts` 在构建末尾生成 `dist/server/index.js`，供 OpenAI Sites 使用 `ASSETS` binding 托管静态产物；不要手工修改该生成文件。
- GitHub 卡片、Bangumi、MyAnimeList、VNDB、OG 字体等流程可能访问外部服务；失败时先区分代码错误、缺少配置、网络问题和本地缓存回退。
- `scripts/quarantine-bad-posts.mjs` 会移动文件且不是常规构建步骤，未经明确要求不要运行。



## 10. 验证要求

仓库没有独立单元测试框架。按受影响的执行路径选择验证；下表不是每次任务的固定套餐。已有检查覆盖同一风险时无需重复，纯文档任务不触发应用构建。

| 变更类型 | 建议验证起点 |
| --- | --- |
| 文档或纯配置注释 | 检查差异和引用路径 |
| TypeScript/组件逻辑 | `pnpm check` + `pnpm type-check` |
| 页面、内容 schema、Markdown 插件 | `pnpm check` + `pnpm type-check` + `pnpm build` |
| 图片、字体、搜索索引或其他参与生成流程的资源 | 完整 `pnpm build`，并检查 LQIP、缓存和 `dist/` 差异 |
| 不参与生成流程的静态资源 | 检查引用路径；按影响范围决定是否需要完整构建 |
| 视觉、交互、Swup 生命周期 | `pnpm check` + `pnpm type-check`，并用 `pnpm dev` 或 `pnpm preview` 验证受影响组合；涉及构建期行为时再加 `pnpm build` |
| 搜索、字体子集、RSS、OG、部署产物 | 必须完整 `pnpm build`，必要时检查 `dist/` |

若某项验证因外部 API、网络或缺少部署变量无法执行，应明确记录未验证项和原因，不要把环境失败描述为代码通过。

### 补充生成文件约定

GitHub card metadata is generated into `src/constants/github-card-data.json` and committed — regenerate with `pnpm github-cards`. Transient DNS, connection, timeout, HTTP 429, and 5xx failures are retried once before the existing cache fallback. LQIP data is generated into `src/constants/lqips.json` and committed — regenerate with `pnpm lqips`. Icon data lives in `src/constants/icons-data.json` (committed, Biome-ignored, consumed by `src/components/common/Icon.svelte`) but has no generator script in the current build.

Gallery previews are generated explicitly with `pnpm gallery-previews`; this is not part of `pnpm build`. The command writes max-width 1200px AVIF upload files to the ignored `.gallery-previews/` staging directory and updates the committed `src/constants/gallery-previews.json` mapping. Upload and verify every mapped R2 object before deploying HTML that references a new mapping.

`generate-vndb-covers.ts` downloads VNDB cover art into `public/vndb-covers/` (gitignored, skips files that already exist). It no-ops unless `siteConfig.vndb` has a `userId`, `downloadCovers: true`, and `mode: "static"`.

`prune-pio-assets.ts` deletes unused 看板娘 assets from `dist/` after the Astro build (Astro copies all of `public/` regardless of config). It drops `dist/pio/models/live2d` plus the orphaned `Live2DWidget` client chunk when `live2dWidgetConfig.enable` is false, `dist/pio/models/spine` and `dist/pio/static` when `spineModelConfig.enable` is false, and all of `dist/pio` when both are off (~15 MiB). While Live2D is disabled, Vite's chunk warning limit is 700 KiB for this known intermediate orphan; enabling it restores the default 500 KiB limit. The pruning script no-ops when both models are enabled.

`prepare-sites-dist.ts` runs last and generates `dist/server/index.js`, the entry for OpenAI Sites to serve the static output via an `ASSETS` binding.
