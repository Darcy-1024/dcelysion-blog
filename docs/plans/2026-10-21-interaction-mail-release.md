# 互动邮件通知部署记录

状态：服务及数据库迁移已部署，专用测试邮件经后台第 4 次尝试获 SMTP 接受；用户收件箱验收待确认。以下部署结果于 2026-10-21 取得，2026-10-22 复核 Waline/worker 均持续运行，队列无未完成或耗尽任务。

## 范围与配置

用户已授权“提交部署”，包括向 `lin507793465@gmail.com` 尝试发送一封明确标识为部署测试的邮件。实现提交 `dc4817fd` 已推送 `origin/master`。

新内容账户点赞、留言及评论由 PostgreSQL outbox 和独立 worker 通知。管理员、作者/收件邮箱对应本人互动跳过；取消点赞不通知，同一账户同一路径反复取消再赞永久去重。旧匿名 reaction / 评论点赞未扩展，不补发历史评论。新收件配置独立于 `AUTHOR_EMAIL`；其原有值没有改变。

生产 Compose 仅修改 Waline 镜像及两项新通知变量，新增 `interaction-mail` 服务；程序已断言其他既有服务的配置和其他顶层配置不变。worker 沿用现有数据库/SMTP 配置和数据库/出站网络，未公开端口，不持有 Waline JWT；`INTERACTION_NOTIFY_ENABLED=true`、`INTERACTION_NOTIFY_EMAIL=lin507793465@gmail.com` 在生产 Compose 显式配置。原作者邮件回退因此关闭，回复者通知及其他渠道保留。

## 备份与部署回执

- 配置备份：`/opt/dcelysion/config-backups/interaction-mail-20261021/`，目录 0700，备份 `compose.yaml` / `.env` 为 0600；该目录还保存原镜像信息及增量构建上下文，不在公开路径。
- 数据库备份：`/opt/dcelysion/backups/waline-20261021-interaction-mail.dump`，212377 字节，`pg_restore --list` 已验证可读取。
- 原运行镜像：`dcelysion/waline-content-like:20261018-avatar-v2`，ID `67fcc6a2949bc22fe76c30eca06829b069b0b00f7607e932f6120aaf4422bd20`。
- 新镜像：`dcelysion/waline-interaction-mail:20261021-dc4817fd`，ID `7a1acdc894dd8f29210e8c9f39a5e6bec85c08d62758d4de855a369bfdc0ee0c`。以实际原运行镜像增量构建，仅加入 worker 并替换 `notify.js`，没有用旧仓库基础镜像覆盖线上认证功能；依赖的 `content-like-store.js` / `avatar-store.js` 与线上原文件哈希一致。
- 镜像构建期间通过两份 JS 的 `node --check`，并确认 `nodemailer` 与 worker 模块可加载。实际继承入口为 `docker-entrypoint.sh`，worker 的实际命令为 `node /app/src/lib/interaction-mail-worker.js`。
- 006 迁移事务成功提交，两个 INSERT 触发器已安装。19 条迁移前账户点赞仅建立完成状态的去重墓碑，没有补发邮件。
- Waline 与 worker 均运行新镜像，无重启；worker 先启动，再仅重建 Waline。2026-10-22 复核二者已持续运行约 5 小时。

worker 文件 SHA-256：`fb9d0a43164928d65c6a4054c04a57578862290f45e14e76f88d014391d860f4`；`notify.js`：`e9b5c52fa83e37ea6abee1fc83d1b2211650599b3639fb160a85df5ba5417ca6`。容器文件与本地提交源文件一致。

## 已验证与未通过项

带正式评论 Host 和博客 Origin 的回环检查：内容点赞 GET 200 且 `Cache-Control: no-store`，匿名点赞 POST 401，评论读取 200，登录页 `/ui` 200。不带可信 Host/Origin 的请求得到 403，属于现有域名边界，未为检查绕过。上线前与初次部署验证时原评论/用户/账户点赞数量分别为 13/3/19；测试没有创建公开虚假评论、点赞或用户。

唯一测试事件键为 `deploy-test:20261021:dc4817fd`，仅插入私有 `dc_interaction_mail`，使用 `deployment-test@example.invalid` 测试身份；昵称和正文明确标注部署测试，并说明没有真实公开互动。前三次尝试记录 `DELIVERY_FAILED`；诊断期间 `nodemailer.verify()` 得到 `ETIMEDOUT` / `CONN`，失败发生在连接阶段，没有改动账号认证设置。

当时的连接对比：SMTP DNS 有 IPv4/IPv6；worker 到配置目标的 IPv4 TCP 465 和 587 均超时，IPv6 返回 `ENETUNREACH`；宿主机到相同 SMTP 目标 TCP 465/587 可连接。这是当时容器出站路径的失败快照，不能据此断言持续防火墙或路由故障。未输出 SMTP 凭据、原始 SMTP 错误响应或完整环境配置。

2026-10-22 续查确认：原测试事件已在第 **4 次**尝试完成，`finished_at=2026-10-21 15:34:02.461538+00`（北京时间 2026-10-21 23:34）。该测试身份不匹配本人过滤条件，worker 只有在 SMTP 接受且无拒收后才会完成，所以本条已验证新 worker 的真实 SMTP 发送。期间未修改网络/SMTP 配置，未增加第二条测试事件，后台重试自行完成恢复。宿主机 TCP 465/587 续查均可连接。

队列复核有 19 条历史点赞墓碑、上述测试事件及 1 条正常评论事件，均已完成，无未完成或耗尽任务。该评论事件第 1 次完成可能属于本人过滤，**不将其声明为另一次真实发信成功**；两条 `completed` 日志本身不区分发送和本人跳过。Waline 仍仅绑定 `127.0.0.1:8360`，worker 无绑定端口；二者运行且重启计数为 0。

**实际收件箱/垃圾邮件是否收到测试信，仍待用户确认。** SMTP 接受与收件箱送达是不同回执，不以服务运行或队列完成代替用户收信验收；不需要为本次验收另行重发测试。

## 回退与边界

必要时先将 Waline 的 `INTERACTION_NOTIFY_ENABLED` 关闭并仅重建 Waline，恢复旧作者邮件回退，再停止独立 worker。若回退镜像，也可恢复上述私有备份中的原 Compose 并仅重建 Waline，移除新 worker，保留 006 表、触发器及数据，不使用旧数据库覆盖上线后的互动写入。后续重新启用须先确认积压事件处理意图。

SMTP 故障不影响原点赞/评论写入；数据库触发器/入队失败会回滚该次互动事务。SMTP 接受后若进程在完成标记之前终止，重试可能重复投递，不能承诺绝对一次。
