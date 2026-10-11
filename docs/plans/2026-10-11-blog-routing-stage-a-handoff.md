# 博客双域路由阶段 A 交接

更新：2026-10-11，Asia/Shanghai。阶段 A **双端同一云端公开产物和探针已上线并通过 HTTP 验证**。主页入口及自动选路继续隐藏，不启动阶段 B/C。下方旧 DNS/演练/未部署记录为历史状态。

### 同产物发布验收

`8d447f064a2e7707dfdbe28f053c793c09ce6c70` 已推送。GitHub 自动构建 `38113583461` success，公开包 Release `blog-8d447f064a2e7707dfdbe28f053c793c09ce6c70`，压缩包 110266166 字节。Cloudflare build `5d2f7a19-432b-4dae-a108-6c4c42f5e906` 下载同包后成功部署 version `9fe93782-3f29-4fae-8e5f-3bc590a3a764`；用户确认 EdgeOne 部署成功。

真实 HTTP：两端以根域/home Origin 检查 probe/version 全部 200；probe 32768 字节、固定 SHA256、MIME、no-store/no-transform、CORS、防嗅探头均通过。两端 version 的 sourceRevision、releaseId、buildProvenance=github-actions、deploymentEligible=true 一致；公开树摘要均为 `20648529ae20f6f363e752ff16d3032889935a14a99777dbfa33959893081dc5`。证据 `cache/release-8d447f06-routes.json`。HTTP 检查不代表主页选路或浏览器媒体/Swup验收。

该提交 GitHub Pages 成功；Code quality 的两项导入顺序/七项旧脚本 var 声明错误及 Build and Check 的旧 server 产物路径检查在本对话已修正。固定项目 Biome 的 src 全目录只读检查通过，播放器语法检查通过；新提交的云端检查仍须按自身 SHA 核验。手动重复公共构建已取消，复用自动构建成功产物。腾讯后台和 Sites 均未部署，MDX 后台链仍暂停。

### 13:00 发布续办（优先于下方历史状态）

用户已授权“最近更新推送部署”，明确为解决双端同产物/探针缺口，并确认 EdgeOne 使用 GitHub 自动部署。`cead88f435cd156c58376ea011cf3d0f2e17da7a` 已推送；Cloudflare 云端完整构建及生产部署成功，version `c90e5d98-b7a0-47a0-aa9d-ab81f9f2d0b2`，探针实际 200、32KiB/hash/头通过，版本提交一致。EdgeOne 用户回报 13:00 构建磁盘/内存不足，仍不能宣称双端完成。

后续接线采用 GitHub Actions 单次完整构建，筛选后发布同提交的公开 Release 包，Cloudflare/EdgeOne 仅下载校验及部署；EdgeOne 跳过依赖安装和 MDX。Cloudflare 默认分支 trigger 已通过官方 MCP 改为下载模式、关闭构建缓存，原 Wrangler deploy 命令保留；恢复旧流程时将 build_command 改回 `pnpm run build`、build_caching_enabled 改回 true。旧生产版仍可回退。新流程实际部署及同摘要验收以发布对话和本轮 cache 证据为准，不能把此接线记录当作成功回执。后台 builder/完整后台发布链不恢复，主页入口/自动选路继续隐藏，Sites 不执行。

## 本轮范围与基线

完整读取新版双域方案、AGENTS、当前 git status/diff、最新 `2026-10-10-launch-stage1-handoff.md` 与 `2026-10-10-public-launch-resume.md`。最新用户决定跳过 MDX：停止受限 builder/宿主 MDX 与完整后台发布链重试；该项不阻止独立准备，但不存在当前可信静态产物时不切换主站。

HEAD 为 `48e0155ea115b83012faae2f6104cbc314ea3520`。开工已有后台构建修复、关闭评论、AGENTS、构建参考、reviews 等脏改动，全部保留。本轮不编辑后台构建/发布文件，不写主页仓库；未暂存、提交、推送、运行自动部署或 Sites，未开通收费/迁移 NS。

## Origin、DNS、TLS 与生产版本

