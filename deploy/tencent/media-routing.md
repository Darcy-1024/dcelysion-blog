# 腾讯受控媒体接入

## 2026-10-12 全部自有公开媒体流程

新增阶段在现有隔离公开目录内准备完整副本，不读取后台媒体目录/数据库。公开同步器显式枚举四个公开用途桶，原件流式校验后放入 `verified/<SHA256>/<文件名>`；原 R2 URL 不改，既有两图腾讯路径也保留。已公开站内图追加内容寻址的 article R2 副本及 revision 绑定别名，不将草稿或私有上传作为触发点。

部署脚本为 `public-r2-plan.py`、`sync-public-media.py`、`sync-published-site-media.py`、`register-public-media.py` 和协调器 `refresh-public-media.py`。安装到受保护 `operator/public-sync` 时，将前两份分别命名为 `public_r2_plan.py`、`sync_public_media.py`，供其余脚本导入。一次性已有文件导入工具为 `prepare-public-build-media.py` 和 `import-cached-public-media.py`，不是私有发布入口。

`dc-public-media-sync.service/.timer` 用单个排他锁串行推进：每小时读取公开对象清单，复用未变化且本地SHA仍正确的副本；公开站 revision 变化才读取可信 `__route/public-media.json` 和公开引用。完整校验后原子替换 `.distribution.json`，通过 HEAD、首尾 Range 和有界代表 GET 后再 PUT 脱敏 R2 JSON。清单不含 localKey、运维状态或凭据；失败恢复旧索引、不恢复预算账本。快照未变不重复下载代表大文件。

前台首次部署一次后，使用固定 `https://admin-media.dcelysion.cn/media-routing/distribution-v1.json` 更新资格，不需要为每个新增公开对象再提交Git。客户端限1MiB/5000对象，失败回构建快照/R2，不接受远端策略或探针端点；每次页面启动读取一次，Swup复用，已有加载/播放不换源。本地 aliases 必须匹配当前可信公开 revision，srcset 全组齐备才切换。

初始只读盘点为152个真实公开R2对象（743848570字节）及276个已公开本地媒体（49589672字节），另有12个测试对象和47个本地第三方例外。复制和登记、前台发布分别验收；后文第四阶段两图状态仅为历史基线。R2缺副本或校验失败的对象不获得双源资格，不能把索引或CORS核对称为浏览器播放完成。保留全进程512KiB/s、并发4、250GB预算，以及原全机5Mbps和原主机账本。

## 2026-10-12 第四阶段实际参数

独立 `media-tx.dcelysion.cn` 仅服务媒体，不接管两个博客域。正式环境示例为 `media-stage4.env.example`：聚合512KiB/s（约4.19Mbps）、并发4、250GB/UTC自然月响应体reservation。全机eth0仍5Mbps，主机350GB门禁采用供应商周期和保守RX+TX账本，两种预算不能相加称作供应商硬额度。保留已有journal，不删除归零。

服务器已装入仅两张真实图片的索引和匹配bundle，最终GET/广告均关闭；前台清单准备但策略仍disabled。短时真实双源回执、旧配置保护备份和具体启用门槛见 [第四阶段交接](../../docs/plans/2026-10-10-launch-stage4-handoff.md)。以下旧320KiB/s/并发2及第三阶段1MiB参数属于历史设计/验收，不承接正式流量。

## 2026-10-12 恢复上线第三阶段现状

独立 `media-tx.dcelysion.cn` DNS/HTTPS、隔离媒体容器和全机 `eth0` 5Mbps 出口保护已部署。五个小范围对象的真实 R2/腾讯 HTTPS 双源交付已验证；最终 `MEDIA_EDGE_ENABLED=0`、`MEDIA_EDGE_ADVERTISE_CAPACITY=0`，前台自动路由仍关闭。当前使用 64KiB/s、并发1、1MiB 的验收配置，不代表正式接流量参数。

