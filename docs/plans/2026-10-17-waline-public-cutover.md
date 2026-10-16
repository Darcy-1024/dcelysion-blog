# Waline 公开接入记录（2026-10-17）

## 本地源码

- `src/config/commentConfig.ts` 默认启用 Waline，默认服务地址为 `https://comments.dcelysion.cn`。
- 显式设置 `PUBLIC_COMMENT_PROVIDER=twikoo` 可在重新构建后回退 Twikoo；`PUBLIC_WALINE_SERVER_URL` 仍可覆盖 Waline 服务地址。
- 评论登录模式保持 `enable`，保留登录及匿名评论；文章、留言板、友链、赞助页和动态 iframe 继续使用现有统一评论组件与 Swup 生命周期。
- GitHub 共享公开包、GitHub Pages 与本地构建使用源码默认值，无须分别向工作流追加评论变量。已有平台环境覆盖仍须在发布时核对。

## 验证记录

- 限定 Biome 检查通过：`src/config/commentConfig.ts`，无写入修复。
- 本地配置检查通过：默认 Waline 与正式域、显式 Twikoo 回退、显式 Waline 地址覆盖。日志：`cache/waline-public-20261017/config-check.log`。
- 完整构建执行一次并通过（退出码 0），日志：`cache/waline-public-20261017/build.log`。本地构建按项目约定跳过正式云端打包。
- 生成产物检查通过：两篇已生成文章以及 `dist/dynamic/comments/index.html` 均为正式 Waline 地址、`login=enable`，无 Twikoo 挂载节点；动态 iframe 路径参数入口及运行时读取逻辑保持。记录：`cache/waline-public-20261017/output-check.json`。这不替代真实浏览器 Swup、登录或发评论验收。
- 构建未留下 `src/constants/` 的已跟踪缓存差异，无须恢复其他人的文件。构建报告 Pagefind 跳过五个缺少外层 `<html>` 的页面；构建成功，本次未扩展修复搜索收录问题。
- `corepack pnpm --version` 遇到沙箱重定向缓存 `ENOENT`；已核实并使用实际缓存的 pnpm `11.22.0` 入口执行构建，未调整依赖或源码来规避环境问题。

## 授权与发布状态（开始 Git 发布前记录）

- 服务端公开入口已启用；博客前端只完成本地构建，线上博客尚未切换。
- 用户已确认授权本次 Git 提交和 GitHub 推送；下列验证完成后开始发布，具体提交、自动部署和线上结果以本轮发布回执为准。OpenAI Sites 不在本次授权范围内。
- 正式发布后分别记录共享包构建、Cloudflare/EdgeOne/GitHub Pages 部署结果、完整提交和公开树摘要，以及浏览器评论加载、动态路径隔离、登录和后台权限验证结果。
- 前端回退需要重新构建并发布；不修改或回滚评论数据库。

## 已执行的服务器改动

- DNS 官方 MCP 核对：`comments.dcelysion.cn` 已有直连腾讯服务器的 A 记录，无需改 DNS。此前域名证书不匹配是因为没有对应公网 443 虚拟主机。
- 采用 `deploy/tencent/nginx-comments-public.conf`，启用 443/IPv6 443，同时保留原回环预览监听。活动链接为 `/etc/nginx/sites-enabled/dcelysion-comments-public`；旧 private 链接已停用，旧文件保留。HTTP ACME 路径保留，评论域其余 HTTP 请求跳转 HTTPS。
- 普通用户 `/ui/login`、`/ui/register`、`/ui/profile`、找回及重置页可公开访问；其余 `/ui/` 跳转 `https://admin.dcelysion.cn`。`/api/management` 和 `/api/db` 在公开代理返回 404，Access 后台与其回环代理未修改。旧改密 API 继续 410。账号页面与 API 不缓存，请求日志避免记录 OAuth state。
- `.env` 只补充 `SECURE_DOMAINS` 中的 EdgeOne 域名；未输出密钥。Waline 仍映射回环 8360，数据库不开放公网；本次只重建 Waline，没有重启 PostgreSQL、找回密码服务或管理后台。
- 公开前检查发现运行镜像漏装 `logic/management.js`，匿名管理查询因此能读取含邮箱、账号状态的 DTO。发现后立即撤掉新公网监听，修复后再开放。新镜像 `dcelysion/waline-public:20261017-guard` 基于当时头像版本增量加入该 logic，以及控制器内独立的 401/403 校验；即使以后再次漏装 logic，controller 也先拒绝未授权读取。公开访客榜单只含昵称、网址、头像等公开字段，不改其正常行为。
- 新镜像语法检查、Nginx 配置检查、就绪及 EdgeOne Origin 请求通过。服务内部匿名管理读取返回 401，公开管理路径返回 404，公开登录页及固定脚本返回 200。控制器回归测试 6/6 通过，覆盖匿名、缺少身份、普通用户、管理员和公开榜单字段过滤。
- Certbot `reconfigure` 已通过 webroot HTTP 验证续期演练，保存自动续期配置及 Nginx reload hook；不再依赖手工 DNS TXT。

## 评论与备份

- 改动前数据库 dump 已通过 `pg_restore --list`。配置、受保护环境快照与数据库备份位于服务器 `/opt/dcelysion/config-backups/waline-public-20261016T162133Z`（路径按服务器 UTC 命名，对应北京时间 10 月 17 日）。不将这些数据加入 Git。
- Twikoo 原有公开评论比 Waline 多一条：动态 `/dynamic/2026-09-26-225100/` 的 `df18ded24ef548c892f68277f6daffa6`。已从公开 API 补入其正文、昵称、网址和时间，存为 Waline id=14，未关联任何注册账号、未发送邮件。缺失的邮箱/UA 使用空字符串以兼容现有渲染模板。
- 该条增量仅同步公开字段；私有邮箱、IP、原头像摘要等元数据仍保存在原 Twikoo，没有猜测或补造。Twikoo 服务与原数据保留，完整元数据迁移仍需后台完整导出。
- Waline 当前共 10 条评论；原有九条逐行摘要保持一致，新增动态接口返回 200、errno=0、count=1。本次没有迁移 Twikoo 的增量访问量计数。

## 浏览器与剩余边界

- 真实 Edge 本地构建预览已显示 Waline 评论框及「登录」「提交」，无评论系统切换按钮。点击登录确实打开评论域的 `/ui/login?lng=zh-CN` 弹窗；浏览器工具后续读取登录窗口遇到超时及 `Debugger unattached`，未据此宣称完成真实账号登录。登录页 HTML/脚本与接口的 HTTP 可达性检查不能代替账号持有人验收。
- 尚未提交真实评论、注册账号、发送验证邮件或修改账号；真实登录、个人资料保存及 Swup 完整往返仍待前端发布后验收。
- 回退前端只设置 `PUBLIC_COMMENT_PROVIDER=twikoo` 并重新构建发布。服务端若回退，先撤销公开监听或保持公开管理接口拦截，不得回到存在匿名管理查询缺陷的公开状态；保留新增评论与兼容字段，不恢复整库覆盖当前数据。
