# 双域博客候选打包

阶段 A 使用预构建公开产物作为输入，不执行 Astro/MDX，不调用后台发布链。

```powershell
node scripts/package-public-blog.mjs <可信静态产物目录> <不存在的新目录> <候选ID>
node --test scripts/package-public-blog.test.mjs
node scripts/verify-blog-route.mjs
```

默认三个参数生成 **rehearsal / deploymentEligible=false** 候选，sourceRevision 为 null、buildProvenance 为 unverified。不能发布旧 dist 演练目录，也不能给旧包补出处字段冒充当前构建。

正式生产脚本只能在同一次已授权云端完整构建成功后，立即对该构建的输出调用打包器，并传入实际源码完整 40 位十六进制提交 SHA 和构建平台：

```text
node scripts/package-public-blog.mjs INPUT NEW_OUTPUT RELEASE_ID SOURCE_REVISION BUILD_PROVENANCE
```

BUILD_PROVENANCE 只接受 `github-actions`、`cloudflare-build`、`edgeone-build`；SHA 与平台必须成对提供，缺失或格式错误拒绝。API 使用同名 `sourceRevision`、`buildProvenance` 参数。正式包的 manifest.mode 为 production，manifest 与两端 version.json 的 deploymentEligible 为 true，出处保持一致；两端部署状态仍为 not-deployed，不能将打包成功当作发布成功。

这些字段是生产调用方提供的构建出处声明，打包器本身不执行完整构建、不验证平台任务、不自动推断本地 HEAD。调用方必须保留成功完整构建证据，核对草稿过滤、评论隐藏、Pagefind/相册路由和资源引用；禁止手工给旧产物添加正式参数或直接编辑 version.json 的资格字段冒充验收。

输出包含两份相同公开内容：

- `cloudflare/assets/`：公开文件、固定探针、版本 JSON、Cloudflare `_headers`；候选 `cloudflare/wrangler.json` 指向该目录，使用 404 页面而非 SPA 回退。不改变原 Worker 域名绑定。
- `edgeone/assets/`：相同公开文件、探针和版本 JSON；`edgeone/edgeone.json` 位于项目根，outputDirectory 为 `./assets`。应通过能读取该配置的项目部署模式应用，不能假定控制台只上传 assets 就会读取外面的 JSON。禁止开启 SPA 通配回退。
- `manifest.json`：路径、字节、SHA-256、排除项、公开树摘要、构建出处和两端独立 not-deployed 状态。该清单不在公开 assets 目录。演练 sourceRevision 为 null；正式出处仅来自紧随成功完整云端构建的生产调用方。

允许已知应用资源、公开 API JSON 和预渲染路由 HTML；排除音乐/视频原件、相册非页面文件、后台/server、秘密和源码/映射/备份；未知文件拒绝。草稿可能进入 HTML、索引、RSS 或 JSON，必须依赖可信构建验证，文件扩展名过滤无法替代该步骤。符号链接/junction、输入输出重叠和已有输出目录均拒绝，输入不修改。

探针与版本信息分别位于 `/__route/probe-v1.bin`、`/__route/version.json`。精确端点使用无凭据公开 CORS，no-store/no-transform；不把 CORS 扩展到 API 或私有端点。32 KiB 探针跨版本保持相同，版本 JSON 记录公开树摘要和候选 ID。平台头配置与实际 CDN 缓存/压缩行为仍须在真实部署上验证。

`verify-blog-route.mjs` 仅请求代码固定的两个 HTTPS origin，使用两个主页 Origin 分别检查探针/版本；每次请求超时 10 秒，响应体上限 32 KiB/8 KiB，错误状态不下载整页。它验证响应头与字节，不代表浏览器 CORS/CSP 已验收，也不代替主页 2500ms 决策逻辑。

平台参考：[Workers 静态头](https://developers.cloudflare.com/workers/static-assets/headers/)、[EdgeOne edgeone.json](https://pages.edgeone.ai/document/edgeone-json)、[EdgeOne 缓存](https://pages.edgeone.ai/document/configuring-cache)。实际状态及后续边界见 [阶段 A 交接](../../docs/plans/2026-10-11-blog-routing-stage-a-handoff.md)。
