# 恢复上线第四阶段交接

日期：2026-10-12（Asia/Shanghai）。当前结论：已获授权并完成提交、推送、双域静态发布及腾讯正式启用。下方准备阶段记录保留为历史，不代表当前仍关闭。后台用户身份验收及浏览器验证限制分别列出，不标为全部验收完成。

## 正式上线回执（优先于下方准备记录）

- Git：`86156d7634b465eef1b5fb7324d2d4b708aec4c2` 已提交并推送 master，包括已检查的其他对话相关改动；既有 `.review-build.log` 未提交。
- GitHub 四条相关工作流成功；可信公开构建 run `38245227102`。Release `blog-86156d7634b465eef1b5fb7324d2d4b708aec4c2`，归档 SHA256 `85c566b0c2950dceeb91d80ea714d1914485bf02a83095a16ca8a984b7baa363`。归档安全路径、revision、554 文件及双平台同树校验通过。
- 两域实际 HTTPS version 均为上述 revision，公开树 SHA256 `e4621957647ae2bc12c6d3932629d50bc0f1a2f2368d1fc49b7ec30c619ada5b`；首页、文章、about、相册、Pagefind 及抽查 JS/CSS 正常。Cloudflare build `6be2ba1b-a95b-4814-84d5-5a17e4ec5c17` 成功，deployment `074f4a00-458c-4560-b86f-590ad14b52d5`，100% version `7ec68a28-c48c-4091-ac57-f65943176a63`。EdgeOne 公网产物匹配，具体平台 deployment ID 未读取。
- 2026-10-12 20:07:33 北京时间启用腾讯：`MEDIA_EDGE_ENABLED=1`、`MEDIA_EDGE_ADVERTISE_CAPACITY=1`，实际 capacity `allowed:true`。启用前核对双域产物、bundle、索引、有效 host permit；两张真实图片再次 GET/SHA/大小一致。
- 前台 `enabled:true`，auto 模式；默认 R2，腾讯需有效容量许可和至少 20% 测速优势。已开始加载的图片保留原来源，不因测速结束强制换源。仅两张登记图片参与选路，历史音视频继续使用 R2。
- 21:17:41 北京时间保护状态：相关四服务 active、host fault=null，主机保守观测 1292124890 字节，媒体 reservation 766977 字节（后续请求会增加）；账本完整保留。后台 root 内部 200，me/analytics/library 401，错误 Host 421，无宿主端口暴露；5Mbps TBF 生效。
- 开启前闭容量浏览器验收双域通过：真实相册 R2 图片 1200×575 可解码、实际 Swup 保持同 document、返回复用同会话且不重复容量请求。开启后的浏览器情况见追加记录；测试仅在隔离浏览器延迟探针或拒绝目标图片，未改变生产用户网络。
- 本次未补博客备案号；主页入口、评论维持隐藏。Sites 未执行；后台 MDX/在线预览/一键发布继续跳过，GitHub 独立静态构建发布已执行。

证据位于 ignored `cache/launch-stage4-20261012/`：`stage4-activation.json`、`stage4-health-after.json`、`public-site.json`、`browser-closed.json` 等，不含秘密。正式启用备份为服务器 `operator/stage4-before-activation-20261012`；关闭两 flag 并仅重启媒体服务可阻止新腾讯选择。回退禁止恢复过时预算/host 账本快照。

### 开启后的浏览器限制

隔离 Chrome 曾取得真实容量 allowed:true、会话 preferred:tencent；但首屏目标图片在测速完成前已从 R2 启动，继续显示 R2 符合来源锁定。后续先测速再进入相册的故障注入记录中，真实腾讯图片失败后只发出一次原 R2 图片请求，无循环；该 R2 请求在等待窗口内未完成，故不能标为最终图片显示通过。其后两次定向检查均因刻意延迟的 R2 探针超过 2500ms 总截止而安全选择 R2，腾讯探针实际 200；另有一次 about 导航网络超时。未由这些失败推断生产回退功能失败，也未以 HTTP 哈希代替显示验收。

