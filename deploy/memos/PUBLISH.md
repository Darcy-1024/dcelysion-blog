# Memos 发布适配与运维

## 2026-10-25 大图转码超时修复

真实 12 张 JPEG（合计 41,119,323 字节）在原 0.5 CPU、384 MiB、AVIF effort 6 环境中，仅前两张转码即耗时约 365 秒；同参数只读诊断在第三次附件读取时明确报 `Run deadline exceeded`，超过同步默认 300 秒。无部分内容应用或新提交。此前日志吞掉异常原因，仅显示 halt。

修复保留 quality 80 和原尺寸，使用 effort 4、Sharp 并发 1，省去静态图重复 raw 解码；后续轮次重新下载原件并校验 SHA256，仅复用字节相同且输出校验通过的 AVIF。生产私有配置将 `sync.maxRunMs` 设为 1,200,000（20 分钟）；独立同步器通用默认值仍为 5 分钟。部署观察仍最多 30 分钟，宿主总硬限改为 55 分钟、systemd 为 57 分钟；`verifySource` 会刷新读取预算，最终由宿主总时限兜底。容器增加 `--init` 回收子进程，CPU/内存/PID 上限不扩大。失败回执增加固定安全错误类别，不记录原异常、URL、正文或凭据。

恢复前须停 timer、确认 service 与双锁均无活动者，成对备份专用 checkout、私有状态及运行工具；核对 journal、HEAD 与工作区，不删除映射、不 reset。核查后移走已备份的 runtime halt，用 `run-publisher.sh --resume` 保留全部源复核/具名提交保护。完成本轮部署观察后恢复普通 service 参数与 timer。此次 Linux 隔离回归 62/62 通过，覆盖原件哈希复用、同 ID 同大小字节变更、顺序、撤回与冲突保护。已保存且哈希正确的私有原件也不重复写盘。

生产恢复回执（2026-10-25 02:11，Asia/Shanghai）：成对检查点位于服务器私有 `/var/backups/dc-memos-repair-20261024T174744Z`。首次恢复后半程临时将当前容器 CPU 提至 1 核，结束后回到常规 0.5 核，内存上限始终 384 MiB。自动内容提交 `37d5c85bb31562997fc1da9afa49426ec002fc2d` 已确认推送；四项 GitHub 工作流成功。动态 ID 为 `2026-10-25-014751-memos-acfd461193b24b26`，12 张 AVIF 合计 19,515,494 字节，原件、导出内容与文件名 SHA256 均匹配，正文、API 附件顺序、原尺寸及对照缩略图通过核对。两站版本及公开树摘要一致（`0188335fafda66c921e346beb6642554157f31884e08c842a39c2a02b93da1aa`）；逐站核对 12 张 AVIF 原图字节和 12 张 WebP 预览成功。恢复后的未变化周期仅用 6.529 秒，无新文件/提交，也未重复写入原件；普通启动参数已恢复，timer 为 enabled/active。修复源码未提交。

本次另发现 Cloudflare 未为该自动提交创建构建，故通过官方 MCP 按上述确切 SHA 补触发构建 `d5c41a61-d345-451e-af4a-7b4bf57ec4d9`，结果成功。不是此前推测的排队等待；漏触发具体原因尚无 GitHub App 投递记录证明。未修改作者身份或默认 `path_includes:["*"]`（默认匹配所有路径）。本次双站发布已补齐，但下一次正常内容提交仍需观察 Cloudflare 自动触发；此次手动补构建不能证明该外部事件链路已恢复。

2026-10-21：Linux 发布运行时、独立 clone 和 service 已安装。用户明确授权的仓库专用可写 Deploy Key 已注册（ID `167100845`，标题 `Memos controlled publisher 20261020`），私钥只存服务器。生产配置 `enabled:true`，timer 已 enabled/active；仓库配置样例仍 `enabled:false`。首次测试提交 `9c448b34bd797a157eb81f2a92ff317aa6adc696` 已观察双站版本/公开树一致，并核对正文和两张合成图片字节；公开、编辑、撤回及浏览器统一登录已通过，浏览器上传未测，退出人工验收按用户要求跳过。后续结果见 [生产验收报告](../../docs/plans/2026-10-21-memos-production-acceptance.md)。统一登录限制见 [SSO.md](SSO.md)，同步规则见 [SYNC.md](SYNC.md)。

该首次发布两站公开树摘要均为 `247f0ffbcfc927052d63c98215f91a1e172e01749b2405dd612b236530c6ca5b`；它是该提交的历史回执，不代表网站会永久停留于此版本。

## 入口与默认禁用

