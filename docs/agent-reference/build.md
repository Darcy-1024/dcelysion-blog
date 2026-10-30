# 构建与验证参考

仅在任务涉及构建、依赖、生成资源或验证选择时阅读相关小节。路径以仓库根目录为基准；命令以当前 package.json 为准。

## 7. 构建、生成文件与外部依赖

使用 `package.json` 的 `engines.node` 指定的 Node.js 版本范围和 `packageManager` 固定的 pnpm 版本；`pnpm-workspace.yaml` 固定本地 store 并显式许可依赖构建脚本，`preinstall` 会拒绝其他包管理器。

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
- `pnpm build` 会更新受版本控制的 `src/constants/lqips.json`，也可用 `pnpm lqips` 单独生成；脚本用图片内容 SHA-256 和处理算法版本检查缓存，同路径替换图片会自动重算。指纹及对应渐变保存在已忽略的 `cache/build/lqip-meta.json`，命中时直接恢复生成结果，不要求仓库中的生成 JSON 已同步。首次运行、清除此缓存或算法版本变化后重算；修改 `processImage` 时须递增 `LQIP_CACHE_VERSION`。处理失败保留旧渐变，但不把新图片指纹标记为成功。前端 JSON 结构不变。提交前检查生成差异，并保留此前任务外改动。
- `pnpm build` 会先更新 `src/constants/github-card-data.json`，只收集非草稿正文中的 GitHub 卡片，忽略代码示例与 HTML 注释。成功结果有效期为 24 小时，刷新元数据保存在已忽略的 `cache/build/github-card-meta.json`；`pnpm github-cards --refresh` 可强制刷新。瞬时 DNS/连接/超时、HTTP 429 和 5xx 会短暂等待后重试一次，仍失败时保留已有缓存。提交前检查差异是否合理。
- `pnpm gallery-previews` 是独立的媒体维护命令，不属于普通 `pnpm build`。它为已配置相册的本地图片生成最大宽度 1200px、不会放大的 AVIF 预览，把待上传文件写入已忽略的 `.gallery-previews/`，并更新受版本控制的 `src/constants/gallery-previews.json`。部署引用新映射的 HTML 前必须先上传并验证映射中的全部 R2 对象。
- `pnpm format` 与 `pnpm lint` 都带有 `--write`，且作用于整个 `src/` 和 `scripts/`。已有无关改动或只需验证少量文件时，优先使用 `pnpm exec biome check <相关文件>` 做限定范围的只读检查；不要为验证而改写任务外文件。
- `scripts/generate-vndb-covers.ts` 只在 VNDB 页面启用、模式为 `static`、配置了 `userId` 且开启封面下载时请求外部 API；未配置用户 ID 时会直接跳过。封面写入已忽略的 `public/vndb-covers/`，已有文件会跳过下载。
- `scripts/prune-pio-assets.ts` 在 Astro 构建后从 `dist/` 移除未启用的 Pio/Live2D 产物：Live2D 关闭时移除 `dist/pio/models/live2d` 及孤立的 `Live2DWidget` chunk；Spine 关闭时移除 `dist/pio/models/spine` 和 `dist/pio/static`；两者都关闭时移除整个 `dist/pio`，都启用时不裁剪。Live2D 关闭时 Vite 的 chunk 警告阈值为 700 KiB，用于容纳随后被删除的已知孤立 chunk，启用时仍使用默认 500 KiB。不要手工修改其输出。
- 字体子集脚本在 Astro 构建后扫描 `dist/**/*.html` 与 `dist/**/*.json`，输出到 `dist/_astro/fonts`。MiSans 保留静态内容的首屏子集，其余原字体字符生成互不重叠的 `unicode-range` 分片，仅在昵称、评论、远程歌单等文字实际使用时下载；新增动态文字无需重建字体。分享海报在 Canvas 测量和导出前按正文、标题及作者文字显式等待字体加载。其他本地字体仍按构建内容生成子集。
- 独立后台的 `pnpm admin:build` / `admin:dev` 由 `admin/build/assets.ts` 自动生成 MiSans WOFF2 分片和后台专用 WebP 品牌图到忽略目录 `cache/admin-assets/`，再由 Vite 输出带哈希的资源。常用界面字符合并成一个分片，其余原字体字符全部保留并按 `unicode-range` 按需下载，因此新评论和新标题不需要重新构建字体。保留可变字重与 `font-display: swap`；不手改缓存或 `admin/dist/`。后台资源变更运行 `pnpm admin:check`、`pnpm admin:build` 和相关后台检查即可，不触发公开博客构建。
- `scripts/minify-inline-scripts.ts` 会在字体处理后压缩 `dist/` 中的内联脚本。
- Pagefind 只在完整构建后生成，因此开发服务器中的搜索可用性与生产预览不同。
- `scripts/prepare-sites-dist.ts` 在构建末尾生成 `dist/server/index.js`，供 OpenAI Sites 使用 `ASSETS` binding 托管静态产物；不要手工修改该生成文件。
- `src/constants/icons-data.json` 受版本控制，由 `src/components/common/Icon.svelte` 使用且被 Biome 排除；当前构建没有对应的生成脚本。
- GitHub 卡片、Bangumi、MyAnimeList、VNDB、OG 字体等流程可能访问外部服务；失败时先区分代码错误、缺少配置、网络问题和本地缓存回退。
- `scripts/quarantine-bad-posts.mjs` 会移动文件且不是常规构建步骤，未经明确要求不要运行。