因此开启后的双域腾讯图片显示、最终故障回退显示仍待浏览器验收；音乐封面实际显示与完整音视频播放未验收。既有闭容量双域 Swup/图片/会话结果及真实两图双源交付结果有效。浏览器隔离检查屏蔽了外部统计脚本和批量音视频下载，不能证明统计采集或播放成功。停止继续扩大自动化重试，服务器保持已授权正式开启及所有保护。

上线完成后的本节、候选回执及对应配置说明是本地交接更新，未再推送 master 触发重复全量构建；已发布源码与双域保持上述具名 revision。自动审批拒绝将完整交接作为公开 GitHub Release 附件上传，原因是新增运维记录包含服务器用量、后台身份及状态，现有授权未明确覆盖公开这些信息。未绕过拒绝，记录仅保留本地；原公开归档未覆盖。

## 以下为启用前历史准备记录

## 用户授权后的发布续办

用户已明确同意将当前已检查的相关改动提交、推送，并沿用GitHub静态流程发布双域及启用腾讯选路。源码策略已改为enabled=true、probeBytes65536，配合两图清单进入新构建；服务器交付/广告仍关闭，等待新包匹配核验。下方“未获Git授权/源码disabled”是授权前检查记录，不是继续停工要求。后台MDX链、主页入口、评论与Sites保持原边界。

## 当前范围与状态

- `blog.dcelysion.cn` 保留Cloudflare Worker/原代理AAAA；`blog-eo.dcelysion.cn` 保留独立EdgeOne DNS-only CNAME。腾讯只用于 `media-tx.dcelysion.cn`，无腾讯主站切换。
- 用户补充允许检查并一起更新其他对话改动；已保留全部dirty/未跟踪文件，未reset、全目录format或暂存。用户随后明确不要补博客备案号，已精确撤回新增，FooterConfig无差异。
- 评论与主页博客入口保持隐藏，未写主页仓库。未购买资源，未执行Sites。
- 后台MDX builder、在线预览和一键构建发布仍跳过，未运行Astro/MDX构建、fixture发布或宿主执行。服务器只独立打包可信媒体服务。
- Git未提交/推送；未触发Cloudflare/EdgeOne新主站部署。现有静态JS/HTML在构建期导入策略、清单和惰性图片标记，仅开腾讯服务不能改变现有前台。

## 双域当前实测

2026-10-12 19:41北京时间，两域实际HTTPS version相同：

- revision/release：`6813c8eb75fd230ceaf509cbd34302ac5b8678a7` / `blog-6813c8eb75fd230ceaf509cbd34302ac5b8678a7`。
- 公开树SHA256：`60b32f4fd9c821951606ad9ba016b1e92947eac1f84470fd4d332c199726db32`，provenance=github-actions，deploymentEligible=true。
- 官方CF deployment `ab8c4b72-0e0f-4b49-9d91-38213fce4a53`，100% version `d3303886-b788-4d48-ae71-3dae191990fc`。previous version `c389217a-545f-47bd-9045-41fd02b71aec`仅记录，未切换。
- 两域首页、`/posts/welcome/`、about、wallpaper-2026相册均200、canonical指向规范blog域、评论/留言入口隐藏；每页Umami脚本恰一份。抽查同路径JS/CSS字节摘要相同，Pagefind脚本200。实际搜索交互与统计收集成功未由这些HTTP检查证明。
- 两域目前均未显示ICP文字；用户明确不要本次补充，保持原页脚。主页公开文字实查为粤ICP备2026151958号，主页未修改。
- EdgeOne具体deployment ID/控制台证书续期状态未读取；HTTPS正常校验可访问，不能把公开version当平台控制台回执。

证据：`cache/launch-stage4-20261012/public-site.json`。当前公开包不包含本次媒体清单，不能复用为新媒体上线包。没有修改dist/.astro或伪造deploymentEligible。

