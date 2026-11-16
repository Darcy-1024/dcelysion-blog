<div align="center">

# DcElysion

**Darcy 的个人博客 · 文章、生活记录与 ACGN 收藏**

唯有那份炫目，未曾忘却

[访问博客](https://blog.dcelysion.cn/) · [关于我](https://blog.dcelysion.cn/about/) · [订阅更新](https://blog.dcelysion.cn/rss/) · [反馈问题](https://github.com/Darcy-1024/dcelysion-blog/issues)

</div>

---

## 关于这个项目

DcElysion 是 Darcy 的个人博客，用来分享文章、记录日常，也收集喜欢的音乐、影像与 ACGN 作品。这个仓库保存博客源码及配套的内容管理工具，并围绕个人写作、阅读和内容发布持续维护。

项目基于 [Firefly](https://github.com/CuteLeaf/Firefly) 二次开发，使用 Astro、Svelte、TypeScript 和 Tailwind CSS。

## 在博客里

- **阅读文章**：通过归档、分类、标签和全文搜索查找内容，按系列连续阅读；文章页提供目录与沉浸阅读模式。
- **看看近况**：在动态中浏览日常记录，查看单条动态并分享。
- **翻阅相册**：浏览图片与相册，留下值得回看的片段。
- **发现兴趣**：查看 Bangumi 与 VNDB 收藏，在浏览时听音乐。
- **交流与订阅**：通过评论、留言板和友链交流，使用 RSS 或 Atom 订阅更新。
- **调整阅读体验**：切换浅色、深色或跟随系统的外观，在桌面与移动设备上阅读。

## 仓库内容

| 目录 | 内容 |
| --- | --- |
| `src/content/` | 文章、动态等内容 |
| `src/pages/` | 博客页面与订阅入口 |
| `src/components/` | 页面组件、侧边栏与播放器等功能 |
| `src/config/` | 站点、导航、外观及功能配置 |
| `admin/` | 配套内容管理后台 |
| `scripts/` | 内容创建、媒体处理与构建脚本 |
| `public/` | 静态资源 |

## 本地运行

需要 **Node.js >= 22.23.0**，使用项目固定的 **pnpm 11.22.0**。具体版本以 [package.json](package.json) 为准。

```bash
git clone https://github.com/Darcy-1024/dcelysion-blog.git
cd dcelysion-blog
corepack pnpm install
corepack pnpm dev
```

打开开发服务器输出的本地地址，默认是 `http://localhost:4321`。

| 命令 | 用途 |
| --- | --- |
| `corepack pnpm dev` | 启动博客开发服务器 |
| `corepack pnpm check` | 运行 Astro 检查 |
| `corepack pnpm build` | 构建博客并生成搜索索引等资源 |
| `corepack pnpm preview` | 预览已构建的博客 |
| `corepack pnpm new-post <name>` | 创建文章 |
| `corepack pnpm admin:dev` | 启动配套后台开发服务，需另行配置环境 |

站点配置见 [配置文件说明](src/config/README.md)，构建所需的外部依赖与注意事项见 [构建参考](docs/agent-reference/build.md)。本仓库包含个人站点配置；复用时请替换站点信息、内容及服务配置。

## 致谢

- [CuteLeaf / Firefly](https://github.com/CuteLeaf/Firefly)：本项目的上游主题，提供了博客的界面与功能基础。
- [saicaca / Fuwari](https://github.com/saicaca/fuwari)：Firefly 所基于的原始博客模板。
- [Astro](https://astro.build/)、[Svelte](https://svelte.dev/)、[Tailwind CSS](https://tailwindcss.com/)、[Swup](https://swup.js.org/)、[Pagefind](https://pagefind.app/) 及其他开源项目。
- [MiSans](https://hyperos.mi.com/font/faq) 与 [霞鹜文楷](https://github.com/lxgw/LxgwWenKai)：站点使用的字体。

仓库内保留的其他语言 README 为上游主题说明，尚未改写为 DcElysion 项目介绍；本项目介绍以本页为准。

## 许可与素材

代码许可证见 [LICENSE](LICENSE)，保留原作者版权声明：

- Copyright (c) 2024 saicaca
- Copyright (c) 2025 CuteLeaf

文章、图片、音乐、字体及其他第三方素材的权利归各自权利人所有，使用时请遵循对应授权。流萤相关素材归《崩坏：星穹铁道》及其权利人所有。
