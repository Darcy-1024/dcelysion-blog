# 独立管理后台：第九阶段本地验收

2026-10-04 当前完整 API＋客户端已在腾讯固定 Linux 依赖镜像整体打包，候选SHA `c007dae3287415fafe3575551d9de88ba536b69467d15ae3daac142f65cc2d0c`。现有隔离后台已换为完整候选并通过真实2FA、私有草稿读取/保存、自建统计及匿名拒绝；仅隔离库补007，旧容器/配置/预算保留可回退。正式配置模板见 `deploy/tencent/admin-unified.env.example`；详细包清单、证据、私有入口和切换/回退步骤见[统一上线准备记录](../docs/plans/2026-10-04-admin-launch-readiness.md#2026-10-04-完整候选包整合交付)。正式服务未切换；MDX仍暂停，候选服务器S3受限出口与腾讯双源仍待接通。

2026-10-04 最新统一状态见[上线准备记录](../docs/plans/2026-10-04-admin-launch-readiness.md)：R2四用途交付及自建Umami已真实接通，正式后台须从当前完整源码整体打包；MDX入口422仍待解决且用户要求暂缓，腾讯公网双源未启用。下文历史阶段限制按其日期理解，不作为最新缺口清单。

2026-10-04 自建 Umami 3.4.0 已部署于腾讯，公网采集TLS及现有私有后台真实统计API通过，代表页面首次访问＋Swup导航得到PV2/UV1/visits1；Cloud历史保留，正式主站采集和整体后台仍待统一上线。配置、权限、备份与回退见[自建接入记录](../docs/plans/2026-10-04-umami-selfhost.md)。此前“Umami暂缓/未验证”段落保留当时范围，以本条为最新统计状态。

2026-10-04 已按用途完成R2接入调整并通过四用途真实对象交付；MDX构建仍暂缓，Umami已由上方自建接入记录更新，腾讯公网双源仍未启用。R2进度见[真实接入记录](../docs/plans/2026-10-03-admin-runtime-integration.md)。尚未切换正式后台服务。

2026-10-02 已补充[腾讯私有联调记录](../docs/plans/2026-10-02-admin-private-integration.md)：真实独立 PostgreSQL、Waline＋2FA、浏览器编辑主链、Linux release 协议与空库恢复通过，恢复实例可认证读取。MDX 构建、后台 R2 同步、Umami 和全机出口限制仍未验证，未正式上线；下文各阶段验证按当时范围保留。

第九阶段已完成本地跨模块主链、停写备份/空目标恢复与重启演练；生产上线验收仍未完成。当前入口、证据、配置修复、部署模板及按顺序执行的上线/恢复/回退步骤集中见 [第九阶段记录](../docs/plans/2026-10-01-admin-stage9.md)。前八阶段单模块证据继续复用；不将fixture、PGlite和Windows release适配器结果当真实Waline/PostgreSQL/R2/腾讯/Docker生产联调。

本目录是独立 Svelte + TypeScript 页面和 Node API，不进入 Astro/Swup 页面。已有私有编辑、固定 revision 发布任务、候选差异、受限执行器、Git 同步、腾讯 release/回退、统一媒体库，以及 BGM、相册和有限站点设置的私有修订、Waline 评论/用户与本人账号管理。已有概览、Umami Cloud 只读访问分析与后台主机指标。本阶段新增公开媒体双来源契约、会话选路、有限回退及受控媒体服务。保存草稿只进入后台 PostgreSQL；发布须核对目标与附件公开副作用并确认。真实隔离 Astro 构建接口已实现，但本机没有 Docker/Podman，不可信内容的容器渲染未验证且默认禁用普通子进程降级。内容撤回尚未接入。

## 用途分桶配置（2026-10-04）

本轮定向测试12/12、后台类型/Svelte检查（0错误、0警告）与后台Vite构建通过；隔离浏览器实际上传相册/壁纸，真实R2四用途原件及预览HTTPS校验通过。文章公开桶已配置GET/HEAD跨域读取，新的103字节测试对象返回正确博客Origin响应头；配置前的缓存测试对象未清理。此结果不代表正式后台部署、腾讯公网双源或MDX构建已完成。

媒体库新增用途选择；文章默认 `article`，相册固定 `gallery`，BGM音频、封面、歌词固定 `music`，壁纸在媒体库选 `wallpaper`。客户端只发送 `x-media-purpose`，服务器校验用途、媒体类型和已配置目标。未配置用途禁用上传，API明确报错。上传/保存仍仅写受保护本地根及私有桶，明确发布才生成公开副本。

操作员设置 `ADMIN_MEDIA_DESTINATIONS` 为以下JSON（写入私有环境文件时压成一行）；路径应替换为实际部署统一publicRoot下的子目录。此处没有腾讯公开地址，不能据此启用双来源。

```json
{
  "article": {"bucket":"dcelysion-admin-public","prefix":"admin-v1","publicBase":"https://admin-media.dcelysion.cn/admin-v1","tencentRoot":"/srv/dcelysion-admin/media-public/article"},
  "gallery": {"bucket":"dcelysion-gallery","prefix":"admin-v1","publicBase":"https://gallery.dcelysion.cn/admin-v1","tencentRoot":"/srv/dcelysion-admin/media-public/gallery"},
  "wallpaper": {"bucket":"dcelysion-wallpapers","prefix":"admin-v1","publicBase":"https://wallpapers.dcelysion.cn/admin-v1","tencentRoot":"/srv/dcelysion-admin/media-public/wallpaper"},
  "music": {"bucket":"dcelysion-music","prefix":"admin-v1","publicBase":"https://music.dcelysion.cn/admin-v1","tencentRoot":"/srv/dcelysion-admin/media-public/music"}
}
```

统一 `ADMIN_MEDIA_PUBLIC_ROOT=/srv/dcelysion-admin/media-public`；私有根必须独立并位于仓库外。`ADMIN_R2_PRIVATE_BUCKET=dcelysion-admin-private`；`ADMIN_R2_PREFIX=admin-v1` 仅用于新受管对象，不能覆盖旧路径。旧 `ADMIN_R2_PUBLIC_BUCKET=dcelysion-admin-public` 与 `ADMIN_MEDIA_PUBLIC_BASE=https://admin-media.dcelysion.cn/admin-v1` 保留旧记录/旧任务兼容配置，不是新媒体强制目标。已有旧记录应保留原先真实全局bucket/base，不因套用本示例改变地址。发布来源白名单 `ADMIN_MEDIA_ORIGINS` 应包含四个已配置媒体HTTPS origin。

迁移 `007_media_purpose.sql` 可重复执行，不改历史JSON。新记录保存用途、版本、目的桶/prefix/公开base/腾讯副本根，预览继承用途；发布计划固定同一目的地，不受随后配置变化影响。重试不能换用途；用途或目标变更需新媒体ID及新发布任务。无用途的旧记录和已固定旧计划继续原路径，不猜类别、不搬存量。任何用途 `tencentBase` 都需 `ADMIN_MEDIA_TENCENT_VERIFIED_DELIVERY=1`；明确设置之前启动拒绝该配置。只有用途配置腾讯源时也仍需公共容量URL和实际回执。

四种用途PNG原件与预览已在真实专用PG/R2任务通过；音乐用的是封面样本，没有重复验证音频播放。服务关闭重开、当前目标配置变化后的旧任务目标保持、旧记录兼容及多域名分发均有对应必要验证。上传用途UI仅使用隔离fixture，不冒充正式后台已上线。旧阶段说明保留其当时验证范围。

## 第八阶段：公开媒体双来源与会话选路

设置修订新增 `mediaRouting` 显式schema：enabled、auto/r2/tencent模式、defaultSource、单轮timeoutMs(500–5000)、每源probeBytes(4–64KiB)、minimumAdvantage(0.1–0.5)。只通过既有settings私有revision、CAS/幂等及发布确认保存；不支持任意TypeScript、URL、脚本或服务秘密。部署地址和容量保护由服务器环境配置。保存不会公开腾讯或操控访客正在播放的内容。媒体库显示当前已知双副本对象资格数，原图/预览分别计算；没有来源成功率/访客选路比例采集，不展示虚构统计。

公开导出文件 `src/config/manifests/media-distribution.json` 只含明确发布的对象，使用稳定mediaID、original/preview、不可变key/hash/MIME/长度、默认R2与腾讯地址。第四阶段local/R2准备不足以给腾讯资格：本阶段追加R2/腾讯HTTP hash及响应头、HEAD、音视频Range/206验证和逐对象同版本deliveryReceipts。缺回执或版本不一致不导出，私有后台地址不导出。未托管旧外链与单来源URL不改写，不下载/批量迁移历史文件。导出snapshot绑定固定基准+revision+发布内容；候选白名单增加且仅增加该清单文件，构建前及推送前同时校验其SHA与Git blob/输入，回退产物保留旧快照。后台只读私有预览不授予双副本资格。

前台默认关闭双来源，R2地址保持有效。每标签第一次启动保存pending并合并一个Promise；刷新中断也视为已经消耗本轮，沿用保存来源，不自动再探。sessionStorage复用Swup、前后退和刷新；不可用在当前文档内存降级，设置面板提示刷新无法复用。不存在TTL/网络/负载自动重测。用户手动“重新选路”只改变之后新请求，已有src/srcset/audio/video/standby地址不重置。启用策略时既有显示设置入口默认可见，`PUBLIC_DISPLAY_SETTINGS=false`仍可显式关闭整个面板。

auto先请求公共容量许可，失败/未知/超时/过期拒绝腾讯新会话；成功才并行读取同一已公开小样本，实际验证200、长度、MIME、完整体及SHA，最多每源64KiB+每轮容量JSON1KiB，整轮统一timeout/AbortController。两边都可靠且腾讯耗时至少优于R2设定比例才选腾讯，其余沿用允许的默认源。跨域实际下载计时包含连接/传输/验证，受浏览器缓存及CDN影响，不依赖跨源ResourceTiming的受限字段；CORS必需，交付验证也要求TAO。固定R2不竞速、不请求无意义容量许可；固定腾讯只读取一次容量许可，不竞速，拒绝/未配置回R2。资源自身只有实际已就绪的另一来源可备用，容量未许可的新R2会话不自动把失败流量送腾讯。

加载覆盖：Markdown/动态正文Rehype惰性img、ImageWrapper/CoverImage、相册预览、动态feed/图库、完整合格srcset、Fancybox原图/预加载窗口、BGM音频/封面/歌词文件、视频壁纸active/standby。SSR/eager/原生预加载视为已开始，选路结束后不全量重写。未知/混合候选集和Astro本地转换图片保留默认；并非把原图域名替换到未验证缩略图。合格lazy构建输出data属性，实际交叉观察激活时一次解析；noscript输出可见默认图。Fancybox6.1.14关闭内置Lazyload，用等价可见/邻页插件在实际激活时解析，而不是在setup或每个幻灯片创建时锁定所有来源。

单次资源尝试最多备用一次、不改会话首选、不测速。audio/video的playing标志直到换资源/用户明确重新加载才重建，暂停/拖进度/循环不能清除；播放后故障短路旧自动跳歌/换视频逻辑，保留原URL并由现有播放按钮重试。自动备用仍在首次未播放时发生。控件文案沿用前台i18n，后台不向某访客推送播放器控制。

受控服务、容量/预算来源、保护范围及待部署步骤见 [腾讯媒体接入](../deploy/tencent/media-routing.md)。应用级媒体共享320KiB/s+R2单worker64KiB/s、月子预算250GB+80GB、最大发送并发2不是全服务器5Mbps/400GB实测保障；其他进程/协议及旧同步器不能由这套代码自动约束。默认腾讯不承接公开流量。真实R2/腾讯/生产PostgreSQL、备案/HTTPS与全出口设施未联调，前阶段不可信MDX容器限制继续保留。

本地入口：`corepack pnpm exec tsx admin/tests/routing-preview.ts` 复制可信源码（排除现有内容、MDX、秘密）到忽略的cache目录，以小PNG/WAV/MP4运行完整博客构建和两个受控来源，打印空闲可访问URL；R2 fixture与腾讯fixture都是真实HTTP，腾讯复用新增edge边界。当前访问分析隔离后台仍可沿用第七阶段fixture，账号preview/preview、二步码123456。新增策略页只私有保存，不执行真实发布。

本阶段验证：媒体/选路/配置/发布隔离测试共10项通过；`pnpm check`为277文件、0错误/警告/提示，`pnpm type-check`通过，`pnpm admin:check`为0错误/警告，后台构建及可信隔离博客完整构建通过。构建产物仅在本地生成，Sites worker准备步骤没有同步、保存版本或部署。日志保存在忽略目录`cache/stage8-evidence/`。

浏览器真实HTTP验收确认：首屏默认图片先于容量/探测请求开始；首次会话仅一轮容量与双源小样本，Swup/返回/刷新未增加探测；后续响应式图、Markdown、相册缩略图与Fancybox原图走所选来源；单图腾讯503只回退R2一次；音频与视频实际播放后注入错误事件，原URL保持且不自动切源；容量拒绝后的手动重选走R2，只改变后续加载，已有图片/AV地址不变。375×812视口无横向溢出，重选控件可见，图片进入视口才激活。后台隔离策略保存形成私有r2修订，未创建发布任务。浏览器检查修复了原生fetch接收者绑定和Panzoom早于Carousel render的加载时序，两者均由实际请求确认。

本地延迟与故障注入不代表公网性能改善；播放器错误是受控事件注入，不等同于实测公网断流。Nginx/systemd配置未在Linux运行，生产HTTPS/R2/腾讯/全服务器出口限额仍未联调。未提交、未推送、未部署。

## 第七阶段：概览与数据分析

### Cloud 配置与指标定义

访问统计保持当前 **Umami Cloud**，公开脚本/Swup 采集没有修改，不合并 GA、Clarity、51la 或 Waline 阅读量。后台和受保护预览继续不加载公开统计脚本。服务端通过固定 `https://api.umami.is/v1[/us|/eu]/websites/<websiteId>/` 的 Bearer API key 只读访问 `stats`、`pageviews`、`metrics`。Cloud `/v1` 是网关前缀，当前官方参考为 v3 平铺数值响应；不套用自建 `/auth/login` 或旧 v2 `{value,prev}`。账户实际响应不匹配时明确显示响应异常，不转换为空数据。

在后台运行服务的环境文件/进程环境配置 `ADMIN_UMAMI_API_KEY`，可选 `ADMIN_UMAMI_WEBSITE_ID`（默认读取公开 `src/config/analyticsConfig.ts` 的网站ID）、`ADMIN_UMAMI_REGION`（空/us/eu），重启服务。**不要将 key 放进公开统计配置、VITE_/PUBLIC_变量、浏览器表单或聊天**。当前没有已有后台 `.env` 或进程中的 Cloud key，未执行真实 API 调用；不生成新 token 或修改平台配置。官方配置与契约：[Cloud API key](https://docs.umami.is/docs/cloud/api-key)、[汇总](https://docs.umami.is/docs/api-reference/get-website-stats)、[趋势](https://docs.umami.is/docs/api-reference/get-website-pageviews)、[排行](https://docs.umami.is/docs/api-reference/get-website-metrics)。自建 Umami 迁移留为独立可选任务。

| 指标 | 来源与口径 |
| --- | --- |
| PV / 区间 UV / visits | `/stats.pageviews / visitors / visits`；UV 为平台在**整个区间**去重，不能累加趋势桶；visits 保留平台访问次数语义 |
| PV / 桶内 UV 趋势 | `/pageviews.pageviews / sessions`，sessions 为桶内 distinct session_id，不是 visits；缺桶保留缺失，不冒充零，空数组表示无返回事件 |
| 页面/来源排行 | `metrics type=path/referrer`，PV；精确路径匹配当前内容标题，query/大小写/尾斜杠不同不合并；未知路径保留原值 |
| 设备/浏览器/国家/地区 | `metrics type=device/browser/country/region`，独立访客维度；前10项不是全量总数，分组结果不加总冒称全期UV |
| 仓库内容 | 当前内容源非草稿和仓库草稿分别计数；缺省 draft 依项目 schema 为 false，**不等于线上 release 库存** |
| 私有修订库存 | 后台 drafts 按当前管理员/kind 的数据库 COUNT；文章/动态与配置修订分别显示，不用一页长度冒充总数 |
| 评论/待审/用户 | Waline management-v1 分页接口 total；一次身份验证+三个 pageSize=1 的读取，不遍历评论；失效/异常显示不可用 |
| 近期任务/异常 | 持久化 jobs 全量状态COUNT和最近6项（包括预览）；关联原任务详情及日志、commit/release，pushed 与 installed 分开 |

所有时间均为 `Asia/Shanghai`。今日为北京时间零点至服务端当前分钟采集快照（部分日）；近7/30天包含今日和前6/29天。自定义首日零点至末日23:59:59.999，末日为今天时截至当前分钟；最多90个日历日，拒绝非法/反向/未来日期、重复参数和未知参数。上游范围含两端。今日对比昨日零点至同一时刻；其他区间对比紧邻之前的连续**等长毫秒区间**，页面展示实际起止而不称完整上一自然周。前期0显示新增/无可比增长率，不输出 Infinity。陈旧区间不计算当前增长率。

### 安全、缓存与降级

`GET /api/analytics?range=today|7d|30d|custom[&start=YYYY-MM-DD&end=YYYY-MM-DD]`、`GET /api/overview`、`GET /api/overview/host` 均先执行现有单管理员/会话版本校验，响应 no-store；缓存不绕过鉴权。浏览器不能指定上游endpoint、站点、密钥、过滤器或粒度，小时/日粒度由范围推导。不渲染上游HTML，不把来源字符串变为外部链接。

服务端分项成功缓存60秒、同键并发合并；key 包含凭据配置摘要、固定来源/站点/地区、实际起止、时区、粒度及维度。当前区间按分钟快照，固定历史区间可直接命中。最多200个精确缓存项/80个成功降级快照，每进程最多40次上游调用/15秒，5秒超时、1MiB响应上限、**不自动重试**，错误负缓存15秒。429尊重 Retry-After（没有有效值时至少15秒）且全来源暂停新请求，手动刷新也不绕过；401/403清除旧成功数据。只有超时/429/5xx可以降级到最长10分钟的同筛选旧成功数据；陈旧卡片显示原采集时间、原因和原实际区间。相同日期范围的当前快照更新时仍可降级；不同日期/站点不会互用。成功、真实0、未配置、部分失败、陈旧和错误分别展示，一个排行失败不抹去其他分项。页面加载中清空旧图表，序号及AbortController防止旧请求覆盖新筛选，筛选保存在当前后台页面内存。此短缓存不是持久分析数据库，多进程需各自配额评估。

### 主机范围与隔离验收

运行指标明确来自**后台所在 Node 主机**（本地为Windows），不是远端腾讯Linux。Node os提供CPU核心/系统内存；process提供RSS/堆使用/进程运行时间。CPU是两次 os.cpus 累计时间差计算的全核非空闲占比，第一次/无有效间隔不可用；不让HTTP等待采样。磁盘仅statfs配置内容目录所在文件系统，平台不支持时显示不可用，不扫描其他盘、不执行shell/SSH。不提供未采集的网络速率、Nginx错误率/响应时间。主机10秒缓存与并发合并，概览可见时30秒轮询，隐藏/离开页面暂停并清理；内容库存缓存60秒，私有库存/任务/评论按概览请求读取，不自动高频轮询。

`corepack pnpm exec tsx admin/tests/analytics-preview.ts` 启动空闲且浏览器允许端口，打印实际URL；账号 **preview / preview**、二步码 **123456**。固定2026-10-01 12:34北京时间，仅显式隔离mock Cloud响应+模拟Waline+PGlite；页面持续显示模拟标识。`/fixture` 的控制表单仅此测试入口提供，可切正常/未配置/错误/部分失败，生产入口不导入它。fixture 为PV120、区间UV7、visits9；仓库文章非草稿1/草稿1，私有文章31（超过一页）、评论3/待审1/用户2，持久化任务显示推送成功而安装失败。

本阶段没有真实Cloud、Waline、生产PostgreSQL、R2或腾讯联调，不补验容器/邮件；未Git提交、推送或部署（含Sites）。实际验证记录见本节收尾记录。

2026-10-01 验证：既有20项与新增4组合并用例共 **24/24** 通过；新增用例覆盖Cloud认证/固定站点/时区、日期边界/UV非累加、零基期、精确标题映射、并发缓存与隔离、401/429/超时/分项失败/10分钟陈旧边界、授权与会话撤销、超过一页的私有库存和任务推送/安装区别、主机值域。后台类型/Svelte零错误零警告、后台构建通过。收尾缓存容量/响应体超时修复后仅定向4/4重跑；浏览器发现趋势轴标签用事件日期而非查询边界后修正，仅重跑类型/后台构建及受影响显示，未重复全套测试。

一次浏览器短流程核对概览→待审筛选→原任务日志→分析，近7/30天和自定义2026-09-28至09-30；PV120/区间UV7/visits9、热门页面90+30及原query差异均与fixture对应，上游script文本未执行。未配置与上游错误重试无虚构零值；375px概览/分析无横向溢出，分析数字与轴边界正确，浏览器未记录错误。未跑公开博客全构建、前阶段写操作、多浏览器或压力测试。最终限定文件只读Biome与diff检查通过。

## 第六阶段：评论、评论用户与本人账号

### 数据源与配置

唯一评论数据源为服务端 `ADMIN_WALINE_URL`，不会读取公网 Twikoo、接受客户端上游 URL 或直接写 Waline 表。鉴权沿用现有只读 `wl_users` 管理员/版本校验，不新增账号体系。服务端适配固定腾讯 Waline **1.41.6** + 本项目 `management-v1` overlay；原管理客户端 **0.34.2** 的安全页是 `/ui/profile`。官方固定 npm 源码与 `deploy/tencent/Dockerfile.waline-reset` 镜像摘要是契约依据，不升级 Waline。

启用需同时安装 `deploy/tencent/waline-overlay/src/` 新扩展（只读 management API、PostgreSQL 状态条件更新及用户控制器分支），执行后台增量迁移 `006_management.sql`。该迁移为后台会话增添非凭据公开 UUID，为审计添加对象 ID 和关联 UUID。既有 runtime 表权限无需扩大。另提供 `deploy/tencent/waline-overlay/003_security_version.sql`，在既有 password-reset 迁移之后执行，扩展密码/邮箱版本触发器，使角色状态及二步密钥变化也递增版本；保留原重置链接撤销触发器。本次只在隔离 PGlite 执行，**没有迁移或安装真实服务**。

管理服务未安装扩展、读取失败、401/403、超时均显示真实错误，不回退空列表或自动使用 mock。UI 展示配置数据源；显式 fixture 展示“隔离内存模拟”，隐藏未配置的真实 Waline 安全页入口。`ADMIN_WALINE_SECURITY_URL` 是独立、受信任且浏览器可访问的 `/ui/profile` 地址，仅允许HTTPS（显式本地环境可用loopback HTTP），拒绝凭据/query/hash及其他路径；公网HTTPS服务默认同源，内网HTTP上游不会生成无效浏览器链接。未配置时明确提示二步管理不可用。现有生产配置继续由服务端运维配置，不新增 endpoint/密钥表单。

登录取得的 Waline bearer 只存后台进程内有界 Map，绑定后台 session 摘要、唯一管理员 ID、auth_version 与 8 小时绝对到期时间；不写数据库、日志、浏览器/localStorage。每次管理操作先验证后台会话，再 `GET /api/token` 核对同一当前管理员及版本。没有自动刷新或提升权限。退出、撤销、失效和到期清理 bearer。当前是**单进程**方案：重启、跨实例或容量淘汰后需要重新登录，后台草稿仍保留。Waline 自身 JWT 生命周期不被改造。

### 实际能力与上游行为

| 领域 | 本阶段支持 | 限制与副作用 |
| --- | --- | --- |
| 评论列表 | 服务端分页/总数/搜索正文、精确历史文章路径、approved/waiting/spam、关联 user_id | 查询通过 Waline storage service；已知路径用现有内容身份辅助标注，未知路径仍可管理，不改变历史归属 |
| 详情/上下文 | 原始正文、父/根 ID、同一 URL 的完整线程分页、删除影响数量 | 正文/昵称/链接全部用 Svelte 文本显示，不渲染 Markdown/HTML，不下载评论外链 |
| 写评论 | 审核通过/待审、垃圾标记、仅编辑正文、以当前已验证博主身份回复、删除 | 仍用原 `/api/comment` POST/PUT/DELETE，保留 hooks、通知及用户设置；不允许修改作者、角色、路径、pid/rid 等权限字段 |
| 用户 | 昵称/邮箱搜索、详情、最小账号字段、关联评论、guest↔banned | 不开放注册/删除/管理员授予；唯一允许管理员和其他管理员均受保护，未验证用户只读；实际 PostgreSQL UPDATE 同时匹配原类型及版本，并递增版本，防止并发提升后误封禁或解禁复活旧会话 |
| 本人 | 昵称和网站资料、验证当前密码与二步码后改密、现有安全页入口 | 邮箱/角色/头像/2FA 密钥不进入表单；网站只允许 HTTP/HTTPS，空值不能清除既有网站（上游限制）。改密通过同一身份的重新认证和 `PUT /api/user`，不使用管理 token 绕过验证 |
| 后台会话 | 查看/撤销本人的实际存储会话，当前会话标记 | UUID 不具认证能力，所有撤销限定 current user_id；不展示 bearer/digest。当前撤销立即清 cookie/退出，Waline 浏览器会话由其安全页管理 |

Waline 1.41.6 删除条件是 `objectId=id OR pid=id OR rid=id`，因此删除根评论通常删除整线程；删除中间回复移除自身和直接以其为 pid 的回复，不能自称递归任意深度。确认页显示当前实际匹配数，仍可能在提交前变化。审核 waiting→approved 的回复可通知其父作者；新回复沿用 Waline `notify.run`/hooks。状态 waiting/spam 不是邮件发送开关；真实写入可能外发通知，本次未执行。

评论/资料提交前核对 SHA-256 原值指纹；上游评论/资料接口没有原子条件更新，所以仍存在检查后并发覆盖窗口，UI 如实说明。用户状态通过新增 PostgreSQL 服务方法提供条件更新。回复的 url/pid/rid/作者由服务端读取构造，不接受客户端作者信息。客户端提交期间防重复，回复关联 UUID 在进程内留24小时防重发；超时、5xx、异常响应或保存后审计失败返回 `WRITE_UNKNOWN`，保留输入，要求重新读取核对并明确建立新操作，不能盲目自动重试。此回复防重记录同样不承诺跨进程 exactly-once。

本人改密要求当前密码/2FA，通过固定邮箱重新登录并验证同一 ID、角色与版本；复用5次/15分钟限流。成功撤销当前后台 session/清 cookie，其他后台会话按既有版本校验失效；写入结果未知也撤销当前凭据。二步启停仍由受信任 Waline 安全页处理，没有另造密钥管理。日志仅含操作者、动作、对象、结果码与关联 UUID，不含评论全文、邮箱、密码或令牌。所有管理 API 保持 no-store、每请求鉴权、POST Origin/同站 cookie 保护及有限 body/查询。

### API 与本地验收

`/api/manage/info` 提供数据源；`comments|users` GET 支持 page/pageSize/search，comments 另有 path/status/userId；`comments/:id` 返回线程，`users/:id` 返回用户。POST `comments/:id/status|edit|reply|delete`、`users/:id/state`、`account/profile|password` 使用白名单 JSON；写入须带关联 requestId，评论/用户/资料还需原值 fingerprint。GET `account` 只返回安全 DTO，2FA 仅布尔值；GET `sessions` / POST `sessions/revoke` 分别查看和撤销后台会话。

`corepack pnpm exec tsx admin/tests/management-preview.ts` 在系统空闲端口启动临时 PGlite + 显式模拟 Waline 身份、评论和用户，控制台打印实际 URL。账号 **preview / preview**，二步码 **123456**。模拟读取直接复用当前 overlay 的只读实现，storage/写端点仍为 mock；没有运行真实 Waline、外发通知、连接生产数据库或补验前阶段外部服务。

2026-10-01 验证：一次完整 `admin:test` **20/20** 通过（新增2个合并适配/边界用例），`admin:check` 零错误/警告、`admin:build` 通过；新增 overlay **3/3** 测试与修改 JS 语法检查通过。PGlite 实际执行版本触发器与条件 SQL，但不等于腾讯 Waline/真实 PostgreSQL 运行时联调。浏览器完成筛选→审核→编辑→模拟回复→删除影响确认，用户详情→关联评论→封禁，以及危险 URL 保存失败保留输入、撤销当前后台会话立即退出。三个新增视图375px冒烟均无横向溢出，评论原HTML仅显示文本。收尾新增安全页配置校验与自定义slug的动态路径标注后，仅定向重跑2个管理测试、类型及后台构建；该定向组曾因系统分配Fetch禁用端口在发送HTTP前失败，增加本阶段空闲端口排除后2/2通过。局部Biome/diff检查通过。未重复前五阶段浏览器验收或运行全站Astro构建。

本阶段未提交、未推送、未部署，未执行真实评论/用户写入、真实通知、真实改密或生产会话撤销。真实 Waline、腾讯 PostgreSQL及邮件通知仍未联调。

## 第五阶段：BGM、相册与站点设置

### 清单及兼容范围

`src/config/manifests/` 的三个 JSON 文件均为 `version: 1`。清单只含公开配置数据，禁止放入可执行代码、服务身份或秘密。后台从不 import/eval 用户提交配置，也不修改任意 TypeScript。既有 TypeScript 模块继续提供原导出，语言、页面开关、播放器模式、Meting、音量和其他设置保持原实现。

| 清单 | 可编辑数据 | 排序与只读数据 |
| --- | --- | --- |
| `music.json` | `tracks[]`：曲名 name、作者 artist、音频 url、封面 cover、歌词 lrc | id 固定，数组顺序即歌单顺序；歌词沿用 LRC 字符串或文件 URL；未知字段保留只读 |
| `gallery.json` | `albums[]`：name、description、date、location、tags、cover、photos；图片 original/preview | 相册及图片 id 固定，两个数组分别决定顺序；原图 objectKey/sha256/尺寸随记录保留，受管图由服务端核对并固定；密码/提示及未知字段只读 |
| `settings.json` | title、subtitle、description、keywords（字符串数组）、navbarTitle | 仅这五项开放，分别消费于 SiteConfig 及嵌套 navbar.title；其他配置和动态表达式保留原模块 |

图片项含 id、original，以及可选 preview、width、height、objectKey、sha256。已有文件未生成预览时沿用原图，不推算远端路径。受管新图复用统一媒体库实际 WebP 预览，网格读预览，Fancybox 读原图。排序不重命名文件，移除只改变引用，不删除历史对象。相册密码仍只是展示保护。

首次迁移在可信本地源码上完成：保留原歌单 URL、歌词、作者空格、相册 ID、图片及 `urls.txt` 的原顺序、原图哈希键和已有预览映射；没有下载或重新上传历史外链。两个一次性迁移脚本记录了迁移过程，**不要对已编辑清单再次运行**。`photos` 属性存在（包括空数组）时清单是权威来源，保存或构建不会扫描并加回已移除图片；未含 `photos` 的旧相册继续按目录/cover.* 排序及 urls.txt 读取。旧扫描来源图片在后台只读，须先经可信本地导入才能编辑。

### 私有保存与发布

迁移 `005_configuration.sql` 扩展已有 drafts.kind，并新增 `base_dependencies`。配置修订仍使用 `/api/drafts`，kind 为 `music|gallery|settings`，path 必须分别为 `music.json|gallery.json|settings.json`，新建必须 `fromSource:true`。source 是经过服务端 schema 校验及规范序列化的 JSON，领域明确，不套 Markdown frontmatter。GET 列表、重开、save、copy、revision CAS 和幂等回执均复用原机制；拒绝非法 URL、角色错配、新选回收站资源及未知字段修改。每个请求沿用鉴权、Origin/CSRF 与 no-store。

服务端捕获清单基准和固定适配器文件 hash；本地来源变化会提示冲突。差异、任务创建及候选生成还会在固定远端 commit 上核对全部依赖，适配器缺失或不匹配返回 `CONFIG_ADAPTER_MISSING`。首次清单、适配器和消费者迁移必须作为同一次源码变更整体同步到目标 Git，之后才能从后台发布配置。当前尚未授权本项目 Git 提交/推送，因此真实目标不能越过此门禁。

发布写入白名单仅新增上述**三个精确 JSON 路径**，每个任务固定一个配置域、一个清单 revision 和所有媒体依赖，不允许跨域合并或任意 `src/config` 写入。首次迁移已把多文件一致性作为源码边界，日常候选只改对应一个 JSON；适配器基准阻止版本错配。保存不改公开仓库、不触发 push、不公开附件。设置当前没有媒体字段，不提供身份、数据库/R2/Git 密钥、endpoint、命令、路径、DNS 等普通表单。

媒体桥接只枚举明确的音频/封面/歌词/相册字段，按字段位置精确解析私有占位或已有受管 URL，固定任务中的 MediaPlan.source 是完整 JSON。歌曲名、描述和内联歌词不会作为媒体 URL 替换；公开清单不得含私有占位或鉴权地址。试听和私有封面经原有 `/api/library/:id/original|preview`，单段 Range 沿用第四阶段实现；歌词文本仅作为文本读取。原外链保持，后台不做代理抓取、不逐条探测整个历史歌单/相册。

当前字段引用以 `configuration_music|configuration_gallery` 和稳定记录/字段 ID 展示；原保存回执、任务引用继续事务内保留。移除当前项不会删去历史 revision/job 引用，永久清理仍禁用，不声称补齐历史 Git 索引。

### 本地验收入口与限制

`corepack pnpm exec tsx admin/tests/configuration-preview.ts` 默认在 4327 启动独立临时 Git、磁盘 PGlite、模拟身份及 mock 媒体，账号 preview / preview。`admin/tests/blog-configuration-fixture.ts` 准备可信源码、非敏感文章和代表媒体的临时博客目录；此公开适配构建不等于第三阶段不可信 MDX 容器执行器联调。真实 R2、腾讯、PostgreSQL 权限和真实服务器仍未联调；没有实际项目 Git 提交、推送、部署或 Sites 操作。

2026-10-01 本地验收：后台 `admin:check`（零错误/警告）、`admin:build`、前台 `type-check` 和本次文件的局部 Biome 检查通过。新增两项配置测试覆盖迁移等价、三个域的保存/CAS/回执、角色与来源校验、候选单 JSON 白名单及媒体历史引用；连同既有用例共 18 项取得通过结果。整组运行时，媒体上传用例曾因固定 4327 端口与预览服务冲突触发 Node 原生异常；改用系统分配端口后该用例定向通过，不将失败的整组命令标成通过。

浏览器完成三个域的编辑、保存重开和差异检查，歌曲受保护试听，相册连续选图/排序/封面/移除，以及三个编辑页的 375px 冒烟。可信博客 fixture 的 Astro、字体、Pagefind 等构建和静态 worker 准备成功；首次因 fixture 漏拷 worker 在最后一步失败，补齐后只重跑该步骤。公开页通过真实点击播放代表音频，缩略图加载 1200px 预览，Fancybox 加载 1800px 原图。后台任务执行器仍使用显式 mock 构建，这些结果不证明生产外链或不可信 MDX 容器渲染可用。

## 第四阶段：统一媒体

增量迁移 `004_media.sql` 新增媒体记录、引用表与 `jobs.media_plan`。媒体 UUID、服务端生成的 `<id>/original-<sha256>.<实际扩展名>` 与预览键固定；替换必须上传为新 ID，不能覆盖旧 URL。`media.document` 保存类型、可信 SHA-256、大小、显示原名、图片尺寸、原件/预览关系、上传状态、同步任务阶段/尝试/错误、软删除和公开交付记录。队列复用现有 Queryable/PostgreSQL、单机目录租约与 API 鉴权约定，采用独立媒体 worker，不重置发布 worker 的运行任务。

运行角色另需下列权限；本次仅执行隔离 PGlite 迁移，没有操作真实数据库：

```sql
GRANT SELECT, INSERT, UPDATE ON dc_admin.media TO dc_admin_runtime;
GRANT SELECT, INSERT, DELETE ON dc_admin.media_refs TO dc_admin_runtime;
```

草稿当前引用、保留保存回执引用、固定发布/预览任务引用通过数据库触发器与原始 INSERT/CAS 同一事务记录。触发器保守匹配 ID/不可变键，可能多记代码示例，不能据此自动清理。所有任务（含失败与成功）保留引用，因此本后台发布的当前内容和保留 release 同样被固定任务保护。历史 Git/MDX/手工外链索引不完整，物理清理始终禁用；没有永久删除 API、自动删除或延迟垃圾回收。软删除只退出可选列表，私有读取、已发布引用和回退仍有效。恢复同一 ID，不重新分配键；交付遇不同字节或元数据冲突即停止，不覆盖。双副本不是备份。

### 配置与私有/公开边界

配置见 `.env.example`。`ADMIN_MEDIA_PRIVATE_ROOT` 与 `ADMIN_MEDIA_PUBLIC_ROOT` 必须是互不包含、仓库之外的独立目录，不能与 executor workspace 重叠；仅一个执行器主机，各实例共享同一私有根。私有根的 `temporary/`、`originals/`、manifest 与锁只能由运行账号访问，不能挂入静态目录、Nginx location 或备份公开桶。公共根仅在明确发布动作时写入，**准备腾讯文件副本不意味着腾讯公网入口已经开放**；本阶段不安装 Nginx、部署服务器或实现双来源选路资格。

`ADMIN_MEDIA_PUBLIC_BASE` 是受限前缀对应的 R2 自定义 HTTPS 地址，例如 `https://media.example.invalid/admin-v1`，末尾路径须等于 `ADMIN_R2_PREFIX=admin-v1`。服务端配置 `ADMIN_R2_ENDPOINT`（官方 R2 账户 endpoint）、**两个不同的** `ADMIN_R2_PRIVATE_BUCKET`/`ADMIN_R2_PUBLIC_BUCKET`、受限前缀及仅能操作目标桶的凭据。私有桶必须没有 r2.dev、自定义域名或公开 Worker 代理；操作员核对后设置 `ADMIN_R2_PRIVATE_CONFIRMED=1`，不能用“private/”字符串假装访问隔离。代码没有能力证明账户侧访问策略，真实环境上线须核对该边界。凭据不下发浏览器，不接受客户端 bucket/key/endpoint，不提供外链抓取或任意 URL 代理。

根目录/公开地址缺失时媒体 API 返回未配置；仅缺 R2 时可上传本地原件，但同步显示 `R2_NOT_CONFIGURED`，发布阻止。生产不会自动使用 mock。真实适配器采用 [Cloudflare 官方支持的 AWS SDK v3](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)。单同步 worker；`ADMIN_MEDIA_SYNC_BYTES_PER_SECOND` 默认 524288，允许 16384–524288，每次 SDK 请求仅尝试一次，失败留在数据库待手动重试，避免无限循环。进度仅显示浏览器传输字节百分比；服务器校验、预览与同步显示真实阶段，不模拟百分比。

### 上传、预览与恢复

白名单：静态 JPEG/PNG/WebP/AVIF/GIF（20 MiB、2400万像素、1帧）；MP3/WAV/FLAC（64 MiB）；MP4（128 MiB）；UTF-8 TXT/LRC（256 KiB）。签名决定二进制类型并核对文件名；不信任浏览器 MIME。图片通过已有 Sharp 解码与生成最长边1200px WebP，保留原件；Sharp 单线程、32 MiB缓存、15秒处理超时。音频用 music-metadata 文件解析，MP4检查受限顶层/轨道容器结构；不转码、不生成波形，不承诺所有 MP4 编码在浏览器可播放。SVG、HTML、其它主动格式拒绝；文本严格 UTF-8，拒绝控制字符和 HTML 标记，只作为下载，不渲染 HTML。

原始文件流式写入、计算 SHA-256，不全量缓存音视频。单上传处理，超过并发返回忙；上传总超时10分钟，取消/长度不符清理本次临时目录。完整校验后记录 manifest、原子移动原件目录，随后写数据库就绪。重开存储核对 manifest和实际文件，可恢复“文件已完成、数据库未完成”的窗口；没有封存文件的上传中断标记失败，可选同文件重试。临时孤立目录不会公开，也不自动当作原件；操作员仅在停机、核对任务后清理。租约只在证实同主机旧 PID 已退出时接管，不按时间抢占活进程。PID/owner 不确定时停止并人工核对。

上传幂等 ID 为客户端 UUID v4，同 ID 同原名/大小/实际 SHA-256 重放；不同字节返回冲突。私有同步与上传分开，验证本地实际字节及远端 GET 的大小/MIME/流式 SHA-256，**不以 ETag 或自报 hash metadata 代替实际校验**。已有对象必须校验相同才复用，条件写入禁止覆盖；公共目录残留 `.partial` 仅在持有目录租约时按单个受控目标恢复。失配不标 ready。

### 草稿与发布

编辑器插入私有 ` /__managed-media/<uuid>/original|preview` 引用（无前置空格），保持正文其它字节与顺序；预览图片可链接原图。草稿本地原件就绪即可使用，无需等待 R2。差异检查显示正式稳定 URL 与媒体依赖；任务创建绑定检查时的媒体确认摘要，固定原稿、解析结果、对象键/大小/MIME/SHA-256及存储配置指纹，重试不能偷偷换媒体。已发布的受管公开 URL 再编辑时仍识别为固定依赖；历史非受管地址继续沿用既有校验，不自动导入或迁移。

私有预览仅复制校验原件到任务 input/public 与受保护 artifact 的 `__admin_media/`，供离线构建使用，不触发公开同步；读取仍经每请求会话与版本核对。正式任务先核对本地和私有 R2，再交付公共目录/R2新键，并对配置中的 R2 公共分发地址流式读取核对 MIME、长度和 SHA-256。副本失败阻止构建/推送；已构建任务在重试与推送前也重验依赖。`draft:true` 含受管附件时拒绝正式同步，继续使用私有预览；公开内容与附件时须明确改为 false。发布确认提示附件公开的副作用：**媒体已交付后构建或 Git 失败，公共文件可能已经公开；不会自动删除或声称仍私有**。部分交付单独显示，重试核对同一不可变版本。

公开表示沿用 Markdown/HTML 的稳定 URL，不把后台鉴权 URL、凭据或占位符提交源码。自动解析支持行内 Markdown目标、字面量 src/poster 和简单顶层 image；代码示例不改写。复杂表达式不承诺自动解析，不理解的媒体语法须先在源码改为受支持形式；既有 MDX 仍由隔离构建检验。本阶段没有改前台渲染、歌单、相册清单或 Swup。

### 媒体 API 与本地验收

所有 `/api/library` 路由沿用单管理员、每请求 auth_version核对；POST完整 Origin/CSRF、GET私有 no-store、nosniff；受控读取拒绝路径/符号链接逃逸。原件音视频支持单段 Range，文本强制 attachment；日志仅含受控阶段/错误码，无凭据、源码或签名链接。

| API | 行为 |
| --- | --- |
| `GET /api/library?type=all&trash=0&page=1` | 每页30条，类型/回收站过滤、配置与预算状态 |
| `POST /api/library/upload` | 原始 octet-stream；Content-Length、x-media-request UUID、URI编码 x-media-name；不接受路径 |
| `GET /api/library/:id` | 类型/尺寸/hash/派生关系/持久同步阶段与错误 |
| `GET /api/library/:id/original\|preview` | 受保护流式读取，非公开静态地址 |
| `GET /api/library/:id/references` | 当前草稿/保存回执/固定任务引用、永久清理禁止原因 |
| `POST /api/library/:id/retry` | 只重试本地原件完整的失败同步任务 |
| `POST /api/library/:id/trash\|restore` | 软删除/恢复，不删除任何副本 |

`corepack pnpm admin:media-fixture` 在4326启动独立临时仓库、磁盘PGlite、模拟Waline和显式文件系统mock对象存储（preview / preview），第一次同步故意失败，供重试验收。测试专用控制入口不会被生产导入。此次验证不证明真实 R2、腾讯公网、PostgreSQL运行角色、Linux多进程或Docker隔离构建联调通过。当前腾讯仅实现服务器目录副本准备；实际服务器安装和分发入口验证未执行。第5/8阶段仍待实现。

## 本地启动

Node.js ≥22.23、仓库固定的 pnpm 11.22。`corepack pnpm install` 后：

1. 在**独立测试 PostgreSQL 数据库**创建迁移角色、后台运行角色与 Waline 只读角色。不要复用生产评论库来做本地测试。
2. 将 `admin/.env.example` 中的变量注入后台进程环境，填入真实的数字 `ADMIN_OWNER_WALINE_ID`。`ADMIN_WALINE_URL` 是已有 Waline 的服务端地址；必须提供其既有 `/api/token` 接口。后台没有默认管理员或模拟登录开关。
   `ADMIN_BLOG_ORIGIN` 用于列表中的公开内容链接，默认采用当前站点配置 `https://blog.dcelysion.cn`；若博客域名变化请显式调整。
3. 用迁移角色设置 `ADMIN_MIGRATION_DATABASE_URL`，运行 `corepack pnpm admin:migrate`。随后撤去该变量，用受限账号设置 `ADMIN_DATABASE_URL`、`ADMIN_WALINE_DATABASE_URL`。
4. `corepack pnpm admin:dev` 启动本地开发；`corepack pnpm admin:build` 生成独立前端；设置 `NODE_ENV=production` 后运行 `corepack pnpm admin:start` 服务构建产物。

未填关键变量时可打开页面查看“未配置”状态，登录及内容接口返回 503。`ADMIN_ALLOW_INSECURE_LOCAL=1` 仅允许回环地址上的 HTTP 开发；生产 `ADMIN_ORIGIN` 必须为 HTTPS，cookie 将带 `__Host-` 前缀、HttpOnly、Secure、SameSite=Strict，最长 8 小时。生产由 Nginx 将同一 HTTPS 源的页面与 `/api/` 反代到本进程回环监听端口，不在公网暴露 Node 端口。不要向浏览器注入数据库、Waline、Git 或对象存储凭据。

## 数据库权限

迁移脚本按文件名依次执行 `001_base.sql` 至 `006_management.sql`，创建 `dc_admin.sessions`、`audit`、`drafts`、`draft_saves`、`jobs`、`job_logs`、`media` 与 `media_refs`；不对 Waline 表执行迁移。已有测试数据库也需补后续迁移及新增表权限（第三阶段补充权限见下文）。运行角色无 DDL 权限。Waline 只读角色仅需对既有 `wl_users` 的 `id,display_name,type,auth_version` 列有 `SELECT`；后台不读取 Waline 密码哈希与二步验证密钥。使用不同连接串将两种权限分开。以下模板只供已授权的数据库管理员在目标测试数据库执行，本次没有执行真实服务器迁移：

```sql
GRANT USAGE ON SCHEMA dc_admin TO dc_admin_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON dc_admin.sessions TO dc_admin_runtime;
GRANT INSERT ON dc_admin.audit TO dc_admin_runtime;
GRANT SELECT, INSERT, UPDATE ON dc_admin.drafts TO dc_admin_runtime;
GRANT SELECT, INSERT ON dc_admin.draft_saves TO dc_admin_runtime;
GRANT USAGE ON SEQUENCE dc_admin.audit_id_seq TO dc_admin_runtime;
GRANT SELECT (id, display_name, type, auth_version) ON wl_users TO dc_admin_waline_reader;
```

运行账号和只读账号需分别只有上述权限。会话表存随机令牌的 SHA-256 摘要；浏览器只收到不透明 cookie。每次受保护请求都从 Waline 数据库核对唯一 ID、`administrator` 类型与 `auth_version`，连接或查询失败即拒绝读取。Waline 登录按现有 `/api/token` 的邮箱/昵称、密码及可选 TOTP `code` 流程执行；返回的 Waline token 立即丢弃，不保存或传给前端。退出撤销当前会话，定时清理过期记录。密码或邮箱变化由现有 Waline 迁移触发器递增 `auth_version`；封禁和撤销管理员类型由当前类型检查生效。

## API 边界

响应为 `{ok:true,data}` 或 `{ok:false,error:{code,message?,details?}}`。已有 `GET /api/status`、`POST /api/login`、`POST /api/logout`、`GET /api/me`、`GET /api/content/posts`、`GET /api/content/dynamic` 继续生效。仓库列表支持 `search`、`status=all|published|draft`、`page` 和 `pageSize`（最多 50）。`draft:true` 是仓库显示状态，不能保密；后台私有草稿完全独立存储。

| 接口 | 请求与行为 |
| --- | --- |
| `GET /api/drafts?kind=posts\|dynamic&page=1` | 私有草稿列表，每页 30 条，不返回正文 |
| `POST /api/drafts` | 新建：`{requestId,kind,path,source?}`；`path` 是内容目录内的拟用 `.md`/文章 `.mdx` 路径，校验路径、Astro slug 及私有区同名预留 |
| `POST /api/drafts` | 仓库修订：`{requestId,kind,path,fromSource:true}`；读取受控来源，记录固定内容标识、路径、基准 commit/blob（可取得时）、原始源码及 SHA-256 |
| `POST /api/drafts` | 保留输入的副本：`{requestId,copyFrom,source}`；新 UUID，保留原基准与来源关系，明确标记 `snapshot`，允许在来源改变后继续私有保存 |
| `GET /api/drafts/:id` | 返回 `draft`、元数据校验与 `sourceState`，用于重新打开、检查当前来源 |
| `POST /api/drafts/:id/save` | `{requestId,revision,source}`；只保存私有源码，原子 revision 条件更新 |
| `GET /api/media?kind=posts\|dynamic` | 已有源码中的简单公开媒体引用；不下载、代理或同步媒体。编辑器也可复用当前正文中的相对图片引用 |

`requestId` 必须是客户端生成的 UUID v4。保存使用单条 PostgreSQL CTE 完成条件更新与幂等回执；同一个请求重试返回原保存结果，即使之后已有其它保存，也不会重放旧写入。同一 requestId 携带不同保存内容返回 `REQUEST_REUSE`。创建请求也以 requestId 幂等，不因网络重试创建多份。

旧 revision 返回 `409 REVISION_CONFLICT`；来源文件哈希改变、删除或新内容目标被占用返回 `409 SOURCE_CONFLICT`，两者分别显示。响应包含已保存草稿、基准与当前来源，界面保留本地输入，暂停自动保存，提供差异、重新读取及另存私有副本。基准不会随保存或复制自动刷新；副本仍需在未来发布前处理来源差异。来源检查在保存请求时进行，文件系统与 PostgreSQL 之间不构成跨系统事务；此阶段没有任何公开写入，未来发布仍必须重新核对。

全部私有端点沿用唯一管理员、每请求会话版本检查和完整 Origin 校验。读取限定在受控内容目录，拒绝路径穿越、跨盘或 UNC 越界及符号链接逃逸。源码最多 512 KiB（UTF-8），JSON 请求体最多 2 MiB；拒绝 NUL 和无法无损存储的孤立 Unicode surrogate。源码与凭据不进入服务端日志。API 禁止公共缓存。

## 编辑保真与操作

源码是唯一内容记录，不执行 Markdown/MDX。表单只补丁支持的顶层值，不整体序列化 frontmatter；没有修改的源码保存后保持一致。正文、BOM、换行、未知字段、注释、多行值、嵌套结构和 MDX 导入保留。复杂目标字段（多行值、带注释的 block 列表等）只支持源码；带 alias/anchor/复杂键的 frontmatter 会禁用表单。日期字段遵守实际 schema 的无引号 YAML 日期/时间形式，时间须含秒；无效 YAML、缺少字段及错误类型仍可以保存到私有区并显示诊断。

已有文件路径、内容标识、文章 URL 与动态评论标识固定。源码中更改 `slug` 会保存输入并给出与固定标识不符的诊断；第三阶段发布前会拒绝不匹配的标识。

自动保存防抖 900ms，每个编辑器仅一个在途请求，后续输入排队为最新快照；旧响应只确认对应快照。网络或不确定的服务失败保留原请求以便幂等重试，明确的输入拒绝允许修正后发送新请求。手动保存及 Ctrl/Cmd+S 可立即保存。切换编辑器清理计时器并忽略旧响应；只在确有未保存/未确认内容时保护导航或刷新。会话过期保持当前内存编辑，重新登录后重试；不默认使用 localStorage 保存敏感内容。

动态排序只交换可靠识别的独立 Markdown 图片行，保留重复引用、alt、标题及其它正文。代码、MDX、引用式图片等复杂语法保持源码模式；已有媒体插入要求光标位于正文。真实预览使用下述独立任务管线，不在编辑器中执行源码。

## 第三阶段执行器与发布

运行 `admin:migrate` 时新增 `003_jobs.sql`。运行角色另需：

```sql
GRANT SELECT, INSERT, UPDATE ON dc_admin.jobs TO dc_admin_runtime;
GRANT SELECT, INSERT ON dc_admin.job_logs TO dc_admin_runtime;
GRANT USAGE ON SEQUENCE dc_admin.job_logs_id_seq TO dc_admin_runtime;
```

`ADMIN_EXECUTOR_STATE_ROOT` 是仓库之外的私有目录，包含任务工作区、Git 对象缓存、产物和 worker 锁；不得置于 public/dist 或反代公开。此版本仅支持一个执行器主机、所有实例共享该目录。未提供目录或目标时页面明确显示未配置。`ADMIN_PUBLISH_REMOTE` 和 `ADMIN_PUBLISH_BRANCH` 只由服务端配置；请求不能提供任意远端、Git 参数、命令或目录。**填入真实写目标前须获得对应提交/推送/部署授权**；本次没有配置或调用真实目标。master 推送会触发现有 GitHub Pages 工作流，腾讯 release 安装单独记录。

`ADMIN_BUILD_IMAGE` 必须是本机已有的不可变 `sha256:<image-id>` 或 `repository@sha256:<digest>`，执行主机须有 Docker 和 Python ≥3.12。镜像缺失、Docker 不可用或 Python 不满足版本就显示不可用；不自动下载镜像、安装虚拟化或降级为宿主 MDX 子进程。可信依赖镜像由 `admin/build/Dockerfile` 制作，镜像内不应放凭据。只传入选定构建文件，避免把整个含 `.env` 的工作区发送给 daemon，例如在具备环境且已授权的构建主机使用：

```sh
tar -cf - package.json pnpm-lock.yaml pnpm-workspace.yaml admin/build/Dockerfile admin/build/entrypoint.sh | docker build -t dcelysion-admin-build -f admin/build/Dockerfile -
docker image inspect --format '{{.Id}}' dcelysion-admin-build
```

容器无网络、根文件系统只读、非 root、无 capabilities、禁止提权，限制 1 CPU / 1536 MiB / 192 PIDs / 10 分钟。唯一宿主挂载是**只读任务输入**；不挂载 `.git`、后台目录、数据库、SSH 凭据、宿主依赖或 Docker socket。临时工作区为有大小限制的 tmpfs；产物以有上限的归档 stdout 输出，再由可信 Python 解包器检查路径、类型、重复文件与大小。日志 stdout/stderr 不写入任务日志，避免内容执行时打印秘密或伪造阶段；日志只记录受控消息和错误码。后台持有 Docker/Git/SSH 操作权限，但这些权限不进入容器。本机未验证容器的实际运行边界。

构建输入从远端基准对应的**Git blob**导出，仅包含 `src/`、`public/`、`scripts/`、Sites 静态入口源码及明确构建配置（不执行 Sites 发布）；所有 `.env`、符号链接、特殊文件拒绝。私有 DB 草稿、未跟踪文件、工作区其它修改、后台配置不会导入。候选提交用独立 Git 副本、显式单文件 index 和直接父提交形成，不运行 checkout filter/hook，不使用 `git add -A`。Git 工作区不会自动 pull/reset，因此发布后原有私有修订的基准仍然固定；再次发布须核对远端来源，不能用旧基准覆盖新内容。

管线使用项目 `astro.config.mjs` 的 Astro/MDX/Remark/Rehype，并运行既有 Pio 裁剪、字体子集、内联压缩及 Pagefind。离线复用 Git 中的卡片/LQIP等资产，省略外部数据生成和 Sites 产物入口生成。需要新媒体或新的网络生成缓存时，先走受控资产维护，不能暗中把本机未提交缓存带入发布。`ADMIN_BUILD_COMMENT_PROVIDER` 与 `ADMIN_BUILD_WALINE_SERVER_URL` 仅传入两项公开评论配置；腾讯构建应显式设置 Waline 公网 HTTPS 地址，不传后台内部 Waline URL。其它私有环境变量不传入。

快照先严格检查 YAML、当前内容 schema 的字段类型、固定标识和来源；构建时再次由真实 Astro schema 检查。媒体检查覆盖可识别的 Markdown/HTML 图片、封面与媒体 src/poster：相对引用须在任务导出树中存在，远端须为 `ADMIN_MEDIA_ORIGINS` 白名单的 HTTPS 来源并通过无重定向 HEAD 与媒体类型检查。动态表达式及复杂 MDX 引用最终由隔离构建解析；没有任意 URL 代理。`draft:true` 在发布候选中原样保留，只有预览任务副本把本篇 draft 改为 false，不修改正式候选或默认公开教学/示例文章。

### API、恢复和 release

所有新增接口继续每请求验证管理员会话与 Waline auth_version，POST 校验完整 Origin；响应 no-store。`GET /api/publishing` 返回明确目标及构建模式；`POST /api/publishing/diff` 接受 `{draftId,revision,targetId}`，返回基准、目标及前后源码；`POST /api/jobs` 接受 `{requestId,draftId,revision,targetId,kind,base,confirm}`，其中 kind 为 preview/publish，发布 confirm 须匹配检查过的目标 fingerprint。`GET /api/jobs` / `GET /api/jobs/:id` 查看队列和日志，`POST /api/jobs/:id/retry` 仅重试失败任务未完成的阶段。快照通过 revision 条件 INSERT 固定，后续编辑不改变任务；相同 requestId 只能重放相同请求。

任务和日志存 PostgreSQL；worker 在进程存活期间持有共享私有目录锁，任务领取和状态写入使用 attempt CAS。重启只能在证实同主机前进程已死后接管锁，再清理对应旧容器；不按超时抢占活锁。锁 owner 文件缺失、PID/主机不确定或另一个 worker 存活时拒绝接管，需操作员核对。中断的候选/产物目录保留为 `.interrupted-*`，不当作成功产物复用。恢复先核对远端 SHA：等于 candidate 确认已推送，等于 base 可正常重试，其它值停止；不强推。安装前保存 previous/release，恢复核对摘要与 current，已切换的 release 不重复安装。远端已推送、安装失败显示部分完成，不自动撤销 Git。

`GET /api/releases?targetId=...` 只列出可校验 release；`POST /api/releases/rollback` 接受 `{targetId,releaseId,expected,confirm}`，再次核对 current 并切换整站产物，不修改 Git。发布和回退共享 worker 锁，安装端也互斥。腾讯入口为新增 `deploy/tencent/admin-release.py`，**部署到服务器需另行授权**；由操作员安装为 root 拥有的 `/usr/local/libexec/dcelysion-admin-release`，同目录放既有 `verify-static-release.py`，配置固定命令的受限 sudo 和仅能写 `/srv/dcelysion/admin-incoming` 的上传账号。本次没有执行这些服务器设置。

Linux 入口沿用 `site.tar.gz`、UTC `YYYYMMDD-摘要前12位`、完整 `.release-sha256`、`releases/`、`current` symlink 和既有 `.install-staging.lock`。保留包到 `admin-packages`，回退前核对包摘要、包内文件摘要、实际 release 全树与现有静态产物校验；拒绝越界、链接和错误 current 基准。写入 fsync 的 previous/target 收据后，用 `os.replace` 原子切换 symlink，再记录完成。只负责已配置静态站的版本切换，不重装 Nginx/DNS/服务。旧 installer 的 release 没有保留包时，不宣称可回退；需要操作员提供原始包并校验后纳入。

本地 `LocalReleases` 是隔离验收适配器：同样校验发布包、完整文件清单、摘要与 current 基准；Windows 因 junction 不支持原子替换，用 `current` **原子文本指针**记录版本，不能等同于 Linux/Nginx symlink 安装验收。Linux 腾讯接口的服务端安装、fsync/锁和实际站点响应尚未联调。

### 受保护预览与本地验收

`GET /api/previews/:jobId/<path>` 每个 HTML、样式、图片和字体请求均验证身份及任务归属；禁止公共缓存和索引，拒绝穿越/符号链接。实际 Astro HTML 的根资产路径映射到任务前缀，页面以响应 CSP `sandbox` 与无授权的 iframe sandbox 隔离，禁用 script/connect/form/object/base；仅放行任务内样式和图片，外部媒体及统计请求阻止。直接打开 HTML 同样受 CSP sandbox 限制。此模式是**静态排版预览**，不验证 Swup、评论、模块脚本或其它交互；opaque origin 下的自定义字体可能回退。完整交互预览以后需要独立 origin 和专用授权，不能给后台 API 放开 null-origin credential CORS。

运行 `corepack pnpm admin:publishing-fixture`，访问 [第三阶段隔离后台](http://127.0.0.1:4325/)，账号 `preview / preview`。生产入口不导入 fixture。该入口使用模拟 Waline、磁盘 PGlite、真实业务 API、临时内容 Git 仓库、本地 bare remote、临时 release 目录和**明确标识的 fixture 构建**；不声称使用了真实 Astro。默认预先创建一个隔离基准 release，方便一次浏览器流程完成发布后回退；每次启动新建临时环境，任务数据库在该临时环境内持久化。

2026-09-30 必要验证：已有 11 项 + 新增 3 项核心集成共 14 项通过；后台类型/Svelte、后台构建、限定文件只读 Biome、diff 检查及两份 Python 入口语法检查通过。核心断言覆盖固定快照、目标单文件提交、排除工作区/其它私有草稿/.env、重复创建幂等、来源/远端冲突、构建失败无 push/current、push 后安装失败恢复、数据库重新打开、外部效果收据中断恢复和回退不改 Git。

浏览器一次主流程验证了已有私有草稿、目标/差异、受保护 fixture HTML/资产、隔离发布任务、分阶段结果/日志、回退确认及取消不切换 current；新增面板在 375px 窄屏无横向溢出。内置浏览器的原生 confirm 曾阻塞自动化，已改为页面内对话框并验证回退确认。fixture 页面中的脚本被 sandbox/CSP 禁止；该结果不能等同于真实 Astro 渲染或完整前台交互。本机无 Docker/Podman，因此一次真实隔离 Astro 构建和容器秘密/权限实测未执行；真实 Waline/生产 PostgreSQL、真实 GitHub 或腾讯环境也未联调。本阶段没有执行实际仓库 Git 提交/推送、腾讯私有或正式部署、Sites 同步/部署；临时仓库的提交、本地 bare 推送与本地 release 切换仅用于已授权验收。

## 隔离本地验收

`corepack pnpm admin:check` 包含后台 TypeScript 和 Svelte 检查；`corepack pnpm admin:test` 使用临时目录及 PGlite，`corepack pnpm admin:build` 只构建后台前端。局部只读检查使用 `corepack pnpm exec biome check admin package.json`。

可运行 `corepack pnpm admin:fixture` 打开 [隔离编辑后台](http://127.0.0.1:4324/)，测试账号 `preview / preview`。这是专用测试入口：模拟 Waline 身份、真实业务 API 和本机嵌入式 PostgreSQL（PGlite），页面持续显示隔离标识；生产入口 `admin:start` / `admin:dev` 没有模拟登录开关，也不导入此入口。测试正文和数据库位于系统临时目录 `dc-admin-stage2-*`，不在仓库或公共构建输入中。重启时可把打印的目录设为 `ADMIN_FIXTURE_DIRECTORY`；`ADMIN_FIXTURE_PORT` 可选择空闲端口。复用目录只能是系统临时目录中的上述前缀目录。测试控制端点只存在于 fixture，限制回环监听、模拟管理员和同源 POST，不调用真实通知或外部服务。

2026-09-30 验证：后台类型/Svelte 检查、11 项隔离测试、后台构建、局部 Biome 检查、博客 TypeScript 与 Astro 检查通过。测试覆盖无改动 round-trip、中文/表情/空白/CRLF/BOM、未知字段与 MDX、非法 YAML、动态图片排序、重启磁盘持久化、revision CAS 与旧请求幂等重放、来源修改/删除、路径/slug 碰撞、目录及跨盘边界、未授权、会话撤销、Origin 和输入限制。

隔离浏览器验收覆盖桌面 1280px 与手机 375px 的新建、编辑、保存、重新打开、图片插入/排序、失败重试、两类冲突和会话过期后的输入保留及重新登录；未出现横向溢出或浏览器错误。控件通过真实 DOM 事件调用业务 API；快捷保存处理器与未保存时的 beforeunload 绑定也已检查，但未据此宣称所有原生鼠标/键盘手势或浏览器刷新弹窗均已验收。PGlite 的并行请求测试验证 SQL 行为，不等同于真实 PostgreSQL 多连接争用或运行角色权限验收。真实 Waline 登录/二步验证、真实服务器 PostgreSQL 迁移及联调尚未执行。

写请求校验完整 `Origin`，登录按 IP 与账号各限 15 分钟 5 次。API 和静态页面禁止公共缓存与索引。生产部署还需按站点入口配置 TLS、访问控制和 Nginx 反代；本阶段没有执行 Git 提交/推送、真实数据库迁移或任何部署。
