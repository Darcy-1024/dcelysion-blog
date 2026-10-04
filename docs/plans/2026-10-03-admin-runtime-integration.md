# 后台真实接入与统一上线（2026-10-03）

当前目标：按用途完成后台R2接入，再处理后续统一上线。用户已要求暂缓 MDX 构建和 Umami；不再运行构建尝试。用户已授权本任务应用部署及必要安全增量迁移；不再另询问笼统上线许可。减少验证，每个新接入仅必要短链路，复用PG/Waline/恢复证据。仅编辑配置与内容快照保留为回退参考，不当最终完成结果。

## 2026-10-04 用途调整与实际R2交付

协调对话的人类已明确授权按用途分桶，来源已读取核对。新增记录要求用途；统一私有暂存，发布进入对应用途桶，旧记录、固定旧任务和历史对象不搬迁。

| 用途 | 真实已核对目标桶 | 公开域名 | 实际验证 |
| --- | --- | --- | --- |
| article | dcelysion-admin-public | admin-media.dcelysion.cn | 新域名API绑定成功，TLS1.2、SSL/ownership active；PNG原件及预览公开HTTPS校验通过 |
| gallery | dcelysion-gallery | gallery.dcelysion.cn | 既有域名保持；PNG原件及预览进入图库桶，公开HTTPS校验通过 |
| wallpaper | dcelysion-wallpapers | wallpapers.dcelysion.cn | 既有域名保持；PNG原件及预览进入壁纸桶，公开HTTPS校验通过 |
| music | dcelysion-music | music.dcelysion.cn | 以微小PNG模拟音乐封面，原件及预览进入音乐桶，公开HTTPS校验通过；未重验音频播放/Range |

- 新域名绑定只写指定公开桶和 `admin-media.dcelysion.cn`。token不具zone/DNS读权限；相同账户历史DNS备份提供ZoneID，服务器DNS查询返回EAI_NONAME，再提交一次Attach API200。未删除DNS记录，不改变其他媒体域名。公开桶r2.dev仍disabled，私有桶r2.dev disabled且custom domains为空。
- 四用途真实任务使用独立 `dc_admin_r2_it_20261004_f2c4d720` 与新临时根，唯一对象前缀 `admin-runtime-it/purposes-20261004-7021a5fb-de51-489a-bd67-113ac961e846`；各原件/预览共8份发布对象。上传阶段仅私有ready/公开absent，明确ensure发布后public ready；hash/长度/MIME真实HTTPS验证。关闭重开并交换当前图库/壁纸配置，旧计划仍保持原bucket/base，不写替代桶。完整证据保存在私有临时根 `result.json`，没有凭据。
- 存储、API、迁移007、用途选择、文章/相册/BGM默认值、配置角色校验、分用途分发清单和腾讯子目录读取已适配。目的地固定于记录和计划；没有移动旧对象或自动公开上传的新路径。
- 新文章公开桶CORS此前未配置（GET返回10059）；仅为该桶新增GET/HEAD规则，允许博客域名、既有Workers预览及本机4321读取。PUT/readback成功；新103字节测试对象真实HTTPS HEAD200，Access-Control-Allow-Origin正确、长度/MIME匹配。此前已缓存的测试对象仍缺跨域头；未清理全站缓存或修改旧桶CORS。规则和回执见忽略目录public-cors-result.json；新上传对象已验证，已有缓存需自然刷新或单独处理。
- 定向验证：媒体存储3/3、配置与分发7/7、生产媒体配置2/2通过；后台admin:check为0错误/0警告，admin:build成功。隔离浏览器真实选择并上传相册/壁纸同一PNG，两者均私有同步成功且未公开；修复成功上传后未清空file input导致同文件换用途无法重选。媒体库导航没有实际缺陷，最初概览快照是读取延迟；截图见cache/admin-runtime-20261003/media-purpose-ui.png。临时UI进程和浏览器已关闭。
- 真实任务执行后进一步收紧腾讯子目录必须位于统一publicRoot内；缓存复现脚本已修正publicRoot为local-public。根限制有单独定向断言，不为不影响R2路由的目录校验重复整条线上验证。
- 腾讯仅写临时本地用途子目录，未配置/验证腾讯公网，仍无双源资格。后台正式部署、Git提交/推送和Sites均未执行；MDX/Umami按最新要求暂缓。