```sh
node scripts/memos-sync/publish.mjs --config deploy/memos/publish.example.json
node scripts/memos-sync/publish.mjs --config /etc/dcelysion-memos/publish.json --execute
node scripts/memos-sync/observe.mjs --commit <40位完整提交SHA>
```

样例 `enabled:false`，即便带 `--execute` 也不加载 PAT、不访问仓库或源服务。正式执行需要配置 `enabled:true`、CLI `--execute`，以及用户明确接受撤回的实际范围后设置 `withdrawalPolicy:eventual-current-site-operator-accepted`。该字符串不是最新部署门禁，也不代表授权已经取得。同步器内部仍保持 `publish:false`；直接运行 `index.mjs` 永远不提交/推送。

正式启用前须确定指定作者资源名、独立普通作者账号、机器人提交身份和仅目标仓库内容写权限、目标 `master`、Cloudflare/EdgeOne 站点，以及用户认可测试动态。Memos 同步 PAT、Git 凭据、统一登录作者密码是三项不同凭据，仅放服务端私有文件，不写 URL、公共仓库、浏览器或日志。机器人无需 Cloudflare、DNS、Release 管理或后台管理员权限。

## 专用 clone 与运行目录

发布执行器拒绝没有 `git config --local memos.publisher true` 标记的仓库、非目标 origin fetch/push URL、错误分支、linked worktree/symlink、进行中的 merge/rebase/cherry-pick。只接受独立 clone，不使用开发工作区或暂停的后台 builder。

以下是独立 clone 的结构示例；正式 clone 已由 [publisher-runtime.py](publisher-runtime.py) 建立，不能在现有目录重复 clone：

```sh
git clone --single-branch --branch master https://github.com/Darcy-1024/dcelysion-blog.git /srv/dcelysion-memos-publisher/checkout
git -C /srv/dcelysion-memos-publisher/checkout config --local memos.publisher true
```

正式 `/opt/dcelysion-memos-publisher-tools` 放经过审阅的脚本与 Linux 运行依赖；工具目录与可被 Git 快进的 `/srv/dcelysion-memos-publisher/checkout` 分离，不在输出 clone 安装依赖或构建。运行镜像已验证 Node、Git/SSH 及 Sharp/libvips 实际小图编码；不依赖宿主机 `/usr/bin/node`。Git 使用仅该仓库的 SSH Deploy Key，发布适配器精确核对 SSH origin。

正式状态 `/var/lib/dcelysion-memos-publisher` 为0700，PAT/配置/Git凭据为0600，由运行用户持有；配置位于该私有目录的 `config.json`。`/etc/dcelysion-memos/publish.json` 仅是旧 service 样例路径。状态绑定实例、作者、输出绝对路径与时区，不能把阶段二 fixture 映射复制到生产，也不能更换 clone 路径后继续用旧绑定。

## 一轮任务与重试

1. 双锁覆盖 Git 基线检查、完整源读取、同步、合并编辑等待、提交、推送及回执；不同状态目录也不能同时操作同一 clone。所有人工维护/备份遵守同一停写窗口。
2. 拒绝既有暂存与任务外差异。干净 clone 可 `fetch` 后 `merge --ff-only`；存在本地候选且远端前进、分歧或受管理文件被人工修改则停止。不 force、不自动 rebase、不覆盖用户工作区。
3. 同步器按阶段二规则生成当前全部候选；构建层不读取半批次输出。默认等待10秒再读最新完整列表/详情/资格；变化使本轮停止，下次从最新源生成，未提交的短时编辑可以合并。
4. 按持久映射检查相对HEAD的所有待提交变化，涵盖“前轮已同步但未提交”的文件。只允许托管 Markdown/图片的具名 `git add -- <paths>`；校验暂存路径集合、文件字节与源摘要，提交 `chore(dynamic): sync public Memos updates`。不提交私有正文、映射、原图、日志或业务代码。
5. 提交后、普通 push 前再次检查源。推送结果不明不生成第二个提交；恢复时检查远端是否等于或已包含原候选，再分开记录。远端不包含候选且已前进则停止。

Memos 请求沿用客户端有界退避重试。Git 命令有45秒超时；未创建发布 journal/commit 前观察到源变化，返回 `source-changed-retry`，下一轮重新读源，不永久 halt。已提交候选的源变化、Git/冲突或不明推送失败仍保存 halt，核对后才可 `--resume`，不能盲目重推。API 不可用不会被当成撤回。未完成的本地同步 journal 先回滚到已知状态，再取新源；不会重放旧候选。

## 回执与现有部署链