## 10. 验证要求

仓库没有独立单元测试框架。按受影响的执行路径选择验证；下表不是每次任务的固定套餐。已有检查覆盖同一风险时无需重复，纯文档任务不触发应用构建。

| 变更类型 | 建议验证起点 |
| --- | --- |
| 文档或纯配置注释 | 检查差异和引用路径 |
| TypeScript/组件逻辑 | `pnpm check` + `pnpm type-check` |
| 路由、内容 schema、Markdown 插件或页面生成逻辑 | `pnpm check` + `pnpm type-check` + `pnpm build` |
| 图片、字体、搜索索引或其他参与生成流程的资源 | 完整 `pnpm build`，并检查 LQIP、缓存和 `dist/` 差异 |
| 不参与生成流程的静态资源 | 检查引用路径；按影响范围决定是否需要完整构建 |
| 仅样式、间距或颜色微调 | 用 `pnpm dev` 或 `pnpm preview` 检查受影响页面和相关主题/尺寸；涉及构建期行为时再加 `pnpm build` |
| 组件逻辑、交互、Swup 生命周期 | `pnpm check` + `pnpm type-check`，并用 `pnpm dev` 或 `pnpm preview` 验证受影响组合；涉及构建期行为时再加 `pnpm build` |
| 搜索、字体子集、RSS、OG、部署产物 | 必须完整 `pnpm build`，必要时检查 `dist/` |

若某项验证因外部 API、网络或缺少部署变量无法执行，应明确记录未验证项和原因，不要把环境失败描述为代码通过。

## 本地预览启动与故障处理

适用于 Astro 开发服务器、构建预览和独立页面样式预览。按以下顺序执行：

1. **检查端口与已有服务**：启动前确认目标端口及所属进程；已有服务属于本任务且响应内容正确时直接复用。端口被占用时先辨认进程，不盲目重复启动，也不批量终止 Node 进程。只停止已确认属于本任务的失效服务；其他任务的服务保留，必要时选择空闲端口。
2. **保持服务持续运行**：优先使用可持续运行、可读取日志的终端或工具会话，记录会话标识、工作目录和实际监听地址。不要假设启动命令退出后其后台子进程仍会存活。仅供本机查看时绑定 `127.0.0.1`；需要后台启动时隐藏窗口并保留标准输出与错误日志。
3. **确认就绪后再打开**：等待 ready，并以有超时的请求检查实际目标页面及本次改动涉及的关键 CSS/JS/图片。确认状态码、内容类型和内容符合预期，避免将兜底 HTML 的 `200` 当作资源加载成功。探测本机地址时绕过代理，例如 `curl.exe --noproxy "*" --max-time 5 <URL>`。就绪检查设置总时限，不无限轮询。
4. **打开已验证的地址**：检查通过后再打开浏览器，优先复用对应预览标签页；端口变更时提供新地址，避免反复打开旧地址。HTTP 检查通过只证明服务可访问，视觉和交互验收仍以实际浏览器结果为准。让用户继续查看时保留服务，任务结束不再需要时清理本任务进程。

失败时先分类，再选择下一步：

- `EADDRINUSE`：端口已被占用；核对进程归属和响应，不直接重试同一启动命令。
- 已监听但请求超时：保留服务日志和请求错误，分别检查进程是否响应、代理和沙箱访问边界。监听成功不等于 HTTP 服务可用，也不能仅凭一次超时断言是浏览器或沙箱缺陷。
- 服务退出或连接被拒绝：读取退出码与日志，检查启动错误和进程生命周期；不要只重新打开浏览器。
- 具体证据指向沙箱限制时，仅对已授权的预览启动或检查申请必要的沙箱外执行，并复测；不为预览全局关闭沙箱或更改防火墙。审批拒绝时说明阻碍，不绕过限制。
- 页面能访问但资源或样式错误：检查资源路径、响应内容和缓存，确认预览使用本次修改的文件；不要把服务重启当作所有样式问题的解决办法。

同一方法失败且没有新证据时，不重复尝试；交付时区分“进程已启动”“HTTP 已验证”“浏览器已验收”，并注明尚未完成的部分。

