# Memos 表情菜单前端

在原版编辑器左下角“＋”菜单末尾新增“插入表情”。面板提供常用 Unicode 表情和关键词搜索，选择后替换正文选区或插入光标位置；CodeMirror 原生 transaction 保留光标、撤销/重做及原保存流程。没有新增 npm 依赖、远程表情图片或自动发布调用。

## 源码与构建

- 上游固定 commit：`2b2192d4e153bd04f1d325b60fd880cf00d68b01`，与正式 Memos v0.31.0 对应。
- [emoji.patch](emoji.patch) 只包含编辑器、表情面板、类型、语言键和相关测试的源码差异；零上下文格式使用 `git apply --unidiff-zero`，应用前核对 [provenance.json](provenance.json) 中的归档、锁文件、补丁和输入摘要。
- 简体、繁体中文和英文提供新增文案，其他语言的新键使用英文兜底；既有译文不改动。
- Node 24，pnpm **11.0.1**，按原锁文件安装，不变更依赖版本。`build.mjs` 的 workspace/output 必须是尚不存在的专用目录。

```sh
curl --fail --location https://codeload.github.com/usememos/memos/tar.gz/2b2192d4e153bd04f1d325b60fd880cf00d68b01 -o upstream.tar.gz
node /path/to/deploy/memos/frontend/build.mjs /absolute/upstream.tar.gz /absolute/new-workspace /absolute/new-ui-output
```

脚本校验输入，应用源码补丁，执行类型/Biome、相关编辑器与语言检查，再运行正式 `pnpm release`。输出为构建生成的静态资源、原 MIT 许可证和完整 SHA-256 文件清单，不能手工修改输出文件。测试显式使用 `NODE_ENV=test`，正式构建使用 production。

## 接入与回退

由现有后台网关提供固定前端目录，生产配置为 `ADMIN_MEMOS_FRONTEND_DIRECTORY=/app/backend/memos-ui`，不会修改 Memos 数据容器或 Go 后端。目录须包含 `frontend-manifest.json`，格式为 schema 1、固定 upstreamCommit、patchSHA256、entries（path/bytes/sha256）。所有条目在后台启动时检查摘要与大小并载入有界内存，禁止符号链接；请求按清单映射，不能拼接任意路径读取磁盘。

新静态资源也先验证原后台会话、等待进行中的凭据刷新；HTML 只在原上游成功返回页面时替换。API、附件和未命中的旧哈希资源仍走原代理。响应保持私有、不可缓存与精确 iframe 来源策略。没有配置该目录时继续提供官方原前端。

[update-memos-frontend.py](../update-memos-frontend.py) 分 prepare/activate：先构建后台并核验整份前端清单，再切换到不可变 release。保留旧容器和旧 release，回退只切换后台程序，不还原 Memos/评论数据库。该脚本是本次固定版本的运维入口，不要反复对已完成的目录运行初始化步骤。

实际部署、构建摘要及验收限制见[生产验收记录](../../../docs/plans/2026-10-21-memos-production-acceptance.md)。浏览器实际点击、焦点和保存回读不能由静态构建冒充为已验收。
