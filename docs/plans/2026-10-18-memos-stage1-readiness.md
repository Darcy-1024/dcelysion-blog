# Memos 阶段一：当前核实与部署准备

日期：2026-10-18（Asia/Shanghai）。状态：只读核实和配置准备完成；部署与运行验收待授权。尚未进入第二阶段。

## 1. 已取得的当前证据

- 已读取当前 AGENTS.md、原交接计划、工作区 status/diff，保留全部既有改动及未跟踪文件。本任务仅新增 `deploy/memos/`、本报告并追加原交接文档；未提交、未推送。
- 本地 HEAD `33eb2e58ee1cc8f66d89dfaf01b270c41f367a2c`，origin 为 Darcy-1024/dcelysion-blog；该提交的 [共享公共构建](https://github.com/Darcy-1024/dcelysion-blog/actions/runs/39064268038) 当前 completed/success。初次 gh 未指定仓库误选 upstream，返回 workflow 404；指定 origin 后读取成功，不能据前一次错误判断生产链失败。
- 经已有固定 known_hosts、StrictHostKeyChecking=yes 和原位置私钥进行只读 SSH。服务器回报时间 2026-10-17 19:57:47 UTC（北京时间 10-18 03:57:47）：x86_64，内存 1962 MiB、available 1038 MiB，swap 2047 MiB 已用 816 MiB；根盘 49G、剩余 28G。只是瞬时快照，不代表长期峰值余量。
- Docker 29.1.3、Compose 2.40.3；既有 Waline/后台/媒体/Umami/PostgreSQL 容器运行，Nginx 与后台 cloudflared 服务运行。未发现 Memos 容器，`find /opt /srv -maxdepth 3 -iname '*memos*'` 无结果，`/opt/dcelysion-memos` 不存在；检查范围不证明全磁盘完全没有残留。
- `ss -ltn` 没有 5231/5232 监听；拟使用独立回环端口。后台正式容器约 36 MiB/512 MiB，Umami 约 136 MiB/384 MiB；主机已有 swap 压力，不安排并发恢复/构建压力测试。
- 既有备份目录 `/opt/dcelysion/backups`、`/opt/dcelysion-admin-stage2/backups`、`/opt/dcelysion-umami/backups` 存在；未查看私密归档内容，未证明其包含 Memos，未修改它们。
- 正式后台挂载 `/opt/dcelysion-admin-stage2/repository` → `/app/repository`，`ADMIN_CONTENT_ROOT=/app/repository`；过滤读取的环境中未出现 executor、publish branch 或 remote build URL。结合 edit-only 配置与暂停 MDX 的文档，不能将后台完整发布器视为当前可用发布路径。
- `https://blog.dcelysion.cn/__route/version.json` 返回同 HEAD、`buildProvenance=github-actions`、`publicTreeSha256=26bfcd7352b72059c00fe58c617b314889b9d2f552bc4bcd80c70d25f3425b1e`。这是主域版本元数据核实，不代替全站/双域或新增内容上线验收。另一次对未经确认的 `.com` 地址探测发生 TLS 握手失败，不作为现有正式域名故障证据。

## 2. 固定版本与契约

GitHub 官方 latest release API 本次返回 [v0.31.0](https://github.com/usememos/memos/releases/tag/v0.31.0)，非 prerelease，发布于 2026-09-19。标签对应 commit `2b2192d4e153bd04f1d325b60fd880cf00d68b01`。本次不采用 RC、stable 或 latest 浮动镜像。

Docker Hub registry 只读 manifest 结果：

- `neosmemo/memos:0.31.0` index：`sha256:24c2707ddd8fbd2ceaa7a61ecab86a53cdcde640b24ce572b73da14b00b5785f`。
- linux/amd64 子镜像：`sha256:8596928c21551afc7d4e100051510bc134fd0caae51ad1d26cf899845d719321`。
- 已固定 index + platform 于 [compose.yaml](../../deploy/memos/compose.yaml)。未拉取镜像，未比对运行二进制版本/commit；读取子镜像 config 时遇到 registry EOF，未把源码和二进制一致性写成已通过。安装时须读取实例 profile/version 再确认契约。

以下依据固定 commit 的 [memo proto](https://github.com/usememos/memos/blob/2b2192d4e153bd04f1d325b60fd880cf00d68b01/proto/api/v1/memo_service.proto)、[attachment proto](https://github.com/usememos/memos/blob/2b2192d4e153bd04f1d325b60fd880cf00d68b01/proto/api/v1/attachment_service.proto)、[user proto](https://github.com/usememos/memos/blob/2b2192d4e153bd04f1d325b60fd880cf00d68b01/proto/api/v1/user_service.proto)、[instance proto](https://github.com/usememos/memos/blob/2b2192d4e153bd04f1d325b60fd880cf00d68b01/proto/api/v1/instance_service.proto) 和服务实现；都是源码契约，尚未对实例发认证请求。

| 项目 | 本版本约定与后续处理 |
| --- | --- |
| 根路径/认证 | REST `/api/v1`，`Authorization: Bearer <PAT>`；PAT 属于用户，不假设仅有只读权限。禁止前端保存 token。 |
| 身份 | `name=memos/{uid}`、`creator=users/{user}`；以返回资源名建立映射，不能把旧适配器用户名示例直接当 ID。用户名禁改或变更时停机核对；实例另存稳定私有标识。 |
| 列表 | `GET /api/v1/memos`；`pageSize` 默认50/上限1000，`pageToken`、响应 `nextPageToken`；必须遍历到无 token，设总页数/条数/时间上限，触顶算不完整。 |
| 过滤/排序 | `state=NORMAL`；CEL `creator == "users/<实际资源>" && visibility == "PUBLIC"`，URL 编码；`orderBy=update_time asc`。增量 filter 时间字段是 `updated_ts`/`created_ts`，不是 orderBy 的字段名；精确编码与时间表达式需实例验证，第一版可先完整有界核对。 |
| 公开候选 | 客户端再次校验 creator、`NORMAL`、`PUBLIC`、无 `parent`；排除 PRIVATE/PROTECTED/SPACE/ARCHIVED。列表描述排除评论，仍以 parent/COMMENT relation 防御性核对。 |
| 内容/时间 | `content` Markdown、`createTime`、`updateTime`、`pinned`、`location`；原文保持，首次公开时间须同步器自行固定，因为 createTime 不等于首次公开时间。 |
| 详情/更新/删除 | `GET/PATCH/DELETE /api/v1/memos/{uid}`；更新用 updateMask，删除存在 force 参数。同步器只读源，不调用写入或删除接口。`State` 只有 NORMAL/ARCHIVED；不能假设存在 DELETED 枚举或可靠删除事件，showDeleted 也不等于已验证墓碑。 |
| 撤回 | 凭作者认证读单条状态，PRIVATE/ARCHIVED 可确认撤回；404须结合认证有效、分页完整与再次核对。超时/403/匿名查不到不当删除，不向公共仓库导出私密正文。 |
| 附件 | `attachments` 中 name、filename、type、size（int64 JSON 常为字符串）、externalLink、memo；`GET /api/v1/memos/{uid}/attachments` 另有分页。正文顺序优先，附件列表不视为天然展示顺序，防止重复追加。 |
| 附件二进制 | [文件服务](https://github.com/usememos/memos/blob/2b2192d4e153bd04f1d325b60fd880cf00d68b01/server/fileserver/fileserver.go) 为 `/file/attachments/{uid}` 或其带 filename 形式，不能拼旧版 `/o/r/`。下载认证/重定向/PRIVATE 拒绝要实测。externalLink 不自动带 token 或抓取。 |
| 上传 | 官方 UI 使用创建/分块上传接口，本阶段不另做上传器。[实现](https://github.com/usememos/memos/blob/2b2192d4e153bd04f1d325b60fd880cf00d68b01/server/api/v1/attachment_service.go) 会处理 EXIF/部分媒体，Memos 存储副本不保证等于用户输入字节；验收画面、朝向、色彩及下载后的附件 SHA。 |
| 评论 | `/api/v1/memos/{uid}/comments` 和 COMMENT relation 属于 Memos，不能迁入博客评论；博客继续现有 Waline 身份。 |
| 导出 | `GET /api/v1/users/{user}:exportMemos` 返回本人 ZIP，包含其归档/评论/附件；用于用户迁出核验，不能替代全实例 SQLite/配置/附件一致备份，不能直接导入博客。 |
| 访问/注册 | `instance/profile`，`instance/settings/GENERAL` 的 `generalSetting.disallowUserRegistration=true`；`instance/settings/ACCESS` 的 `accessSetting.accessMode=INSTANCE_ACCESS_MODE_PRIVATE`；须管理员初始化后读回及匿名行为验证，不能当作预置成功。 |

REST JSON 使用 lowerCamelCase；内部 proto 字段为 snake_case。后续实现依据实际 JSON 记录合成脱敏 fixture，不能依赖浏览器适配器的旧字段猜测。

## 3. 私有部署与备份方案

具体配置、启动、隧道、停写备份及隔离恢复步骤已准备在 [操作稿](../../deploy/memos/README.md)。部署独立 SQLite + LOCAL 附件，原始输入文件用户自行留存；Memos 数据不会写进博客仓库。初期只需 SSH 权限和本地浏览器，无域名依赖。

PRIVATE 实例与 PUBLIC memo 是不同控制层：PUBLIC 保留为用户明确发布标记，实例自身保持私有。关闭注册，并避免创建分享链接；分享能力可能为私有实例提供特例授权，不能用普通匿名列表拒绝替代分享/附件检查。当前没有管理员、PAT、同步账号或内部可用实例地址；拟建服务地址 `http://127.0.0.1:5231`，未来凭据仅存私有 `sync/pat`，本轮未创建秘密文件。

同机备份暂定每日、7日/4周/3月保留；尚无 timer 和异机加密副本。首次试用需要实际做一次停写备份与同版本独立恢复，恢复项目5232与原项目5231完全分离。若备份失败，服务重启结果与备份结果分开记录。不能以在线复制单个 SQLite 文件、用户导出 ZIP 或只出现登录页作为恢复成功。

## 4. 后续同步与发布依赖

- 当前 `dynamicConfig.memos.enable=false`，保持关闭；`src/content/dynamic` → Astro collection → `src/pages/api/dynamic.json.ts`，图片从 `./images/` 解析，生成 WebP 预览。这些当前源码已重读，本次未修改或构建。
- `admin/shared/identity.ts` 取显式 slug，否则 GitHub-slugged 路径；`admin/server/content.ts` 和 `DynamicFeed.svelte` 均使用 `/dynamic/{id}/` 作为评论路径。后续必须固定首次映射与文件路径；不能改名使评论身份漂移。
- 正式后台当前无 executor，依赖 MDX 的后台一键构建/发布继续暂停。`.github/workflows/public-blog.yml` 在 master push 后可信云端构建一次并发 `blog-<SHA>` 包；Cloudflare/EdgeOne 下载同提交包，不调用暂停的后台 builder。后续候选只接这个已存在的 Git 路径，第三阶段另行授权自动提交推送与部署。
- 第二阶段仍仅实现本地同步候选：私有持久映射、公开过滤、分页完整性、图片安全导入、冲突保护、撤回判据及 dry-run；不触碰历史动态、不在当前脏工作区自动提交、不恢复 MDX。生成同步器不是本阶段范围。
- GitHub 构建成功和线上版本相同只能证明现有路径部分有效，不能证明未来机器人权限、双端自动部署、撤回及新增图片已验收。

## 5. 运行验收矩阵（全部待执行）

| 用例 | 通过条件 |
| --- | --- |
| 版本/隔离 | 实例 profile 与固定版本/commit 对齐；inspect 仅回环5231、独立卷/网络、非root、资源上限有效，公网5231不可访问；现有服务正常。 |
| 初始化/注册 | 用户完成管理员初始化，注册关闭后直接注册请求被拒，默认 PRIVATE，PAT可撤销且只存服务端。 |
| 文字/多图/编辑 | 合成文字与表情原样、多图顺序正确；编辑稳定 name，PRIVATE→PUBLIC→PROTECTED/PRIVATE/ARCHIVED及删除能被作者API正确区分。 |
| 私有边界 | 无凭据请求列表、已知 PRIVATE/PUBLIC 详情与附件均不可泄露；验证分享特例并保持无分享；模拟独立匿名会话而非带登录 cookie。 |
| 分页/评论/导出 | 用 pageSize=1 跨页读完；评论不进入主动态；ZIP 下载可解包且仅本人范围。脱敏记录实际 JSON 参数/响应供第二阶段使用。 |
| 重启 | 重启后账号、正文、顺序、可见性、附件仍存在，记录前后ID与SHA。 |
| 备份/恢复 | 停写全目录归档SHA正确；独立目录/5232恢复内容和附件SHA一致，副本新增记录并重启持久化，原实例未变化。 |
| 用户体验 | 原版页面在真实浏览器完成输入、图片上传、编辑；手机访问入口若未配置，标待验收而不声称通过。 |

## 6. 下一步需要的精确授权

本地 YAML 解析、固定镜像/回环/UID 静态断言、三个任务文档的本地链接检查均通过；将 Compose 内容经 stdin 交给服务器现有 Compose 执行 `config --quiet`，未创建远程文件、未拉取或启动容器，配置校验无错误。`git diff --check` 通过（既有文件 CRLF 提示保留）；未运行全站构建，因为本次没有业务代码或动态内容变化。结束时另出现 `.like-preview.stdout.log` / `.like-preview.stderr.log`，视为并行任务产物未触碰。运行验收矩阵仍全部待执行，配置可解析不代表容器能成功运行。

准备工作已完成；继续阶段一部署需用户授权：在现有 Ubuntu 主机创建上述独立目录、拉取固定镜像、启动仅回环5231的 Memos、经隧道初始化并写入少量合成测试数据、执行一次仅停止 Memos 的一致备份与隔离5232恢复验收（恢复副本顺序运行，避免并发资源峰值）。初始化密码/最终作者账号由用户决定。用户授权部署后无需逐步重复询问。

该授权不包含正式域名/DNS/Access改动、安装其他服务、博客同步器、Git提交推送、生产博客内容或 Sites发布。需要手机常用域名时单独列出具体 Access/tunnel/DNS 操作再授权。本报告及配置尚未运行；不得把阶段一整体写成已部署验收通过。