当前安装以 [第三阶段交接](../../docs/plans/2026-10-10-launch-stage3-handoff.md)、[隔离容器服务](dc-media-edge-stage3.service)、[Nginx](nginx-media-tx.conf)、[环境示例](media-stage3.env.example)及 `dc-media-host-*` 运维服务为准。主机观测是保守估计，不是腾讯计费账本；用户已明确暂不以超额收费问题阻断。本阶段没有发布主站或启用媒体切换。

## 历史第八阶段设计（以下未部署描述仅指当时状态）

腾讯公网继续默认关闭。这里提供单实例 Node loopback 媒体服务及 HTTPS Nginx location；没有执行生产安装、系统 tc、防火墙、DNS 或私有/正式部署。原 `nginx-media-staging.conf` 保留历史媒体私有验证入口，不通过替换三个 R2 域名推测副本存在。

## 强制覆盖与容量信号

`admin/server/media-edge.ts` 的**一个进程**服务所有受管媒体路径，固定 `/media/objects/<不可变key>`，只允许发布工作器写入 `.distribution.json` 登记且实际内容 hash/长度一致的公开对象。没有目录列表、私有上传或任意文件路径；不得另配静态 alias 绕过它。原图/预览分别登记。容量端点 `/media/capacity` 无鉴权，只有 `{allowed,expiresAt}`，no-store、10秒有效；缺清单、不可读/损坏预算、禁用、已达并发/月额都失败关闭，不含主机指标、秘密或私有对象。

共享调度器在每个最多16KiB响应块发送前排队，**全部媒体响应体合计默认320 KiB/s**，不是每连接乘算的 `limit_rate`；最多2个活动媒体请求。其他请求503，Range也是独立请求且计入同一并发。Nginx per-IP 2 req/s、burst4，以及每HTTPS主机16个连接仅作额外请求入口防护。进程不得多开副本；跨实例不共享调度或账本。Node连接最多32，header/request超时，流关闭释放并发。TCP/TLS、操作系统/socket缓冲会造成短期误差，不能把它称为全服务器5Mbps硬限制。

后台R2私有/公开PUT共用原单媒体worker/目录租约；新增发送前月预算，上传体默认及允许上限64 KiB/s。应同时重启/升级后台，禁止旧512 KiB/s进程及其他上传脚本绕过。媒体320 + 同步64 = **384 KiB/s约3.15Mbps的应用响应体/上传体计划预算**，留给页面、评论及协议开销的余量不保证其他进程不会吃满出口。CPU/内存限制保护进程，不替代网络保护。

媒体账本默认250GB/月、R2上传账本80GB/月（十进制GB，UTC自然月）。每次GET范围/PUT发送前追加reservation并fsync，失败和断流不返还，HEAD不计体；重启复用、损坏或写入失败拒绝新体。数据文件首次不存在代表新账本，部署时须从可信的当月已用量初始化，**不能通过删账本重置配额**。账本为单writer保守记账，非供应商计费系统；400GB额度还包括未计量其他进程、协议、可能的入站流量。330GB子预算及剩余70GB不证明总月流量保护已实测。账本8MiB时失败关闭；轮换必须保留当月reservation（停服务后按可信数据压缩当月总额），不能丢弃未结束月份记录。

全服务器出口硬保护仍依赖后续获授权的运营商限速/tc与真实计量；本阶段没有配置或验收。公网启用前还须完成备案、HTTPS、真实双副本/Range/播放联调、已有月用量初始化及其他出口评估。当前默认策略 `enabled:false`、`MEDIA_EDGE_ENABLED`未设置，不会提前开放腾讯接流量。

## 部署步骤（需要另行获得部署授权）