## 2026-10-04 续执行记录

- 用户批准服务器专用账号与 rootless 组件安装，取消本机安装。服务器 `dc-builder` UID1002 无 sudo/root Docker 组权限；专用 socket `/run/user/1002/docker.sock`。rootless/cgroup v2 内存、swap、CPU、PID限制检查已通过，父 slice 合计限制768MiB、额外swap512MiB、0.5CPU、512任务。原博客、评论、生产PG未停止或修改。
- 固定依赖镜像已完成，摘要 `sha256:7d80192eb45362b46bc601b7ef5243cb772ae456f8a48b8d3fa034c4de8c9210`；后台工具镜像 `sha256:ad43cf639c5625ed21cd4263e65df76da4ff685833cd2e0f13cddb5d23c58177`。Node24.20.0官方运行时下载校验通过。安装容器退出137为制作后1秒停止超时强制退出，记录 OOMKilled=false，不是依赖安装失败。
- 回环受限 builder 协议服务已启动并返回健康200。首个客户端一次读入176MiB候选，上传连接失败；改流式传输同任务后入口返回422（1秒），未观察到 Docker create/start 事件。不能称真实MDX构建/预览/发布通过；资源门拒绝是可能原因，旧日志不足以确认。未提高额度、降低资源门或再次提交。服务已停止；源码新增仅操作员可见的阶段名诊断，不输出候选正文/命令日志。
- 已按 OWNER/容器标签恢复三个测试容器 PG→Waline→admin，并重新绑定独立 Unix relay 至新 admin 网络命名空间；六个测试/生产容器均运行，生产PG健康。Unix API返回421（未带原入口Host），只证明进程可达，不冒充完整HTTPS登录复验。
- 两个新桶的初次只读 SDK 检查均404。用户澄清尚未创建，并授权代理创建。Windows浏览器控制读取窗口状态被策略停止：无法可靠识别当前URL，未执行任何UI写入。用户指定API后，实际 POST 创建 `dcelysion-admin-private` / `dcelysion-admin-public` 均200成功；此前从列表接口403推断不能创建桶不准确，以实际创建结果为准。两个桶均默认管辖区、Standard存储，管理接口确认 r2.dev disabled、custom domains为空。证据在缓存 `r2-bucket-create-result.json` / `new-r2-management.json`。
- 实际 MediaService 持久任务链已通过：独立新库 `dc_admin_r2_it_20261004_b1c4d720`、新私有根和1MiB独立预算；16×16 PNG实际生成原图/预览，R2Store上传私有桶，关闭并重开PG-backed服务后状态仍ready，两对象真实校验通过。唯一前缀 `admin-runtime-it/20261004-51127b7e-3d47-43e4-8149-ae11ef23308e`，媒体ID `a0f19f53-a349-4563-9c8d-53231b69d505`。未写公开桶；公开目录仍空。初始沙箱隧道ETIMEDOUT，正常权限SSH隧道接通后成功，未放开数据库公网端口。根目录/库/对象保留供检查，不删除。
- 公开交付和腾讯第二来源尚未通过，待明确公开域名。截图凭据按用户明确授权保存在本机受保护、Git忽略文件，未进入源码或日志。
- 续执行未做Git提交/推送、正式后台发布或Sites部署。必要输入：公开媒体域名；真实MDX入口失败仍需下一次已明确授权的诊断/尝试，不能把已安装组件当构建成功。新增构建诊断文件的只读Biome检查通过。

## 2026-10-03 当前证据和缺口

