# Memos 阶段三：受控发布与后台统一登录准备

当前进展见 [2026-10-21 生产验收记录](2026-10-21-memos-production-acceptance.md)。下文保留本地准备阶段的历史状态，不能当作当前生产配置。

实施：2026-10-19—20（Asia/Shanghai）。结论：**授权内的本地实现与定向验证完成，生产默认禁用；阶段三正式发布验收尚未完成。** 没有安装/启动真实Memos、创建真实作者或凭据、写生产配置、推送GitHub、改DNS或部署博客。

## 本次实现

| 范围 | 入口与结果 |
| --- | --- |
| 受控发布 | `scripts/memos-sync/publish.mjs`：独立clone绑定、Git基线检查/只快进、映射拥有的具名暂存、Conventional Commit、源资格提交前/推送前复核、短时编辑等待、普通push、分离回执、失败停机和恢复。 |
| 同步串行 | `index.mjs`增加锁内prepare/complete/failed生命周期；外层Git操作处于现有双锁内，独立同步入口仍强制publish:false。 |
| 恢复 | 提交前journal恢复仅解除经验证的本任务暂存并重读新源；提交后重试复用同SHA；网络回执丢失按远端HEAD/祖先确认；远端分歧/人工变化/已撤回旧本地提交停止。 |
| 线上观察 | `observe.mjs --commit <SHA>`单独报告Release附件、两端版本/公开树摘要，不将内容、图片或评论验收标为通过，不写lastPublishedVersion。 |
| 运维准备 | `deploy/memos/PUBLISH.md`、publish.example.json、未安装service/timer：默认关闭，私有状态备份、停机、恢复与回退操作边界。 |
| 后台界面 | `MemosEmbed.svelte`、memos-words：现有后台导航下“动态 · Memos”独立页面，未配置/未启用/故障提示、桌面手机视口、新窗口备用、离开/重载保存确认。未重做Memos编辑器。 |
| 统一登录 | `admin/server/memos-bridge.ts`：用户已选择的独立普通作者凭据桥，30秒单用POST票据、服务端官方SignIn/refresh/SignOut、固定作者/USER校验、Connect unary刷新、逐请求后台会话裁决、拒绝浏览器令牌/原始refresh绕过、全部HTML/API/附件/分享访问门禁。 |
| 服务集成 | config/api/index新增可选私有配置、原认证之后的入口API、默认不启动的网关listener、CSP精确来源、私有Cookie。复用原Waline登录与2FA配置，不修改原身份策略。 |
| 私网准备 | compose.bridge.yaml及精确私网别名支持：适配当前后台容器与宿主机回环不互通的实际结构，仅准备新内部网络，不连接现有容器、不让Memos加入旧数据库网。 |

用户追加需求已以最新选择为准：**后台内嵌原版Memos + 沿用现有后台账号登录 + 新窗口备用**。中途的“独立二次登录”方案已经被替代，不是最终验收方案；没有以固定PAT注入、浏览器脚本伪登录、共享密码哈希或管理员映射代替统一登录。作者密码、同步PAT、Git机器人凭据分别保管。原版前端会将当前会话短期accessToken写入localStorage；网关撤权保证依赖每次请求验证，不依赖浏览器删除该token。

具体协议证据、安全边界和运行条件见 [统一登录说明](../../deploy/memos/SSO.md)，发布/备份/回退入口见 [PUBLISH.md](../../deploy/memos/PUBLISH.md)。

## 实际验证

- 同步器原有 **46项** + 线上观察工具 **2项**：48/48通过，日志 `cache/memos-stage3-sync-tests.log`，约12.2秒。同步器未写实际src/content/dynamic。
- 独立临时Git裸仓库发布测试 **14/14通过**，日志 `cache/memos-stage3-publish-tests.log`，约85.6秒。覆盖发布/无变化、稳定编辑/撤回身份、任务外及暂存差异、编辑合并/源变化、提交前及提交后崩溃、旧撤回禁止重放、网络确认丢失、远端已包含候选后继续前进、快进/分歧及全周期锁。没有向GitHub推送fixture。
- 凭据桥/配置/后台入口测试 **15/15通过**，日志 `cache/memos-stage3-auth-tests.log`。覆盖匿名HTML/静态/REST/Connect/附件/分享拒绝、一次性票据与精确Origin、错误作者/管理员拒绝、旧凭据剥离、Cookie/CSP、后台撤销/验证服务故障、真实字段编号protobuf、refresh合并、角色复核、并发请求不能绕过尚未完成的身份复核、本地登录/PAT管理阻断、大小/重定向边界、重启后旧桥会话拒绝，以及API层既有登录/Origin保护。
- 审查发现的并发刷新窗口已修复：新token先存局部对象，作者/USER核验成功后才更新共享会话；全部业务请求等待进行中的refresh，失败即使桥会话失效。新增延迟身份核验返回ADMIN的并发附件测试通过。
- `tsc --noEmit --project admin/tsconfig.json`通过；`svelte-check --tsconfig ./admin/tsconfig.json`为0错误/0警告；Vite后台生产构建通过，日志 `cache/memos-stage3-admin-build.log`。限定新增/改动脚本、后台TS与JSON的Biome检查通过；没有全仓格式化。
- Memos基础Compose与新内部网络配置合成后的YAML，经过本地结构断言及服务器现有 `docker compose -f - config --quiet` 静态检查通过。仅stdin传入公开配置，没有写远程文件、拉镜像、启动容器或创建网络。实际双文件部署/路由/隔离仍需安装时核对。
- 本阶段没有重跑全博客构建：公开Astro/Svelte动态实现及实际动态内容未改；复用阶段二 `cache/memos-stage2-U4xt0F` 已通过的完整构建流程证据，不把它改称pnpm build通过。本次新增后台界面已单独构建。