## 媒体正式配置与真实回执

19:36:37部署关闭状态正式profile至现有隔离 `dc-media-edge-stage3`，未重启后台/Waline/PG/Umami。全进程512KiB/s（约4.19Mbps，为全机5Mbps留余量）、并发4、250GB应用响应体月预算；不是新增用户硬要求，而是低流量偏好下的工程配置。增加服务端参数边界至512KiB/s/4，保持单进程聚合调度。月预算仍保留现有250GB上限，无需修改后台R2上传预算。

服务器清单只含 `live-music-cover` 和 `live-gallery-preview`；三项合成样本文件保留但从正式索引移除，实际请求404。无私有目录挂载、无宿主端口映射。前台清单不含localKey，服务器私有索引保留相对localKey以匹配实际用途目录，R2原URL不变。

新bundle SHA256：`868656f85ebe23db8d51aea1ebec2a06b41b92bde5f2a34398654bd12a0fe804`。
新服务器索引SHA256：`fef9b4da9c30b136261a819709fdfc55911a8c28a524cd8482085960308328a4`。

19:38短时启用GET，始终不广告容量。两张真实图片分别在blog与blog-eo Origin下R2/腾讯GET200，完整SHA256、大小、MIME及CORS全部一致（共8回执）。两图对象与第三阶段未变，复用既有HEAD/immutable证据；没有重新扩展全量历史媒体矩阵。验证后finally恢复两个flag=0，capacity allowed:false、已登记对象503。私有/API/移除合成路径404。

保留旧reservation125929字节；本次真实腾讯交付新增211018字节，最终336947字节，没有清空或退款。ledger按UTC自然月统计，主机permit按供应商周期，周期不同。

19:42:26收尾：四相关服务active，permit fault=null、主机保守观测1279251936字节、停止线350GB、到期2026-10-23 20:06:07北京时间；TBF5Mbps，backlog0、累计drops15、overlimits392。这些是主机观测，不能称为腾讯精确计费或400GB供应商硬保护。重启、计数回退、坏账本或周期到期继续锁闭，禁止删账本解锁。独立证书至2027-01-09 22:25:33北京时间；续期dry-run复用第三阶段成功证据。

官方MCP核对四公开R2桶CORS均包含两个博客Origin，无需额外修改。EdgeOne Origin下真实既有FLAC/桌面MP4 Range0-0均206、长度1、Content-Range正确，仍只走R2；不证明完整播放或来源锁定已浏览器验收。

证据：`cache/launch-stage4-20261012/stage4-install.json`、`stage4-delivery.json`、`stage4-health.json`、`audio-range.headers`、`video-range.headers`；服务器对应 `/opt/dcelysion-media-stage3/operator/stage4-*.json`。cache为ignored，接续须保留，不含秘密。

## 源码与其他对话改动

本阶段新增/修改：`admin/server/media-edge.ts`（在既有第三阶段修改上只增加参数边界）、`admin/tests/routing.test.ts`、`deploy/tencent/media-stage4.env.example`、`src/config/manifests/media-distribution.json`、`settings.json`的probeBytes65536（enabled仍false）、本交接及第四阶段candidate、对应媒体/总方案记录。

[候选](2026-10-10-launch-stage4-media-candidate.json)含当前输入摘要、两真实回执、正式profile及enabled=true的activationPolicy。源码保持disabled；发布前才应用activationPolicy，记录其最终输入摘要，与清单整体验证。

其他对话现有改动已检查：auth/config的可选TOTP和owner校验、私有保存可用而MDX预览/发布暂停的界面提示、admin-unified示例、可信后台candidate脚本的依赖元数据校验、第二/三阶段部署/host permit文件及handoff。它们不是本阶段重新实现；服务器当前ADMIN_REQUIRE_TOTP=0，保留用户选择，不恢复强制TOTP、不提升guest。头像更新已在当前6813c8eb公开revision；无重复部署。