| 项目 | 本轮真实结果 |
| --- | --- |
| 默认/规范博客 origin | `https://blog.dcelysion.cn` |
| EdgeOne origin | `https://blog-eo.dcelysion.cn`，用户通知已部署后，2026-10-11 12:43（中国时间）真实 HTTPS HEAD/GET 均200，证书正常校验 |
| 主页 origin | `https://dcelysion.cn`、`https://home.dcelysion.cn`，本轮未改 |
| 原 blog DNS | 官方 MCP 回读 AAAA `100::`、proxied/read_only=true；ID `f3bacacc467a31aa212f0d4d9200cf7a`，保留 |
| Worker 域绑定 | `dcelysion-blog` production、enabled=true，原绑定保留 |
| 当前 CF deployment | `7b26bb4c-5cc3-4919-8ac5-7cb75a614089`，2026-10-04T05:33:10.951Z，source=wrangler |
| 当前 CF version | `12ee6dfc-c7f3-4708-9b43-173cef0efaa1`，100% 流量，官方版本 API 回读；无源码提交注解，不能推断与当前工作树一致 |
| 当前 CF HTTPS | 2026-10-11 12:27（中国时间）首页 HEAD 返回 200，TLS 校验未关闭；probe/version 均 404 |
| 新域占用 | 开工官方 DNS 查询无 blog-eo 记录；随后 HTTPS 请求 ENOTFOUND；不是跨账号所有权证明 |
| 新域 TXT | 用户截图确认记录主机 `edgeonereclaim.blog-eo`，官方 MCP 已创建 `edgeonereclaim.blog-eo.dcelysion.cn`，值 `reclaim-n9azwiehlgvfdzu7y0grgkov52ks191j` |
| 新 TXT ID/生效 | `cd00506d299420d5aeb25ced1dc2a111`；2026-10-11T04:26:58.346Z 创建。Cloudflare 公共 DoH Status=0、TXT 值一致；Google 首次查询仍 NXDOMAIN，不当作验证失败或已全球收敛 |
| 新域 CNAME | 用户随后提供准确目标 `blog-eo.dcelysion.cn.pages.dnsoe4.com`；再次核对新域与通配均无冲突后，官方 MCP 已添加 DNS-only CNAME，ID `4b520c6a7cdc97a408927cf86ca159f7`，2026-10-11T04:32:53.862Z 创建，proxied=false/flatten_cname=false |
| 新域 TLS/解析 | CNAME 添加前目标主机 A 公共查询 NXDOMAIN；添加后的 Google CNAME 首查 Status=0但尚无Answer，随后 Cloudflare 公共 DoH 已返回准确 CNAME/TTL300。新域 HTTPS schannel 握手失败；EdgeOne 目标解析、新域启用和免费证书签发/验收仍待控制台，不关闭 TLS 校验 |
| EdgeOne 项目 | 用户最新域名管理截图确认 `dcelysion-blog` 的 blog-eo 已生效、关联生产环境、CNAME 与已添加值一致，但 HTTPS 明确未配置；平台默认域名已生效。当前区域、用量、成功 deployment ID 仍未取得 |

旧 EdgeOne `blog.dcelysion.cn` 绑定、CNAME 指示和 TXT 均未删除/复用；用户最新截图中该 EdgeOne 旧域绑定显示已停用，此为用户控制台状态，不是本代理操作，也不代表 Cloudflare 原 Worker 被停用。根域 NS、admin、邮件及原博客 DNS 未变更。控制台自动化：Edge 扩展持续 nodeRepl.fetch failed；独立 in-app 控制台落在腾讯国际登录页，无法代替用户已登录的国内控制台。登录/验证由用户操作，凭据不进聊天或源码。

