# 媒体与 R2 约定

仅在修改音乐、视频、相册资源或站点域名时使用。路径以仓库根目录为基准；执行线上操作仍遵循根目录 AGENTS.md 的授权边界。

### 后台受管媒体（第四阶段）

- 独立媒体库位于 `admin/`，支持受保护原件、图片预览、私有R2同步与固定发布依赖；配置/API/迁移/恢复详见 [后台说明](../../admin/README.md)。私有桶与公共桶必须分离，上传完成不意味着附件公开。
- 公开副本仅在明确发布确认后交付到受限公共目录/R2不可变键，核对大小、MIME和实际SHA-256，R2分发地址也须验证；媒体失败阻止引用页面推送。腾讯目录副本准备并不证明公网入口开放；第8阶段已实现本地双来源选路，必须再通过逐对象HTTP版本回执及容量许可，默认未启用腾讯。
- 回收站仅软删除/恢复，不删除服务器/R2对象；固定任务、草稿和保存回执保留引用，历史索引不完整时永久清理禁用。现有歌单/相册/壁纸URL不重写、不自动托管，也未批量迁移。
- 历史本地测试使用临时目录、PGlite与显式mock。2026-10-04 另已通过真实专用PG与四用途R2的私有同步、明确发布、公开HTTPS交付及关闭重开读取；腾讯公网双来源仍未联调，后台尚未正式上线。

### 受管新媒体的用途分桶（2026-10-04）

- 新上传要求选择 `article/gallery/wallpaper/music`；文章默认article，相册入口固定gallery，BGM音频/封面/歌词固定music，壁纸可在媒体库选择wallpaper。用途与文件类型由服务端校验。未配置的用途不能上传，不接受客户端桶名或endpoint。
- 共用 `dcelysion-admin-private` 私有暂存桶，上传/保存均不公开。明确发布后才复制到用途目标：article→`dcelysion-admin-public`/`admin-media.dcelysion.cn`；gallery→`dcelysion-gallery`/`gallery.dcelysion.cn`；wallpaper→`dcelysion-wallpapers`/`wallpapers.dcelysion.cn`；music→`dcelysion-music`/`music.dcelysion.cn`。本轮已实际核对这四桶和域名，保留历史媒体与URL。
- 用途白名单配置为 `ADMIN_MEDIA_DESTINATIONS`，每项固定bucket、prefix、publicBase与统一publicRoot内的腾讯子目录；原图/预览继承用途。记录与发布计划保存版本和完整目的地，重试沿用记录，不随之后配置变化换桶。更改用途须新媒体ID/新版本和新的明确发布动作，没有静默搬迁接口。
- 无用途的旧记录和已固定旧计划保留原全局桶/URL兼容路径，不根据扩展名推断用途，也不批量迁移。新记录没有目的地时明确报错。
- 分发清单采用逐对象固定两源URL。腾讯edge私有索引可记录相对子目录，但公开清单不包含服务器绝对路径；腾讯回执或容量许可缺失时仍不产生双来源资格。部署配置及验证边界见[真实接入记录](../plans/2026-10-03-admin-runtime-integration.md)。

### 后台配置清单（第五阶段）

- 高频歌单、相册元信息/图片与五项站点显示设置位于 `src/config/manifests/`，原 TS 模块保留播放器选项、资源域名和动态表达式并提供兼容导出。管理后台只保存私有 JSON 修订，固定发布才解析选用媒体并生成对应单文件候选，具体字段/schema/基准门禁见 [后台说明](../../admin/README.md)。
- 相册有显式 `photos`（包括空数组）时由数组决定内容及顺序，不重新扫描目录补回图片；没有该属性时保留旧扫描/urls.txt。既有哈希对象键和预览 URL 保持；受管新图用真实媒体库预览，Fancybox 仍读 original，移除引用不删除历史对象。

### 音乐、壁纸与相册媒体的 Cloudflare R2

