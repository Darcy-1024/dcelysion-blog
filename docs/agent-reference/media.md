# 媒体与 R2 约定

仅在修改音乐、视频、相册资源或站点域名时使用。路径以仓库根目录为基准；执行线上操作仍遵循根目录 AGENTS.md 的授权边界。

### 音乐、壁纸与相册媒体的 Cloudflare R2

- `src/config/musicConfig.ts` 的当前歌单通过 Cloudflare R2 存储桶 `dcelysion-music` 及 `https://music.dcelysion.cn` 提供音频和封面。`src/config/backgroundWallpaper.ts` 的视频壁纸使用独立存储桶 `dcelysion-wallpapers` 及 `https://wallpapers.dcelysion.cn`；对象按 `desktop/`、`mobile/` 前缀组织，可为不同终端配置独立裁剪版本和主体位置。`src/config/galleryConfig.ts` 将本地相册映射到 `dcelysion-gallery` 及 `https://gallery.dcelysion.cn`，对象按 `<album-id>/` 前缀组织。
- `public/assets/music/`、`public/assets/videos/` 和 `public/gallery/` 只作为本地工作副本、构建清单或 LQIP 来源；必须保留并提交 `public/.assetsignore`，使 Workers Static Assets 上传排除音乐/视频目录与相册媒体文件，同时保留构建生成的 `dist/gallery/**/index.html` 相册路由。该文件不等同于 `.gitignore`，暂存前仍须检查媒体二进制。
- 相册详情页瀑布流优先加载 `gallery-previews.json` 登记的最大宽度 1200px 预览，点击 Fancybox 仍加载原图；顶部横幅、相册列表封面、第三方 `urls.txt` 外链和未命中映射的图片继续使用原地址。预览对象按映射中的内容哈希键从 `.gallery-previews/` 非破坏性上传；必须先确认全部预览对象的 HTTP 状态、图片 MIME、尺寸和长度，再部署引用它们的页面，并验证 Fancybox 打开的仍是原图。
- 相册远端原图使用内容哈希文件名和版本化长缓存；新增或替换本地图片后，先非破坏性上传对应新键，再生成预览、上传映射列出的预览对象，最后构建并确认页面 URL 和浏览器显示。不要用会删除远端对象的初次同步命令；相册密码只保护页面展示，不是 R2 对象鉴权。
- R2 视频使用 H.264 + `yuv420p` MP4，写入 `video/mp4` 和版本化长缓存头，并启用 faststart；上传后必须验证自定义域名的 `206 Partial Content` Range 响应和实际播放。
- 新增或更换站点访问域时，必须同步三个媒体桶 R2 CORS 的精确 Origin；当前包括 `https://blog.dcelysion.cn`、`https://dcelysion-blog.lin507793465.workers.dev`、`http://localhost:4321` 和 `http://127.0.0.1:4321`。规则变化后清理对应媒体域名的 CDN 缓存；音视频验证 Range/实际播放，相册验证 HTTP 200、正确图片 MIME/长度和实际显示。