| 证据 | 含义 |
| --- | --- |
| `receipt.json` + `state.json` | 最近成功本地同步；不是 Git/构建/上线成功 |
| `publication-journal.json` | 已准备的 index tree/base/源generation，或待确认的本地提交 |
| `publication-halted.json` | 任务已停；优先于历史成功回执解读 |
| `publication-receipt.json` | 已观察远端HEAD或祖先包含该SHA；build pending，deployment unverified |
| `observe.mjs --commit` | Release附件存在、双端版本与公开树摘要；内容/评论/媒体另外验收 |

`lastPublishedVersion` 继续为null。只有具体动态内容/图片/撤回及评论身份验收后，才适合另行定义并写入该字段；不把 Git SHA 推送偷换成“动态已上线”。无变化的一轮返回 `no-git-change`，不覆盖前次成功Git回执。

现有 `.github/workflows/public-blog.yml` 在master push完整构建并发布 `blog-<SHA>`；`download-blog-release.mjs`让Cloudflare、EdgeOne下载同提交包。`deploy.yml`另有GitHub Pages部署；`build.yml`检查不是这些发布的统一前置门禁。现有完整构建仍可使用项目静态MDX链，**没有恢复暂停的后台MDX执行器**。未修改生产工作流或站点配置。

公共构建按SHA并发且不取消旧任务，平台部署也没有经本阶段验收的全局最新版本门禁。推送前源复核可以拒绝已经观察到的旧资格，**不能保证源复核之后发生的撤回立即阻止旧CI/平台部署**。撤回只在后续成功发布后使当前网站收敛，旧图片、Git/CDN历史不物理抹除。若要求严格“旧部署绝不能晚于撤回”，必须先补齐所有真实部署入口的版本门禁/串行策略并做竞态验收，当前不得宣称此条件已完成。

## 调度、停机与恢复

[service](dc-memos-publish.service) 和 [timer](dc-memos-publish.timer) 是保留的默认关闭样例；正式 unit 由 [publisher-runtime.py](publisher-runtime.py) 生成，实际配置路径和启动保护以该脚本及服务器 unit 为准。正式 timer 已启用，每轮结束60秒后检查新变化，没有 webhook。

正式一轮使用 `sudo systemctl start --no-block dc-memos-publish.service`，先执行 `production-setup.py refresh-origin` 核对固定镜像、容器身份和内部网络并刷新回环源站，再启动带 host flock 的运行容器。不要绕过前置检查直接向可能已失效的容器 IP 发送 PAT。host 锁覆盖发布及最长30分钟部署观察：Release 资产存在且 Cloudflare/EdgeOne 都观察到目标版本/公开树后才结束，下一轮不能越过尚未完成的发布。前置、运行或超时失败均停止 timer 并留下 runtime halt，需检查当前状态后恢复。

获授权后停机入口为 `systemctl disable --now dc-memos-publish.timer`，等运行中的service结束/人工停止，再确认进程、锁及journal。停同步不停止Memos、不影响现有静态站点。

恢复前保留私有一致备份，核对错误原因：

- 同步失败或提交前源变化：修复原因后运行 `publish.mjs --config <private> --execute --resume`；从最新源重新同步。
- journal已落盘但commit未完成：仅当HEAD、index tree、托管字节及路径集均吻合时，自动解除本任务具名暂存，再取最新源；保留所有工作文件。
- commit已完成且源未变化：复核后复用同一SHA；如果远端已包含该SHA，只记录确认，不重复提交/推送。
- commit已完成但未推送，源已经撤回/改变；或远端分歧/人工修改/未知暂存：**停止，普通resume不会覆盖或重放**。先备份专用clone+状态+凭据配置，人工审阅该未公开提交和映射；选择恢复成对检查点或在隔离副本重建候选。不得把私密历史候选串进随后push，不对开发工作区reset，不删映射强制重建身份。
- 异常退出残留锁：仅确认原进程死亡后使用 `--recover-lock --resume`；只允许同主机死PID，不能按锁年龄抢占。

状态备份须在停止timer并确认无运行service、无活锁的窗口，**成对备份 clone（含.git/index/未推送提交）、state/journal/原件、配置/PAT/Git凭据**，记录HEAD、远端SHA与备份SHA。统一登录凭据桥另备份其私有作者密码；它的临时会话不用于恢复。备份完整含私密数据，不进Release/公共Git。恢复到隔离路径核对后，处理状态绝对路径绑定，不直接覆盖活跃目录。实际备份/恢复演练未执行。

线上失败先停自动任务；回退应从最近成功公开版本形成经过审阅的新恢复提交并走既有链，不force回滚分支、不回滚用户无关提交、不删除Memos数据。敏感撤回失败应保持停机并单独处理当前服务版本/缓存，不能用“已关闭同步”作为撤回成功证据。