- `src/config/musicConfig.ts` 的当前歌单通过 Cloudflare R2 存储桶 `dcelysion-music` 及 `https://music.dcelysion.cn` 提供音频和封面。`src/config/backgroundWallpaper.ts` 的视频壁纸使用独立存储桶 `dcelysion-wallpapers` 及 `https://wallpapers.dcelysion.cn`；对象按 `desktop/`、`mobile/` 前缀组织，可为不同终端配置独立裁剪版本和主体位置。`src/config/galleryConfig.ts` 将本地相册映射到 `dcelysion-gallery` 及 `https://gallery.dcelysion.cn`，对象按 `<album-id>/` 前缀组织。
- `public/assets/music/`、`public/assets/videos/` 和 `public/gallery/` 只作为本地工作副本、构建清单或 LQIP 来源；必须保留并提交 `public/.assetsignore`，使 Workers Static Assets 上传排除音乐/视频目录与相册媒体文件，同时保留构建生成的 `dist/gallery/**/index.html` 相册路由。该文件不等同于 `.gitignore`，暂存前仍须检查媒体二进制。
- 相册详情页瀑布流和相册列表封面优先加载 `gallery-previews.json` 登记的最大宽度 1200px 预览，点击 Fancybox 仍加载原图；顶部横幅、第三方 `urls.txt` 外链和未命中映射的图片继续使用原地址。预览对象按映射中的内容哈希键从 `.gallery-previews/` 非破坏性上传；必须先确认全部预览对象的 HTTP 状态、图片 MIME、尺寸和长度，再部署引用它们的页面，并验证 Fancybox 打开的仍是原图。
- 相册远端原图使用内容哈希文件名和版本化长缓存；新增或替换本地图片后，先非破坏性上传对应新键，再生成预览、上传映射列出的预览对象，最后构建并确认页面 URL 和浏览器显示。不要用会删除远端对象的初次同步命令；相册密码只保护页面展示，不是 R2 对象鉴权。
- R2 视频使用 H.264 + `yuv420p` MP4，写入 `video/mp4` 和版本化长缓存头，并启用 faststart；上传后必须验证自定义域名的 `206 Partial Content` Range 响应和实际播放。
- 新增或更换站点访问域时，必须同步三个媒体桶 R2 CORS 的精确 Origin；当前包括 `https://blog.dcelysion.cn`、`https://dcelysion-blog.lin507793465.workers.dev`、`http://localhost:4321` 和 `http://127.0.0.1:4321`。规则变化后清理对应媒体域名的 CDN 缓存；音视频验证 Range/实际播放，相册验证 HTTP 200、正确图片 MIME/长度和实际显示。

### 第八阶段：媒体双来源与会话选路

- `media-distribution.json`由固定发布工作器生成，原图/预览单独核对公开Keys、腾讯Keys及deliveryReceipts的hash/大小/MIME，不能靠替域名推测存在。与配置/正文候选和构建输入同一快照；私有、单来源、旧外链不参与，不扫描迁移真实媒体。
- `settings.json.mediaRouting`只含有限策略；默认disabled/R2。每标签sessionStorage保存pending/ready，Swup、前后退与刷新复用；没有定时/网络变化自动重测。存储不可用内存降级，设置显示刷新复用受限。手动重选只影响之后未发起的加载。固定腾讯仍须本轮公共容量许可；拒绝/未知回R2，固定R2不竞速。
- 覆盖Rehype正文惰性图片、ImageWrapper/CoverImage、相册网格/原图、动态feed/图库、完整已映射srcset、Fancybox可见及邻页、BGM音频/封面/歌词文件与视频壁纸active/standby。已有src资源保持默认；lazy在构建期去除JS路径的src，noscript保留可见默认。未映射响应式转换候选保留原行为。
- 每次加载备用最多一次、不改首选；播放过的audio/video暂停后仍不自动换源，用户按现有播放控件重新加载才建立新尝试。循环、进度与换歌不触发测速；已有standby下载不因手动选择重置。
- 部署地址与公共容量端点不能在后台表单指定。新增腾讯loopback服务只读公开索引，按全部受控媒体共享320KiB/s、并发2、250GB月响应体预算；R2同步最多64KiB/s、80GB月上传体预算。只有该路径/单进程/单worker被覆盖，不能声称全服务器5Mbps或400GB已保护。部署、CORS/TAO、Range与子预算初始化详见[腾讯受控接入](../../deploy/tencent/media-routing.md)。默认公网关闭，未部署/未真实联调。