## 部署状态核验

- `.github/workflows/public-blog.yml` 在 GitHub 云端完整构建一次；成功后 `scripts/finalize-blog-release.mjs` 筛选公开文件、生成固定探针及提交/公开树摘要。双端包按完整提交发布到 `blog-<SHA>` Release，并附压缩包 SHA-256；不含后台或私有文件。本地普通构建跳过正式打包，不启动腾讯后台 builder。
- 云端工作流只缓存 `cache/build/lqip-meta.json` 与 `cache/build/github-card-meta.json`，按运行系统、锁文件及生成脚本隔离，并跨提交恢复最近可用缓存；图片内容指纹和 GitHub 卡片 TTL 仍决定各条目是否可复用。首次填充缓存仍需全量处理图片，后续未改变的图片跳过解码；不缓存整个 `cache/`、源码生成 JSON 或正式发布包。
- EdgeOne 根 `edgeone.json` 跳过依赖安装，仅运行 `scripts/download-blog-release.mjs edgeone` 下载同提交的云端包，校验压缩包、清单、版本再生成 dist；Cloudflare 默认分支的构建命令使用同一脚本的 cloudflare 模式，部署命令保留 Wrangler。Release 尚未生成时最多等待 10 分钟，失败不切换生产。两端不再分别执行 MDX 构建，以避免 EdgeOne 磁盘/内存不足及产物漂移。
- 发布后必须核对 `/__route/version.json` 的完整提交和 `publicTreeSha256`，以及固定探针字节/头。未通过时继续禁用自动选路；旧演练包不得上传。自动发布包是公开站点内容，不得将源码、环境文件或后台包加入 Release。

- 按实际发布平台、同一仓库和完整提交 SHA 核验。Cloudflare Workers 查看 [Check Runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference) 中的 `Workers Builds: dcelysion-blog`（App：`cloudflare-workers-and-pages`），`completed` / `success` 表示构建通过。
- GitHub Actions 为空不能据此判断 Cloudflare 部署异常；GitHub Pages 单独核对其部署工作流。
- Git 推送、平台构建、生产部署和线上验证分别报告；构建通过不能替代生产版本及线上内容核验。

## Windows 检查阻碍的处理

- 遇到 `split writable root sets`、`helper_unknown_error` 或 `setup refresh`，先判断是否在命令启动前失败。这属于 Codex 沙箱启动问题；同一错误出现后不要靠换引号、换工作目录或重复启动构建碰运气。只对已授权的具体操作走工具审批；审批拒绝时停下该操作。Windows 后端配置应结合当前官方文档和探针验证，不能通过关闭隔离来修复。
- 修改 Codex 沙箱配置后，现有任务可能仍使用启动时的配置。用新进程验证配置读取，并在应用重新加载后复测普通命令和文件修改；一次 CLI 成功不代表当前任务或浏览器已恢复。
- `corepack pnpm` 在 `corepack/v1/pnpm/...` 路径报 `ENOENT` 时，先核对 `packageManager` 固定版本及缓存位置，沙箱可能重定向缓存。仅为已授权命令临时将 `COREPACK_HOME` 指向已确认可用的缓存根目录（`v1` 的上一级），核对版本后执行并恢复原环境值。缓存不可用时可用已安装的项目工具入口做局部检查，不因缓存定位错误重装依赖或更改全局配置。
- PowerShell 中含正则、SVG、引号或多行逻辑的 JavaScript，不拼成长串 `node -e`。使用单引号 here-string 写入临时脚本再运行，或通过标准输入执行；临时脚本使用项目依赖时放在项目内的临时目录并在完成后清理。先检查语法，再运行有写入的脚本。
- `rg` 返回 1 可能只是没有匹配，需结合输出判断；Windows 文件通配优先使用 `rg -g`，不要假设 shell 会展开 `astro.config.*`。限定源码路径，避免扫描压缩资源或输出 base64 到检查日志。
- 首次需要额外 CLI 时先用 `Get-Command` 探测。没有 `gh` 时，公开仓库的只读检查可直接用 GitHub REST API；需要身份权限时使用已授权连接，不能把工具缺失当成部署失败。部署结果按上方“部署状态核验”小节判断。
- Astro 若因遥测目录权限失败，仅为该命令设置 `$env:ASTRO_TELEMETRY_DISABLED='1'`；`uv_os_get_passwd` / `ENOMEM` 需先排查沙箱身份与运行环境，不据此修改业务代码或重装依赖。开发服务器等到 ready 后再访问目标路由；同一工作区不要并发安装依赖或运行会写相同产物的构建。
- 生成步骤失败后，先确认目标文件存在再预览或读取；调用库方法前核对本项目版本是否提供该 API。历史日志按任务和错误摘录，避免整份工具输出进入上下文。