全部合成测试共 **77项**（46+2+14+15）。这些不是原版Memos运行或浏览器验收：认证fixture是在本地HTTP上手工提供逻辑HTTPS Host/Origin/Cookie，未证明Secure/Strict Cookie、CSP导航POST、Access登录跳转、手机键盘或真实上传行为。

### 只读发布链和服务器事实

2026-10-19核对HEAD `32b90a451ad7b384d050c67e0b7136b1b208b54c`：GitHub公共构建 [39134168869](https://github.com/Darcy-1024/dcelysion-blog/actions/runs/39134168869) completed/success；Cloudflare `Workers Builds: dcelysion-blog` check成功。同提交“Admin Check, Test and Build”check为failure，其他公共构建成功不能掩盖该历史check失败；本次本地后台类型/界面构建通过，但没有重跑或修复该既有云端任务。

只读observe返回两个站点的sourceRevision均为上述SHA、publicTreeSha256均为 `61e133a8bea6d92470be32bcbdbbd967dfafc4748fc6858a487b0b98435b4c9d`，Release附件存在。此证据属于**已有发布链**，不是本次Memos代码/fixture部署成功。

2026-10-20 10:46 UTC（18:46北京时间）经固定known_hosts与原位置密钥只读SSH：未发现运行中的Memos容器，5231/5232/4324无监听；主机可用内存约956MiB、swap已用844MiB，仅瞬时快照。现有 `dc-admin-formal` 在 `dcelysion_database`、172.18.0.7，Node24.20.0；宿主机PATH没有node。未读取/打印私钥内容、环境秘密或数据库凭据。service中的宿主机Node路径是待适配模板，不能原样启用或假定安装完成。

## 尚未完成的验收与限制

1. 真实v0.31安装、固定实际镜像摘要/账号/PAT、PRIVATE/注册/分享策略读回、匿名及真实403/404/分页/附件认证、备份及隔离恢复、重启持久化仍未执行。
2. 凭据桥真实原版UI/Connect协议、HTTPS/反代全部路由、精确frame-ancestors/XFO、Cookie/POST Origin/登录重定向、后台退出/撤销/2FA失效、原生短期JWT/分享token直达绕过拒绝仍待真实验收；生产2FA配置没有在本任务被确认或改变。
3. 手机上传、多图顺序、照片朝向/色彩/透明/动画、原始下载字节与上传前差异、Sharp/网关/Memos并发内存峰值仍待验收。384MiB不是已经证明足够的容量。
4. 发布前源复核可以拒绝已经观察到的旧任务，**不能保证复核后撤回立即停止所有旧CI/平台部署**。现有公共构建按SHA并发，生产端最新版本门禁与串行策略未经本阶段验收。严格防止旧部署覆盖撤回仍是正式启用条件，或需用户明确认可后续发布收敛的撤回范围，不能自动替用户接受。
5. 当前冲突整批停止，已提交但未推送且源变化的旧候选需人工审阅/隔离恢复，不自动rebase/reset或重放。图片不物理删除，Git/旧构建/CDN历史不能承诺安全抹除。
6. 新窗口与iframe都走同一网关，后台撤权阻断后续网络请求；不能收回已在另一窗口显示/下载的内容。没有通过销毁iframe冒充服务端撤销。

## 下一步精确授权与输入

本任务只在本地保留结果。继续真实试用需明确授权：在原Ubuntu主机创建阶段一独立Memos目录/卷、拉固定镜像、启动回环5231、初始化管理员与普通作者、写用户认可测试记录、只停止Memos的一致备份与隔离5232恢复，测量资源并修复本次接入问题。管理员密码/作者账号由用户确定，凭据只在服务端填写。

真实后台桥接还需要明确授权：审阅后创建 `dc-memos-private` 内部网络并仅连接后台与Memos、给后台容器只读挂载私有作者配置、更新本次后台代码/配置和受限gateway listener、配置明确Memos HTTPS来源的反代/tunnel/Access全路径保护。DNS/公开域名等写入应逐项列清后按本任务授权执行，不复用别的任务权限；当前没有实施这些动作。

正式自动发布另需指定作者creator、机器人Git权限/提交身份、目标master及双站点、用户认可测试动态和部署竞态处理策略的授权，随后才能启用publish配置/timer、实际GitHub提交推送和现有部署链的测试发布。Git推送、CI构建、两端上线、内容/图片及评论验收分别记录。OpenAI Sites不涉及。

授权前已完成具体可审阅代码、默认关闭配置与恢复说明，不需要再次讨论是否采用凭据桥；用户已明确选择。没有自行创建下一阶段对话。任务外日志与此前所有未跟踪内容均保留，没有git add -A/reset/清理或全仓格式化。
