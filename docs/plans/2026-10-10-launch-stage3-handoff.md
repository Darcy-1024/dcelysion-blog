# 恢复上线第三阶段交接

完成日期：2026-10-12，北京时间。范围：腾讯独立媒体入口、受控双源副本验收和主机保护；停在第三阶段，未进入第四阶段主站发布。

## 结论与授权边界

已部署独立媒体服务，完成五个对象的真实公开 HTTPS 双源验收。最终腾讯交付关闭、容量广告关闭、前台 `mediaRouting.enabled=false`，正式 distribution 清单仍未激活。只准备了两条真实既有图片的禁用候选；未声称全量历史音频/视频已复制或播放验收。

用户同意 `media-tx.dcelysion.cn`，确认套餐5Mbps，并明确目前无需考虑超额、访问量少不必严格限速。因此全机仅按套餐5Mbps整形，不设置到额全机断网；350GB仅是保守的媒体门禁。主机账本不是腾讯计费账本，不证明400GB供应商硬额度。

`blog.dcelysion.cn` 保留 Cloudflare Worker，`blog-eo.dcelysion.cn` 保留独立 EdgeOne；腾讯域名只服务媒体。主页博客入口仍隐藏，评论仍关闭，MDX明确跳过。未修改其他域名的路由、邮件DNS或正式私有媒体公开权限。未提交/推送本任务Git，未部署Sites或主站；工作区包含其他任务修改，不能整体暂存。

## 部署与最终状态

| 项目 | 已核实状态 |
| --- | --- |
| DNS | DNS-only A `media-tx.dcelysion.cn` → `124.220.196.115`，TTL300；Cloudflare记录ID `dfa96497615f4ea82054e2e50630386d` |
| HTTPS | 独立证书至2027-01-09 22:25:33北京时间；webroot `/srv/dcelysion/acme`；`certbot.timer` active |
| 续期 | 2026-10-12 19:22:41日志明确模拟续期success/no renewal failures；dry-run不执行deploy hook。已有条件reload hook `/etc/letsencrypt/renewal-hooks/deploy/dc-media-tx-reload` |
| 媒体容器 | `dc-media-edge-stage3`，internal网络 `dcelysion-media-edge`，固定 `172.23.0.2:8082`，无宿主端口发布 |
| 隔离 | uid1000、只读rootfs、drop ALL capabilities、no-new-privileges；128MiB、0.25CPU、32PID |
| 目录 | `/opt/dcelysion-media-stage3`；runtime/public/admission只读挂载，budget写入；未挂载正式privateRoot |
| 服务 | `dc-media-edge-stage3.service`、`dc-media-host-bandwidth.service`、`dc-media-host-usage.timer`及既有cloudflared均active |
| 最终门禁 | `MEDIA_EDGE_ENABLED=0`、`MEDIA_EDGE_ADVERTISE_CAPACITY=0`；真实HTTPS容量200且`allowed:false`，已登记对象GET503 |

Nginx仅新建 `/etc/nginx/sites-available/dcelysion-media-tx` 及对应enabled链接，代理内部IP，不暴露目录、API或私有路径；HTTP仅ACME/HTTPS跳转。固定镜像ID：`sha256:1fffeb988fa7a5eb437d366a4a7a1ea1f4deacc102d5fe57415b3054976a7cb7`。

部署源：[隔离服务](../../deploy/tencent/dc-media-edge-stage3.service)、[环境示例](../../deploy/tencent/media-stage3.env.example)、[Nginx](../../deploy/tencent/nginx-media-tx.conf)、[主机整形](../../deploy/tencent/media-host-bandwidth.py)、[用量观测](../../deploy/tencent/media-host-usage.py)。临时样本上传容器及派生R2凭据文件已清理；正式凭据、媒体文件和预算账本保留。SSH使用用户现有私钥和严格known_hosts校验，未复制私钥内容。

## 双源交付验收

受控验收期间短时允许已登记对象GET，但容量广告始终关闭；结束后恢复关闭。每行均实际通过两源GET200、HEAD200、长度/MIME/完整SHA256一致及immutable缓存检查。音视频两源均通过首字节和末8字节Range206及内容核对。Tencent有CORS/TAO，R2精确允许blog Origin；预检204。未登记、私有、API及根路径404。

