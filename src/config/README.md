# 配置文件说明

本目录包含 Firefly 主题的所有配置文件，采用模块化设计，每个文件负责特定的功能模块。

## 📁 配置文件结构

```
src/config/
├── index.ts                  # 配置索引文件 - 统一导出
├── siteConfig.ts             # 站点基础配置
├── analyticsConfig.ts        # 统计分析配置（Google Analytics、Umami、51la 等）
├── announcementConfig.ts     # 公告配置
├── backgroundWallpaper.ts    # 背景壁纸配置
├── commentConfig.ts          # 评论系统配置
├── coverImageConfig.ts       # 封面图配置
├── displaySettingsConfig.ts  # 设置面板配置
├── dynamicConfig.ts          # 动态页面配置
├── effectsConfig.ts          # 动画特效配置（樱花等）
├── expressiveCodeConfig.ts   # 代码高亮配置
├── fontConfig.ts             # 字体配置
├── footerConfig.ts           # 页脚配置
├── friendsConfig.ts          # 友链配置
├── galleryConfig.ts          # 相册配置
├── licenseConfig.ts          # 许可证配置
├── musicConfig.ts            # 音乐播放器配置
├── navBarConfig.ts           # 导航栏配置（含 LinkPresets 链接预设）
├── pioConfig.ts              # 看板娘配置（Spine、Live2D）
├── mermaidConfig.ts          # Mermaid 图表配置
├── plantumlConfig.ts         # PlantUML 图表配置
├── profileConfig.ts          # 用户资料配置
├── sidebarConfig.ts          # 侧边栏布局配置
├── sponsorConfig.ts          # 打赏配置
└── README.md                 # 本文件
```

## 🚀 使用方式

### 推荐：使用配置索引（统一导入）
```typescript
import { siteConfig, profileConfig } from "@/config";
```

### 直接导入单个配置
```typescript
import { siteConfig } from "@/config/siteConfig";
import { profileConfig } from "@/config/profileConfig";
```

## 📋 配置文件列表

| 文件 | 说明 |
|------|------|
| `siteConfig.ts` | 站点基础配置（标题、描述、主题色、导航栏模式、页面宽度、沉浸阅读等） |
| `analyticsConfig.ts` | 统计分析配置（Google Analytics、Microsoft Clarity、Umami、51la） |
| `announcementConfig.ts` | 公告配置（标题、内容、类型、链接等） |
| `backgroundWallpaper.ts` | 背景壁纸配置（壁纸模式、classic/hero 全屏布局、图片、桌面/移动端视频、横幅文字、水波纹等） |
| `commentConfig.ts` | 评论系统配置（Twikoo、Waline、Artalk、Giscus、Disqus） |
| `coverImageConfig.ts` | 封面图配置（文章封面图、随机封面图 API） |
| `displaySettingsConfig.ts` | 视图设置面板配置（面板总开关、壁纸/全屏布局切换及各设置项开关） |
| `dynamicConfig.ts` | 动态页面配置（页面标题、描述、评论开关和每页显示数量） |
| `effectsConfig.ts` | 动画特效配置（樱花数量、速度、尺寸等） |
| `expressiveCodeConfig.ts` | 代码高亮配置（亮色/暗色主题、折叠、语言徽章） |
| `fontConfig.ts` | 字体配置（字体列表、回退、预加载与本地子集化） |
| `footerConfig.ts` | 页脚配置（自定义 HTML 注入，如备案号） |
| `friendsConfig.ts` | 友链配置（友链列表、页面设置） |
| `galleryConfig.ts` | 相册配置（相册列表、远端资源根地址、内容哈希版本和瀑布流列宽） |
| `licenseConfig.ts` | 许可证配置（CC 协议等） |
| `musicConfig.ts` | 音乐播放器配置（Meting API / 本地歌单、public 相对路径或外部 HTTPS 媒体、导航栏和侧边栏开关） |
| `navBarConfig.ts` | 导航栏配置（动态链接、含系列页的 LinkPresets 链接预设、搜索配置） |
| `pioConfig.ts` | 看板娘配置（Spine 模型、Live2D 模型） |
| `plantumlConfig.ts` | PlantUML 图表渲染配置 |
| `profileConfig.ts` | 用户资料配置（头像、姓名、社交链接） |
| `sidebarConfig.ts` | 侧边栏布局配置（左侧/右侧/移动端组件列表） |
| `sponsorConfig.ts` | 打赏配置（打赏方式、打赏者列表） |

## 📝 说明

- 关于页正文与普通文章共用全局 `fontConfig.selected`、字号、行高及中文间距和断行规则；标题共用下述独立配置。
- `fontConfig.articleTitleFont` 与 `articleTitleWeight` 控制文章详情页的大标题、正文各级标题及关于页标题（含两类页面的横幅标题），默认使用霞鹜文楷 Regular（400），文章和关于页横幅共同通过 `articleBannerTitleWeight` 单独使用 Medium（500）；留空字体字段则恢复全局字体及原有字重。首页卡片、导航与正文段落不受影响。本地字体随完整构建生成 WOFF2 子集；修改字体配置后需要重启开发服务器。
- 所有配置文件均可通过 `index.ts` 统一导入
- 每个配置文件对应 `types/` 目录下的独立类型定义文件
- `siteConfig.ts` 只保留站点核心信息，不聚合其他模块配置
- `navBarConfig.ts` 底部的 `LinkPresets` 可自由自定义导航栏链接的名称、图标和 URL
- `siteConfig.navbar.navbarMode` 支持 `static`、`fixed`、`dynamic`；设置为 `fixed` 时，普通文章详情页自动使用下滑隐藏、上滑显示的动态导航，回到顶部常显，离开文章页或进入沉浸阅读后恢复配置模式；`siteConfig.post.immersiveReading` 控制文章页沉浸阅读按钮、无用户偏好时的默认状态和目录位置，访问者手动进入或退出后的选择会保存在浏览器中；启用后，右侧章节阅读轨在普通与沉浸阅读中都会生效
- `displaySettingsConfig.ts` 的视图设置面板默认关闭，除了修改配置里的 `enable`，也可以在部署平台（Vercel / Cloudflare 等）设置环境变量 `PUBLIC_DISPLAY_SETTINGS=true` 开启，无需改动配置文件；环境变量优先级更高，取值 `true/1/on/yes` 开启、`false/0/off/no` 关闭
- 相册始终从 `public/gallery/<album-id>/` 扫描本地副本。设置 `galleryConfig.assetBaseUrl` 后，页面会把这些本地文件映射为远端 HTTPS URL；`assetVersioning: "content-hash"` 会给远端文件名加入内容哈希，以便安全使用长期缓存。本地文件仍用于生成相册清单和 LQIP，`urls.txt` 中的第三方外链不会被改写。
- 执行 `pnpm gallery-previews` 会为已配置相册的本地图片生成最大宽度 1200px、不会放大的 AVIF 预览，待上传文件暂存于已忽略的 `.gallery-previews/`，映射写入 `src/constants/gallery-previews.json`。相册详情页瀑布流优先加载已登记的预览，点击 Fancybox 仍加载原图；顶部横幅、相册列表封面、第三方外链和未命中映射的图片继续使用原地址。该命令不会由 `pnpm build` 自动执行，部署引用新映射的页面前必须先上传并验证对应 R2 对象。