1. 同步本阶段全部受信任前台、后台及部署源码；安装项目固定依赖。不只发布单个 settings JSON，旧远端适配器/前台不支持该策略。
2. 配置专用只读媒体服务用户；仅授予公开媒体目录及源码/依赖读取，不能读取后台privateRoot、服务秘密。后台仍为公开目录唯一写者，服务用户仅写自己的预算目录。按机器实际Node路径调整 `dc-media-edge.service`，不要给服务root权限。
3. 创建仅运维可写的 `/etc/dcelysion/media-edge.env`，示例：

   ```ini
   MEDIA_EDGE_ENABLED=0
   MEDIA_EDGE_PUBLIC_ROOT=/srv/dcelysion/admin-public-media
   MEDIA_EDGE_MANIFEST=/srv/dcelysion/admin-public-media/.distribution.json
   MEDIA_EDGE_BUDGET_JOURNAL=/srv/dcelysion/media-budget/edge.jsonl
   MEDIA_EDGE_BYTES_PER_SECOND=327680
   MEDIA_EDGE_CONCURRENT=2
   MEDIA_EDGE_MONTHLY_BYTES=250000000000
   ```

   速率可降到16KiB/s、不能高于320KiB/s；并发1–2；月预算只能调低。后台 `ADMIN_MEDIA_SYNC_BYTES_PER_SECOND=65536`（16–64KiB/s）、`ADMIN_MEDIA_SYNC_MONTHLY_BYTES=80000000000`（只可调低），账本在privateRoot的 `sync-budget.jsonl`。首次启动前按当月实际剩余额度减小两者。
4. `nginx-media-routing.conf` zones放http块；`nginx-media-routing-location.conf` include放允许的HTTPS server块，仅 `/media/` 指向127.0.0.1:8082。保留HTML/API/Waline路由，不启用其他公开媒体alias。`nginx -t`、systemd unit检查及重启均属于后续部署步骤，本机没有据此声称腾讯Nginx已联调。
5. 完成保护和只读权限检查后，另经授权改 `MEDIA_EDGE_ENABLED=1`。后台通过部署环境配置 `ADMIN_MEDIA_TENCENT_VERIFIED_DELIVERY=1`、`ADMIN_MEDIA_TENCENT_BASE=https://<授权主机>/media/objects`、`ADMIN_MEDIA_CAPACITY_URL=https://<授权主机>/media/capacity`、`ADMIN_MEDIA_PROBE_ID=<已公开小样本mediaID>`。地址仅HTTPS `/media/`，不进后台设置表单，不能放任意探测脚本。选取不超过策略probeBytes的**已公开**对象，不能自动公开私有样本。
6. 明确发布时，工作器先校验R2公开交付和本地公开文件，写受控edge索引；分别验证R2/腾讯实际GET hash、MIME/长度、immutable、CORS/TAO、HEAD及音视频Range/206后记录同版本回执。只有完整回执进入前台 `media-distribution.json`。新清单与固定revision候选共同形成受控提交，并以清单SHA核对构建输入/推送前一致性；任一失败停止页面推送。私有预览不生成双来源资格。

正式端点保留GET/HEAD/OPTIONS、Content-Type/Length、Accept-Ranges、206/Content-Range、immutable版本缓存、CORS和Timing-Allow-Origin；不压缩二进制媒体。媒体不可变键必须先交付，页面后发布；禁用或容量拒绝不会更改已有浏览器会话来源，资源按有限备用规则处理。

发布策略变更后，新页面读取新策略；关闭enabled会停止新请求参与选路，但同一标签页已缓存的首选源不自动重测或因模式变化重置。用户显式“重新选路”或开启新会话后，才按当前auto/r2/tencent模式重新决策。所有情况都保留已经开始的图片请求和正在播放的AV来源。

## 本地验证边界

`corepack pnpm exec tsx --test admin/tests/routing.test.ts` 使用真实两个loopback媒体HTTP服务与临时预算文件；R2 fixture直接返回响应，腾讯fixture复用生产edge处理器。延迟只验证状态机，不能代表公网性能。`routing-preview.ts` 复制可信源码到仓库忽略的cache目录，排除现有内容/MDX及秘密，用小PNG、WAV和ffmpeg生成的MP4构建真实博客。它打印前台和来源URL；`/__fixture/*` 控制仅测试入口存在，生产不导入。播放后错误按钮明确为**事件注入**，配合真实playing、URL/暂停状态断言，不冒充真实腾讯中途断流测量。