免费 HTTPS 申请步骤（已推进，实际访问见下节）：在 **blog-eo 行**的 HTTPS 配置进入边缘 HTTPS 证书，选择申请免费证书、自动验证并保存；DNS-only CNAME 已配置。不改旧 blog 行、不购买证书。依据 [Makers 免费证书步骤](https://pages.edgeone.ai/zh/document/apply-for-free-certificate)。

### 12:43 后续核验（优先于上表早期申请/握手失败记录）

用户通知“已部署”后，curl 正常证书校验下新域首页 HTTPS 200，Server=edgeone makers；随后受控 GET 也200。证明新域实际 HTTPS 可访问，不代表当前候选或探针部署。强制HTTPS/HSTS/OCSP实际开关及EdgeOne证书期限、续期状态未读取。

两端页面标题均为 `DcElysion - blog`，但主CSS/JS指纹不同：CF MainGridLayout.BOO6-frP.css、page.BpqnxC_1.js；EO MainGridLayout.Cu8tSN4M.css、page.L0U7MNaK.js。这是公开产物不同的证据，不能仅凭标题或可访问认为同版本，也不能据此推断精确源码提交。样本记录 `homepage-after-tls.json`，未改或上传页面。

新域首页 HTML 定向检查未发现 canonical link；og:url 为原规范博客首页。CF 首页 canonical link 正确。源码中的本轮 canonical 修复尚未证明出现在EO生产产物，需要正式同版本发布后再检查。

`online-check-after-tls.json`：两端 probe-v1.bin/version.json 仍全部404；EO返回HTML错误页，无探针CORS，不能作为测速成功。当前仍需当前可信公开产物和双端同版本探针发布；不上传旧dist演练包。该检查没有绕过MDX边界，也不把用户通知扩大为Git或后续阶段发布授权。

## 本地实现与候选

- `scripts/blog-route-contract.mjs`：固定端点、32 KiB SHA-256 计数器样本，分别生成平台头。
- `scripts/package-public-blog.mjs`：独立新目录公开筛选/双端打包；排除媒体原件、后台、秘密、源码/映射/备份、Sites server；保留 gallery 路由 HTML、Pagefind、字体和两项公开 API JSON。拒绝链接、目录重叠、覆盖已有输出和未知文件；不改输入 dist。
- `scripts/package-public-blog.test.mjs`：覆盖探针/头、公开边界、两份字节和清单摘要、输入保留、覆盖/重叠/junction 拒绝。
- `scripts/verify-blog-route.mjs`：白名单 HTTPS GET、Origin、omit/error/no-store、有界流读取/10秒超时；检查 HTTP/MIME/CORS/hash/压缩头及独立版本。仅 HTTP 检查，不冒充浏览器验证。
- `src/utils/url-utils.ts` 与 `src/layouts/Layout.astro`：canonical 显式使用 siteConfig.site_url；archive/search 去查询，其他路径保留原查询行为，去 fragment。og:url/twitter:url 沿用同一规范值。没有 HTTP 重定向或正文替换。
- `src/config/analyticsConfig.ts`：Umami 域名数组添加 blog-eo，不额外加载统计脚本。其他统计平台端配置未实查，不声称完整统计验收。
- 使用源码相对 url/BASE_URL 的站内导航和应用资源未改；RSS/sitemap 保留原规范 site。Pagefind 本地根目录索引和相对加载逻辑已读，实际新部署索引结果/Swup 重入/旧 HTML 新资源窗口尚未验证。

演练目录：`cache/blog-routing-stage-a-20261011/`（忽略目录）。输入旧 dist 生成于 10 月 4 日，未证实当前关闭评论等配置一致；明确 `mode=rehearsal`、`deploymentEligible=false`、`sourceRevision=null`、`buildProvenance=unverified`，**不是正式发布包，不得上传**。

| 演练信息 | 值 |
| --- | --- |
| 候选 ID | `route-a-20261011-rehearsal` |
| 公开 payload | 555 文件（含 probe/version），62,349,539 字节；两端内容一致，CF 另有 `_headers` 控制文件 |
| 公开输入树 SHA256 | `8c65f013bf5d4ad31b50a0cc9ba549bdf39115b2b74beda7ddd650dede6cb191`，不含新增 probe/version，定义为排序文件清单 JSON 的 SHA256 |
| CF 候选配置 | `cloudflare/wrangler.json`，assets=./assets、404-page；不自动改变原仓库 wrangler 或发布 |
| EO 候选配置 | `edgeone/edgeone.json`，outputDirectory=./assets；需读取项目根配置的部署模式，不能只上传 assets 后假定响应头已生效 |
| 两端部署状态 | manifest 分别 not-deployed/deploymentId=null；本轮没有部署 |

文件筛选不能证明草稿没有进入 HTML/索引/feed/API。正式候选仍需与当前源码/内容对应的可信完整产物和公开内容验证；本轮没有运行完整构建，不绕过已停止的 MDX。后台 packageArtifact/jobs/腾讯 installer 仍是既有链，本轮不扩展为双目标，也不把本候选算作腾讯 release。

## 探针契约（阶段 B 可直接使用）

| 字段 | 确定值 |
| --- | --- |
| 路径 | `/__route/probe-v1.bin` |
| 完整响应字节 | `32768` |
| SHA-256 | `9ab5674dfb044ce308d393fc756a895a5808b8651dc9b5c6c506886369559d26` |
| MIME | `application/octet-stream` |
| Cache-Control | `no-store, no-transform`，两端同配置；边缘缓存/压缩一致性仍待真实部署证据 |
| CORS | `Access-Control-Allow-Origin: *`，仅 probe/version 两个公开无凭据精确端点；不设置 allow-credentials |
| Expose（probe） | `Content-Length, Content-Encoding, ETag`；缺 Content-Length 时仍按流字节上限验证 |
| MIME 防嗅探 | `X-Content-Type-Options: nosniff` |
| 独立版本 | `/__route/version.json`，JSON、no-store/no-transform、无凭据 CORS；版本差不改变固定探针摘要 |
| TAO | 未配置，计时使用 performance.now，不依赖 Resource Timing 明细 |
| 当前自动资格 | 新域TLS已通过，但两端probe未上线、公开版本未证实一致，禁用；不能因本地合同与DNS/HTTPS已确定就标记 ready |

主页客户端仍须遵守方案：两端同一轮 2500ms 截止时间、GET/omit/error/no-store、读满32KiB后结束计时、计时外hash；成功单端保留、双失败默认 CF，EO 至少快20%才自动切换；无随机query/no-cors；手动选择优先、同 origin/标签会话复用、pending刷新不循环；不等待测速才导航，不改变媒体状态。

## 公开媒体 Origin 与费用

官方 MCP 在原规则上仅追加 `https://blog-eo.dcelysion.cn`，四桶 music/wallpapers/gallery/admin-public 均 GET/HEAD、Range/原 expose/maxAge 保留，逐桶回读完全一致。私有桶、对象、URL、媒体分发清单与腾讯启用策略不改。原策略备份 `cors-before.json`，新规则回执 `cors-after.json`。

按 hostname 清除 `music.dcelysion.cn`、`wallpapers.dcelysion.cn`、`gallery.dcelysion.cn`、`admin-media.dcelysion.cn` 缓存：官方 purge API success=true，未清全 zone。

2026-10-11 12:30 带新 Origin 的定向 HTTP：音乐 FLAC 与桌面视频 MP4 GET Range 0-0 均 206、Content-Length=1、Content-Range 正确、ACAO 为新域；相册预览 HEAD 200、image/avif、Content-Length=130597、ACAO 为新域。未下载整段媒体。admin-public 新规则仅 API 回读，未取样对象；实际浏览器音乐/视频播放、图片显示均未验收。

官方 Makers 文档当前 Free：40项目、500构建/月、并发1、25MB单文件、20000文件、5GB站点总存储、200自定义域名、支持免费证书；这些是产品文档配额，**不是本账号剩余额度**。本轮未付款、订阅、绑定支付、迁移DNS或开通付费调度。实际区域/权益/用量仍待控制台读取。

参考：[Makers 配额](https://pages.edgeone.ai/document/limits-and-quotas)、[新域接入](https://pages.edgeone.ai/document/custom-domain)、[双平台头与打包](../../deploy/blog-routing/README.md)、[R2 CORS 与缓存](https://developers.cloudflare.com/r2/buckets/cors/)。

## 验证与未完成边界

- 3项 node:test 全通过；真实旧 dist 打包完成，未改源目录，不是当前站点构建验收。
- canonical 函数经已有 tsx 直接验证跨域帖子/path/query/hash、archive/search 规范 URL，通过；没有安装依赖或执行 MDX。
- 本轮四个 MJS、url-utils、analyticsConfig 的局部 Biome check 通过；Layout 仅关闭 formatter/assist 后 lint/parser检查通过，保留该文件既有 CRLF/导入顺序，最初完整check的这两类历史差异未据此扩改。
- Windows sandbox Node realpath 报 EPERM；已通过具体本地操作自动审批运行测试/演练，环境失败不算测试成功证据。
- 官方 DNS/Worker版本/R2规则与 HTTP 状态见上；`online-check.json` 记录 CF probe/version 404、EO ENOTFOUND，不写通过。
- Astra 初次咨询遇到额度限制；用户恢复额度后已收到只读建议并整合，未派代理写代码。

仍需：EdgeOne 区域/免费权益/用量/部署ID、证书续期/开关配置详情；可信当前公开产物；两端正式探针响应头/字节、版本一致、深链接/404/搜索/Swup/旧新资源兼容、浏览器 CORS/CSP 与媒体显示。新域CNAME/TXT已按用户真实值实施，12:43后已验证HTTPS首页访问；详细版本和探针仍不具备自动选路资格。源文件不是生产结果。后续“那继续”已授权在既有账户、域名、零新增费用范围完成必要双端发布；Git提交/推送仍未授权，暂停的MDX构建也未恢复。不能上传演练候选。

### 继续执行时的产物溯源与具体停止条件

官方 Workers Builds API 已确认当前 CF version `12ee6dfc-c7f3-4708-9b43-173cef0efaa1` 对应成功 build `6ff2ff10-43e1-4152-b55e-3c4a135b9fd8`，2026-10-04 05:33 UTC 完成，源码 `48e0155ea115b83012faae2f6104cbc314ea3520`，命令 `pnpm run build` 后 `npx wrangler deploy`。读取最近5项构建，最新仍为该项，未触发新构建。该版本不包含本次未提交的评论关闭、canonical、统计白名单与探针修改，不能用于宣称当前两端一致。

本地 `cache/launch-stage1-20261011-final/candidate-verified/manifest.json` 和对应 build-result 的成功记录包含 admin/dist、admin/server 等后台产物，不是完整公开博客产物。旧 dist 及演练包继续保持不可发布。GitHub Actions REST/现有 gh 的读取均遇 HTTP 403 API rate limit，未获得工作流与artifact清单，因此不声称已排除所有 GitHub 历史产物。已连接 GitHub 的 commit workflow wrapper 仅查询 PR 触发记录，不能代替该仓库 master push 工作流调查。EdgeOne 登录连接仍不可用，截图和首页响应不构成可导出的完整产物。

目前没有找到包含当前改动且有输入/输出摘要可核验的完整静态产物。只给旧包补探针或改写旧 HTML 不能满足阶段A，不以这种方式绕过暂停构建，也不翻转 deploymentEligible。此前本地验证和媒体验证继续复用，不重复验收。

可继续的最小路径是另行授权一次固定源码快照、在平台隔离环境执行的主站静态构建。其依赖仍包括 Astro 的 MDX 处理，必须明确针对这一次构建恢复授权；不恢复后台构建服务、管理员发布重试或宿主MDX执行，不自动Git提交/推送。构建成功后记录输入摘要、公开文件摘要、草稿/评论/规范URL/资源验证结果，再从同一公开产物生成双端包并记录各端前后部署ID。若有外部已生成且包含当前改动的可信完整产物，也可先核验该产物再发布，无须新构建。当前停止在缺少可信产物与暂停构建边界，阶段A未完成，不启动B。

## 交给阶段 B 的完整输入与恢复条件

只在用户另行启动阶段 B 时到 `F:\DcElysion-home` 新项目对话读取其实际 AGENTS/status；携带新版方案与本 handoff，不能从博客对话跨仓库写入。端点/大小/hash使用上表，当前 available=false，可用受控夹具实现与验证，不消耗生产测速流量。

保持已注释“进入博客”、手动控件及选路开关同一隐藏状态，生产选路默认 disabled；不新增公开入口。以后用户自行恢复入口时同时启用显示与选路开关，前提是两端已经验收同版本真实产物。媒体存储键/生命周期保持独立。实施第4节会话/手动/竞态/清理与降级规则；B handoff列出准确恢复位置，不自动启用。

回退：原 CF 绑定/生产版本未动；关闭新主页选路即可（当前本就隐藏）。若撤回本次媒体新域权限，只移除该一个 Origin 并按四域 purge，不覆盖之后他人的规则；before快照仅供比对。TXT留供诊断，不自动删除旧记录/域绑定。双端将来分别记录previous deployment，不能承诺跨平台原子切换。