认证两项定向测试通过，candidate脚本node --check通过；旧后台部署/运行证据复用，不重新完整构建。`.review-build.log`仅为既有本地日志，没有纳入正式交付文件或发布包，不因日志出现Sites文字声称本次部署Sites。

## 检查与限制

- 路由/预算/permit及新增边界测试8/8通过；本次四TS/JSON文件固定Biome只读检查通过；认证定向测试2/2通过；差异检查通过。
- 首次本地路由503与foundation内容读取EPERM来自Windows沙箱文件realpath权限；正常权限的相关定向测试通过。foundation全文件首次2/4，后续仅验证受影响认证两项，未把未重跑内容读取项写成通过；没有执行MDX编译。
- Corepack首次沙箱路径ENOENT，正常权限固定pnpm检查通过；一次MXC进程启动失败后正常权限完成只读HTTP检查。
- in-app浏览器创建/读取连续两次各约30秒超时，未取得可用浏览器状态，已停止重试。两图实际显示、Swup重入/清理、同会话复用、故障仅一次回R2和播放来源锁定仍待匹配包部署后的真实浏览器验收，不以HTTP或fixture代替。

## 后台与用户待验收

官方Access应用 `3b5a6961-e7a2-478b-b56c-bcf8e84d9628`仍仅两白名单邮箱/邮箱OTP，未增加bypass或身份权限。匿名公网 `/api/me`302至Access；内部root200，me/analytics/library401，wrong Host421，后台无宿主端口映射；正式账号登录由用户操作，不索取密码/OTP、不伪造session。

第二阶段仍待用户：重新打开已保存草稿核对正文；正式owner统计页面读取；另一白名单及非白名单实际Access测试。此前已证明owner登录、私有草稿DB原文及私有R2回读；本次没有用“已完成”补齐这些待验收项。QQ仍绑定guest id2，不移动或提升。

## 备份、回退及启用门槛

受保护备份目录：`/opt/dcelysion-media-stage3/operator/stage4-before-20261012`（0700，文件0600），含旧env、bundle、索引、unit及账本/permit/host状态快照，只有一个媒体进程写budget；没有数据库或私有媒体改动。主站未切换，不存在本阶段腾讯site current/previous变更；CF当前/previous版本和双域公开release记录如上，EdgeOne具体previous控制台记录待后续发布时取得。

关闭媒体：保持edge.env两个flag=0并重启 `dc-media-edge-stage3.service`，核对capacity allowedfalse/对象503。当前已关闭。

恢复旧媒体实现：停止该媒体unit，只从上述备份复制edge.env、media-edge.cjs、distribution.json分别回operator/runtime/public原路径，确保env两个flag=0、bundle/索引0644、env0600，再启动并核对拒绝；不要恢复旧budget/host-usage/permit快照，不删除账本，不重启正式后台。备份旧env为1MiB验收profile，只能用于关闭状态回退，不能承接正式流量。

下一步需要：本次Git提交/推送许可，以及包含候选清单、enabled=true、probeBytes65536的可信完整静态产物。按现有GitHub单次构建公开包给两域部署流程推进，后台MDX链仍保持跳过；如用户不授权构建且无外部匹配产物，就保持当前安全关闭。不得改写旧dist/注入JS绕过边界。部署前记录最终输入摘要及双端回退版本，必要时取得EdgeOne控制台操作；匹配包发布并验证后才开启正式容量广告。浏览器错误只在隔离/本地制造，不对正式用户强制断网。

最终分别状态：Git未提交/推送；CF/EO本阶段未新发布（既有双域包可访问一致）；腾讯新正式profile已部署、GET/广告最终关闭；DNS/TLS正常且未修改；后台保护仍有效；Sites未执行；MDX仍跳过。阶段四当前是准备及真实交付验收完成、前台上线与用户验收待完成。