| 对象 | 类型 / 字节 | SHA256 | 适用范围 |
| --- | --- | --- | --- |
| article-test | image/png / 103 | b7308105b8f6688c53d3f708f0a870d7dd7da5a8046a3b7b517a6a79134a8475 | 合成验收样本，admin-public桶 |
| music-test | audio/wav / 16044 | 56d4af65701c26df20bd4021eda95b6e830348ce3a746086079fe89285548dc9 | 合成验收样本，music桶 |
| wallpaper-test | video/mp4 / 4255 | 5baa43ed8f7f579144b53be38b7c5d0967bf7449b12bfddb91bb039132f4b311 | 合成验收样本，wallpapers桶 |
| live-music-cover | image/webp / 36502 | e6d348b6059424571646258b57888bbad47f7c45bd77dc9833e07eb04c7e4890 | 真实既有公开封面 |
| live-gallery-preview | image/avif / 69007 | dd91e8df4ef27814897a85ab9c334992c7314d6b6b3f1a362c4516e763aa59c7 | 真实既有公开预览 |

三个合成对象的key均为 `stage3-validation/20261011/<上表SHA>.<png/wav/mp4>`，R2对应 `admin-media/music/wallpapers.dcelysion.cn`；腾讯在 `/media/objects/<article/music/wallpaper>/<key>`。真实封面key `covers/nights-crown-of-flowers-e6d348b6.webp`，预览key `wallpaper-2026/_previews/d20-d30ec649-w1200-dd91e8df.avif`，对应music/gallery域及腾讯同分类路径。精确URL与逐源回执见下述证据文件。合成文件没有进入正式内容或候选清单。

R2三样本PUT和SDK读回SHA已通过，共20402字节；公开HTTPS单独验证。初次Python客户端被Cloudflare UA规则1010拒绝，改用真实curl客户端后通过，未放宽Cloudflare安全规则。四公开桶custom domain active、r2.dev disabled；私有桶无公开域且r2.dev disabled；私有9.63MiB图片未公开。

## 主机保护、用量与预算

IPv4/IPv6默认出口均为 `eth0`。原root mq记录后，以独立5分钟回退timer保护首次安装，确认新SSH、后台200/匿名401、Waline带Origin200及统计接口200后持久化，并取消临时回退timer。TBF handle `1a3b:`，rate5mbit、burst32768、latency150ms，覆盖全机该接口出站，包括Docker和IPv6；不限制入站，不是供应商月费控制。

19:19:24最终证据：93763470字节、538957包、drops0、overlimits3、backlog0。overlimits是整形等待计数。四个新增systemd unit经 `systemd-analyze verify` 成功；输出另含既有xfs/tat/cloudflared配置警告，未改动这些服务。

主机每15秒读取eth0 RX+TX，以持久状态计算增量，运维permit有效45秒；超过350GB、permit缺失/坏/过期、重启、MAC变化、计数回退、周期到期或坏账本均拒绝媒体交付。故障保持锁闭，不能删除账本或自动归零恢复。截图467.4MB向上估为1GB初始基线，开始时间2026-10-11 23:27:28北京时间；19:19:24观测总数1266988318字节，fault为空。周期到期采用用户截图2026-10-23 20:06:07北京时间。这里含双向保守增量及人工基线，不能当作腾讯精确已用量。

当前媒体配置仅用于小额验收：总64KiB/s、并发1、1MiB响应体预算，累计reservation125929字节。正式设计320KiB/s、并发2、250GB及R2上传64KiB/s、80GB是应用子预算，不能加总称为400GB硬保护。用户要求放宽低访问量限速适用于后续正式配置，本阶段结束保持关闭，因此没有让1MiB验收参数承接用户流量。第四阶段启用前须选择正式参数并保留已有reservation。

## 源码与验证证据

新增主机permit接入，同时用于实际GET交付和容量信号；独立`advertiseCapacity`可让受控GET验收不触发前台选择。新增permit与主机用量测试；主机整形仅允许操作自有TBF或记录的原mq，拒绝覆盖他人qdisc。

