# 布局迁移第四阶段：沉浸阅读接入共享网格消费层

## 本阶段新增改动与变量契约

- 实施基线仍为 `acabc4ea7b6bef6b1c774586799e0c58a7951640` 加 c55b 已验收、未提交的第二／三阶段成果。本阶段仅修改 `src/styles/layout-base.css`、`src/styles/immersive-reading.css` 和架构说明；当前 Git 累计 diff 包含前期成果，不能把它全部归为第四阶段。
- 普通模式继续由 `resolveSidebarLayout(input)` 为 SSR／Swup 产生内联 `--main-grid-cols-md/xl`、`--main-grid-content-column-md/xl` 和 `--main-grid-gap` 等输入。`layout-base.css` 的 `#main-grid` 消费 `--main-grid-active-cols`、`--main-grid-active-content-column`、`--main-grid-active-gap`、`--main-grid-active-column-gap`；未定义时分别回退到对应断点的普通输入。
- 沉浸状态类只在 CSS 中赋予 active 变量，不向 `#main-grid` 写新的内联变量。active 名称与普通内联名称不同，因此 `body` 上继承的沉浸值不会被普通内联输入挡住；Swup 可继续更新普通输入，退出时移除 body 类便自然恢复最新值。没有新增 resize 几何计算或修改事件契约。
- 沉浸基础态为 75rem 版心、左右各 1rem 内边距、单个至多 54.5rem 的居中阅读列、正文第 1 列、行列间距 0。1200px 起目录打开时按 17.5rem 目录／54.5rem 正文／1rem 列间距排双列；右侧配置镜像列与正文位置。1024–1199px 的目录仍是 fixed 浮层。封面、字号、阅读轨、音乐、DOM ID、目录 top 与 margin 未改。

## 增量验证

- 复用前三阶段的普通布局及原始截图基线，没有重复全矩阵。`corepack pnpm check`：268 文件，0 错误／警告／提示。一次 `corepack pnpm build`：25 页成功；生成的 `dist/_astro/Layout.D7V_hZMt.css` 含 `--main-grid-active-cols` 消费规则，构建未留下受版本控制的生成文件差异。`biome check` 对这两个 CSS 返回“0 files”，因配置忽略了它们，不能算通过。
- 生产预览 `127.0.0.1:4322` 的实测数据见 [browser-verification.json](./browser-verification.json)。1200px 普通文章为 `872 / 280px`、正文与页脚同列；进入沉浸后为 `280 / 872px`、16px 列间距、sticky 目录，页脚隐藏。1199px 为居中 872px 正文和 fixed 目录；1023px 自动退出，1024px 按已保存偏好恢复；1279／1280px 保持沉浸双列。1280px 目录关闭后为居中的单个 872px 正文列。
- 右侧配置通过临时将 `tocPosition` 改为 `right` 的本地开发预览 `127.0.0.1:4323` 验证：1200px 正文 872px 在第 1 列、右目录 280px 在第 2 列；1199px 右目录 fixed，关闭后正文居中。随后配置恢复为 `left`，开发服务器停止；正式生产构建使用原配置。
- 通过站内链接及历史导航观察 `SwupA11yPlugin` 的新页面警告、URL、`data-page-kind` 和普通输入变量切换，区分于直接 `goto` 整页加载。沉浸文章 → 首页的最终状态没有沉浸类、active 变量或内容面板内联 top；历史前进恢复文章沉浸。历史路径从欢迎文章前进到 AI 文章后，新文章最终有 5 个目录链接及 5 个阅读轨标记，布局仍为 280／872px。导航刚触发时可能短暂读到旧状态，记录均以替换完成后的状态为准。
- 欢迎文章在 1280×900 稳定视口下，同页普通态 `window.scrollY` 进入前与退出后均为 787.33px。另在 AI 文章的同页对照中，侧栏播放列表展开并滚到 `scrollTop=168` 后，进入前和退出后都是 `clientHeight=192`、`scrollHeight=378`、`scrollTop=168`，抽屉保持展开且期间没有列表操作；这补足第二阶段数据不能证明精确列表滚动恢复的缺口。生产预览抽样时 audio 元素数量为 1，只代表采样时的数量，不证明播放实例身份或整个过渡过程无重建。

## 限制

- 本阶段没有重复壁纸／主题、移动组件、普通布局全矩阵和 42 张历史截图；它们未被本次 CSS 网格消费修改直接触及。没有验证所有音乐播放状态或全部浏览器组合，也没有进入第五阶段全项目回归。
- 右侧镜像在开发预览验证，未另做一次右侧配置的生产构建；生产构建只验证原 `left` 配置。页面上观察到的 Swup 生命周期警告和导航后的状态是软导航证据，未对每一次导航做音频节点对象身份追踪。
