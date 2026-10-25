# Memos 表情菜单前端

在原版编辑器左下角“＋”菜单末尾新增“插入表情”。面板提供 426 个 Unicode 表情（保留原有 105 个）、中英文关键词搜索及分类筛选，分类为“全部、表情、人物、自然、饮食、出行、物品、符号”；“物品”也包含运动和活动。搜索与当前分类共同筛选，切换“全部”可搜索整个表情库。选择后替换正文选区或插入光标位置，并重置搜索与分类；关闭面板也会重置筛选。CodeMirror 原生 transaction 保留光标、撤销/重做及原保存流程。没有新增 npm 依赖、远程表情图片或自动发布调用。

## 源码与构建

- 上游固定 commit：`2b2192d4e153bd04f1d325b60fd880cf00d68b01`，与正式 Memos v0.31.0 对应。
- 2026-10-25 扩充版本更新了当前 codeload 归档摘要：下载包与旧摘要不同，但归档全部 1435 个文件的 Git blob 摘要逐一匹配固定上游提交，原始补丁涉及文件及锁文件摘要也全部匹配。当前输入摘要以 `provenance.json` 为准。
- [emoji.patch](emoji.patch) 只包含编辑器、表情面板、独立表情清单（`web/src/lib/editor-emoji.ts`）、类型、语言键和相关测试的源码差异；零上下文格式使用 `git apply --unidiff-zero`，应用前核对 [provenance.json](provenance.json) 中的归档、锁文件、补丁和输入摘要。编辑器清单保留此前所有表情，不改动上游 Space 图标选择器。
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

清单内非 HTML 静态资源使用独立的 32 个并发名额，其他请求仍限 8 个，避免接口或附件请求占满时连带拒绝样式和脚本。JS/CSS 在启动时预压缩，仅保留比原文更小的 gzip 副本（额外内存不超过原资源总量）；按浏览器编码协商发送，不改变逐请求鉴权与禁止缓存策略。

[update-memos-frontend.py](../update-memos-frontend.py) 分 prepare/activate：先构建后台并核验整份前端清单，再切换到不可变 release。保留旧容器和旧 release，回退只切换后台程序，不还原 Memos/评论数据库。该脚本是本次固定版本的运维入口，不要反复对已完成的目录运行初始化步骤。

实际部署、构建摘要及验收限制见[生产验收记录](../../../docs/plans/2026-10-21-memos-production-acceptance.md)。浏览器实际点击、焦点和保存回读不能由静态构建冒充为已验收。

## 2026-10-25 扩充版本部署

426 个表情与分类筛选已通过 UI-only 入口 `deploy/memos/update-memos-emoji-20261025.py` 部署到 `/opt/dcelysion-admin-stage2/releases/20261025-memos-emoji`。复用本地构建的 300 个文件（12,682,364 字节），完整清单 SHA-256 为 `589bc7be08820c173f9137c344e2d62034cef219fb2e616b6c08f7d4543b8c3b`；与当前 provenance 的补丁摘要匹配。两份补丁工作区的全部 56 个源码摘要及产物清单均核对通过，编辑器、插入菜单、格式工具栏与语言资源定向测试 114/114 通过。

本次基于生产 `20261023-memos-assets` 复制 release，仅替换 `memos-ui` 并更新清单；后台 bundle SHA-256 仍为 `70f651b5b2aad47c30987317570cafb6f3499f6678ba3bbbd69796723dda2e2d`，环境变量、镜像、资源限制及其余挂载保持。隔离 Linux sealed loader、完整 release 清单和候选容器配置等价检查通过。旧容器 `dc-admin-formal-before-memos-emoji-20261025` 与旧 release 保留，失败回退逻辑继续可用。

切换后公网后台登录入口为 200，后台 Memos API、Memos 根页面、API、index 和清单内 JS 的匿名访问均为 401。实际登录后的分类点击与保存回读未在本次验收；后台容器切换会清空临时桥会话，重新载入 Memos 入口可重建。不要重跑此前 10-21 的固定初始化脚本。