必要验证：旧routing测试5/5、新permit测试2/2、Python用量测试2/2通过；相关Biome检查通过；可信esbuild媒体bundle已在远端运行并实际交付。Windows sandbox的realpath EPERM导致初次routing失败，提升权限后通过，未更改代码掩盖环境。未执行主站完整构建或MDX测试。既有浏览器路由证据仅在运行时实现未变化范围复用，本次没有重新进行完整浏览器验收或宣称真实历史音视频播放通过。

证据目录：`cache/launch-stage3-20261011/evidence/`（ignored，交接时须保留）：

- `operator/controlled-delivery-receipts.json`：五对象逐源回执；完成时间以文件mtime为2026-10-12 19:14:20北京时间。
- `operator/denial-verification.json`：过期permit、拒绝permit、保留账本降低额度、最终关闭均503。
- `operator/final-evidence.json`：19:19:24状态、容器挂载、证书、整形与预算。
- `budget/r2-receipts.json`、`public/.distribution.json`、`operator/qdisc-before.json`。

远端非秘密证据归档：`/home/ubuntu/dc-admin-private-20261002/launch-stage2-20261011/stage3-evidence.tar.gz`，本地同名cache归档；两端SHA256 `6df3298ca63a0215b44d603119c063c01f252e5819b1b051b1f5df8816b12dd6`。归档不含env、私钥、数据库或私有媒体。运行bundle SHA256 `3a5f7b4e7efdb96f5601a92916c318d799395710de7f7276d3f0dfc01fef5c6b`；公开索引SHA256 `4d6de5672fddfad75bda0755fe5cab5eb4a6fc15c379c869ea95a03c6bdf89ed`。

禁用候选：[media candidate](2026-10-10-launch-stage3-media-candidate.json)，只含两个真实图片，无localKey/合成样本。输入manifest哈希写在文件，快照inputHash `d0a3e048174c76558290fa98250008b5d04e05d710babb4a5ad2f3d1c98b21b5`。封面36502字节，大于正式默认32768探针上限，因此候选probeBytes65536；第四阶段必须连同策略和清单整体验证，不能只启用旧settings。音频、视频及未登记历史对象继续走原R2。

## 回退与后续操作

仅操作本阶段资源。关闭媒体：设置运维环境两个flag为0后 `sudo systemctl restart dc-media-edge-stage3.service`，核对capacity allowedfalse与对象503；前台继续enabledfalse。不要重启正式后台或替换Worker。

撤销整形：`sudo systemctl disable --now dc-media-host-bandwidth.service`；ExecStop仅删除自有handle并按已记录原mq恢复，随后检查 `sudo tc -s qdisc show dev eth0`。不要手动覆盖其他qdisc或改防火墙。撤下入口时先备份新site，仅移除 `sites-enabled/dcelysion-media-tx` 链接，`nginx -t`成功才reload；可使用官方MCP删除上文唯一新DNS ID，不能删除其他域名记录。保留证书、公开文件、receipt及账本，不删volume或数据库。

重启或10月23日周期到期后，媒体会等待基线复核。先保留operator状态、核对真实周期与接口计数，再人工更新基线和故障状态；不能用删除host-usage或budget文件解锁。证书续期timer已active，正式deploy hook只在该域lineage续期时reload Nginx。

第四阶段需用户开始并按项目约定单独新对话：携带本交接、候选与证据；核对最新Cloudflare/EdgeOne双域部署和输入哈希，选择正式预算/限速并验收浏览器回退后，才按该阶段授权发布或启用。不得把旧方案中的blog指向腾讯当作现有计划，也不得恢复主页入口、评论或Sites。

第二阶段残余保留：[stage2 handoff](2026-10-10-launch-stage2-handoff.md)。正式owner登录、草稿DB原文及私有R2回读已有证据；UI重新打开草稿、正式用户真实统计界面读取、另一个白名单/非白名单Access实测仍待确认。TOTP由用户取消，QQ绑定guest id2不能自动提升owner。第三阶段结果不能替代这些真实用户验收。
