# Memos 发布适配与运维（阶段三准备）

2026-10-19：本地实现，**没有安装、启用生产任务或推送 GitHub**。统一登录实现与限制见 [SSO.md](SSO.md)，同步规则仍见 [SYNC.md](SYNC.md)。

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

下面是**获授权后**的准备入口，不是执行记录：

```sh
git clone --single-branch --branch master https://github.com/Darcy-1024/dcelysion-blog.git /srv/dcelysion-memos-publisher/checkout
git -C /srv/dcelysion-memos-publisher/checkout config --local memos.publisher true
```

`/opt/dcelysion-memos-tools` 放经过审阅的脚本与已有运行依赖；工具目录与可被 Git 快进的输出 clone 分离，不在输出 clone 安装依赖或构建。固定版本运行 Node >=22.23；当前服务器已有容器 Node 并不证明 `/usr/bin/node` 可用。示例 service 的 Node 路径、用户/目录权限、Git HTTPS 凭据方式需安装时核实，不自动安装宿主机运行时。

状态 `/var/lib/dcelysion-memos-publisher` 为0700，PAT/配置/Git凭据为0600；配置 `/etc/dcelysion-memos/publish.json` 为私有文件。状态绑定实例、作者、输出绝对路径与时区，不能把阶段二fixture映射复制到生产，也不能更换 clone 路径后继续用旧绑定。

## 一轮任务与重试

1. 双锁覆盖 Git 基线检查、完整源读取、同步、合并编辑等待、提交、推送及回执；不同状态目录也不能同时操作同一 clone。所有人工维护/备份遵守同一停写窗口。
2. 拒绝既有暂存与任务外差异。干净 clone 可 `fetch` 后 `merge --ff-only`；存在本地候选且远端前进、分歧或受管理文件被人工修改则停止。不 force、不自动 rebase、不覆盖用户工作区。
3. 同步器按阶段二规则生成当前全部候选；构建层不读取半批次输出。默认等待10秒再读最新完整列表/详情/资格；变化使本轮停止，下次从最新源生成，未提交的短时编辑可以合并。
4. 按持久映射检查相对HEAD的所有待提交变化，涵盖“前轮已同步但未提交”的文件。只允许托管 Markdown/图片的具名 `git add -- <paths>`；校验暂存路径集合、文件字节与源摘要，提交 `chore(dynamic): sync public Memos updates`。不提交私有正文、映射、原图、日志或业务代码。
5. 提交后、普通 push 前再次检查源。推送结果不明不生成第二个提交；恢复时检查远端是否等于或已包含原候选，再分开记录。远端不包含候选且已前进则停止。

Memos 请求沿用客户端有界退避重试。Git 命令有45秒超时；Git/冲突/源变化/上传失败不盲目重推，保存 halt 标记，需要核对后 `--resume`。API不可用不会被当成撤回。未完成的本地同步 journal 先回滚到已知状态，再取新源；不会重放旧候选。

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

[service](dc-memos-publish.service) 和 [timer](dc-memos-publish.timer) 只是未安装样例：每轮结束60秒后再触发，不积压并发；还要求 `/etc/dcelysion-memos/publish.enabled` 文件存在。halt文件存在则跳过。没有安装timer/webhook/机器人，没有创建 enable 文件。

获授权后停机入口为 `systemctl disable --now dc-memos-publish.timer`，等运行中的service结束/人工停止，再确认进程、锁及journal。停同步不停止Memos、不影响现有静态站点。

恢复前保留私有一致备份，核对错误原因：

- 同步失败或提交前源变化：修复原因后运行 `publish.mjs --config <private> --execute --resume`；从最新源重新同步。
- journal已落盘但commit未完成：仅当HEAD、index tree、托管字节及路径集均吻合时，自动解除本任务具名暂存，再取最新源；保留所有工作文件。
- commit已完成且源未变化：复核后复用同一SHA；如果远端已包含该SHA，只记录确认，不重复提交/推送。
- commit已完成但未推送，源已经撤回/改变；或远端分歧/人工修改/未知暂存：**停止，普通resume不会覆盖或重放**。先备份专用clone+状态+凭据配置，人工审阅该未公开提交和映射；选择恢复成对检查点或在隔离副本重建候选。不得把私密历史候选串进随后push，不对开发工作区reset，不删映射强制重建身份。
- 异常退出残留锁：仅确认原进程死亡后使用 `--recover-lock --resume`；只允许同主机死PID，不能按锁年龄抢占。

状态备份须在停止timer并确认无运行service、无活锁的窗口，**成对备份 clone（含.git/index/未推送提交）、state/journal/原件、配置/PAT/Git凭据**，记录HEAD、远端SHA与备份SHA。统一登录凭据桥另备份其私有作者密码；它的临时会话不用于恢复。备份完整含私密数据，不进Release/公共Git。恢复到隔离路径核对后，处理状态绝对路径绑定，不直接覆盖活跃目录。实际备份/恢复演练未执行。

线上失败先停自动任务；回退应从最近成功公开版本形成经过审阅的新恢复提交并走既有链，不force回滚分支、不回滚用户无关提交、不删除Memos数据。敏感撤回失败应保持停机并单独处理当前服务版本/缓存，不能用“已关闭同步”作为撤回成功证据。
