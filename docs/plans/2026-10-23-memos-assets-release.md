# Memos 静态资源网关优化发布

日期：2026-10-23（Asia/Shanghai）。

- 清单内非 HTML 静态资源独立使用 32 个并发名额，上游接口仍限制 8 个；JS/CSS 在启动时生成 gzip 副本，按 Accept-Encoding 返回。逐请求鉴权和 no-store 保持。
- 本地网关测试 15/15、后台 TypeScript、3 个受影响文件的 Biome 检查及差异空白检查通过，覆盖上游饱和、压缩 GET/HEAD、禁用 gzip 与会话撤销。
- 使用 `deploy/memos/update-memos-assets.py`，在固定 Linux 依赖镜像内离线构建并检查服务端 bundle；完整 release 清单通过。新候选环境、挂载、镜像及关键容器配置与旧容器对等核验后切换。
- 生产 release：`/opt/dcelysion-admin-stage2/releases/20261023-memos-assets`。bundle SHA-256：`70f651b5b2aad47c30987317570cafb6f3499f6678ba3bbbd69796723dda2e2d`。
- 保留旧容器 `dc-admin-formal-before-memos-assets-20261023` 及旧 release。运行环境变量未变；没有还原或修改 Memos/评论数据库。
- 切换后公网：后台首页 200；Memos 首页、后台 `/api/memos` 与 Memos `UpdateUser` 匿名请求均 401。
- 登录态生产 gzip 响应、浏览器加载速度与实际保存未在本轮验收；上述本地行为测试与生产 bundle 核验不能替代这些结果。
- 本次后台程序由腾讯服务器独立发布；GitHub 推送触发的公开博客构建与平台部署另行核验，无 OpenAI Sites 发布。