| 条件 | 当前实际情况 | 下一步 |
| --- | --- | --- |
| 构建 | 腾讯2核1962MiB，当前可用998MiB；已有root Docker/cgroup v2，缺rootlesskit/newuidmap/newgidmap等；固定Astro构建镜像尚未制作 | 用户指定服务器验证；专用rootless组件安装待具体批准，固定镜像和受限builder接入正在准备 |
| R2 | 项目明确配置里无专用媒体S3 key/Cloudflare管理token；备份探针仍仅部分验证 | 配置专用私有/公开媒体桶受限key，不复用备份凭据；一份小媒体后台持久任务验证 |
| Umami | 指定子代理在项目明确配置未找到旧key，网站ID为`db010c0d-422d-49c6-8a89-6a0aa6b79c23` | 可复用有效的Cloud API key，待受保护文件路径；不能用websiteId代替 |
| 双来源 | 当前没有新对象同版本公开交付回执；全机tc只有mq/pfifo_fast，未证明5Mbps/400GB保护 | 新对象先经R2与腾讯HTTPS交付；全局网络策略另需针对性批准，不能把应用子预算冒充全机上限 |

当前测试容器admin/Waline/PG实测约39/148/66MiB；仍运行，备份/恢复库未改。远端最终后台包SHA与上一阶段一致。builder-context.tar只在本地，本轮确认远端没有该包，不称已部署构建上下文。

## 构建资源与权限方案

不在用户电脑安装。此前`wsl --install`返回失败，管理员启动返回“操作已被用户取消”；没有取得可用WSL/Docker，本机方案已撤销。

服务器构建服务必须使用专用非root账号/daemon，后台仅持受限任务协议token，不取得root Docker socket或任意Docker控制权限。inspect/run/stop统一显式endpoint，固定镜像digest与资源参数；候选通过受控tar传输，不能靠远程daemon bind API主机路径。容器断网、只读根、无数据库/Git/R2秘密、最小输入及严格产物解包。专用组件已按批准安装；接入和真实构建尚未通过，详见续执行记录。

只为本轮一次构建，可以停止（不是pause）三个有OWNER/标签的测试容器后重新读取MemAvailable；保留卷和服务配置，结束后恢复原运行状态。原博客/Waline/PG/备份timer保持运行。不把理论释放量当实测余量。

一次低额度验证候选为768MiB内存、总memory-swap1280MiB（额外swap512MiB）、0.5CPU、192PID、10分钟上限；实测可用内存至少1152MiB才启动。运行时宿主余量低于384MiB、原服务健康失败、OOM/超时/磁盘或输出超限立即停止，只恢复本任务测试容器；失败后不增加额度重跑，不修改全局swap或drop_caches。固定依赖镜像制作也须单独受限，不能在daemon里无界build。

这只是一次安全限额尝试，并不保证2GB持续承载能力；如失败，报告实际原因，再由用户决定服务器规格/其他主机。不能因一次手工构建通过就宣称后台发布主链已接通。

## R2/统计接入边界

优先新专用媒体桶`dcelysion-admin-private` / `dcelysion-admin-public`，创建前检查同名资源归属；私有桶禁r2.dev/custom-domain/公开Worker binding，公开桶仅发布确认后写入不可变key。凭据为这两个桶的Object RW，不含备份桶或账号Admin权限。[官方权限](https://developers.cloudflare.com/r2/api/tokens/)限定桶；prefix仅应用命名，不能宣称token的前缀限制。目标域名绑定与腾讯媒体HTTPS地址先依据现有配置核对，缺明确目标才提出具体选择。

后台当前internal禁外网不直接放开。R2/Umami真实接入需只允许所需服务endpoint的受限出口；S3 SDK可能使用bucket子域名，裸account endpoint白名单不能自动算通过。持久媒体目录为进程长租约，不启动第二worker扫描既有队列；新增测试采用独立状态/额度，保留恢复满额journal。

Umami配置为服务端`ADMIN_UMAMI_API_KEY`、现有网站ID和可选region；只读一个短区间验证认证与返回口径，不创建收费账户、不改采集脚本。密钥不进入聊天、PUBLIC/VITE变量或公开备份。

## 验证与发布范围

只做新接入各一次及最后正式入口冒烟；匿名私有正文/附件和写请求必须被拒绝。正式数据库与Waline真实管理员和测试合成资源明确分开。正式增量前备份配置/库、记录旧镜像和回退；不整库覆盖、不删历史媒体、不过度重测普通视觉体验。

本轮至此Git提交/推送无；正式部署尚未执行；Sites无。当前可访问的是SSH隧道后的测试入口`https://comments.dcelysion.cn:18444`，不是正式个人后台。完整域名/入口启用时再记录实际状态，不先称已上线。
