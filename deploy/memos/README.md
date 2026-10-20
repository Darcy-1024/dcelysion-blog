# Memos 部署与备份

2026-10-21：正式 Memos v0.31.0 已安装，实例为 PRIVATE、注册关闭，独立普通作者为 `users/dcelysion`（USER）。后台凭据桥已部署；`memos.dcelysion.cn` 经 tunnel 到主机回环 `18446`，全路径交给后台会话网关，原始 Memos 不对公网开放。真实浏览器内嵌/新窗口已确认可用，公开、编辑与撤回的两站发布验证通过，实际回执与后续结果统一见 [生产验收报告](../../docs/plans/2026-10-21-memos-production-acceptance.md)。

同步规则见 [SYNC.md](SYNC.md)，发布器与失败恢复见 [PUBLISH.md](PUBLISH.md)，后台桥接见 [SSO.md](SSO.md)。仓库样例仍默认关闭；生产发布配置已 `enabled:true`，定时器已 enabled/active，每个完整周期结束60秒后检查新变化。测试动态首次发布提交 `9c448b34bd797a157eb81f2a92ff317aa6adc696` 已获得两站版本/公开树一致及正文、两图字节核验，不等于全部验收完成。

以下保留 2026-10-18 的初始安装/隔离恢复操作稿，历史核实见 [阶段一报告](../../docs/plans/2026-10-18-memos-stage1-readiness.md)。**不要对现有正式目录重跑初始化命令**；当前安装和运维入口为 [production-setup.py](production-setup.py)。恢复演练仍未执行，也未授权覆盖原实例。

## 安装与入口

使用独立 `/opt/dcelysion-memos`，备份放在 `/opt/dcelysion-memos-backups`；不加入既有 Docker 网络，不挂载后台、媒体、Git 或 Docker socket。固定镜像为 0.31.0 的 OCI index 摘要；amd64 子镜像摘要见阶段报告。384 MiB / 0.5 CPU 是试用上限，实际上传峰值尚未测量，OOM 时暂停并评估，不自动提高共享主机资源额度。

首次安装前先检查 5231/5232 和目录不存在，再由操作员复制本目录的 compose.yaml、compose.bridge.yaml、production-setup.py 到独立安装目录。安装目录 root:root 0700；数据目录 UID/GID 10001、0700；不自动创建缺失挂载，避免拼错路径启动空实例。下列流程中的5231是 `connect-origin` 创建的回环 Nginx 入口，不是 Docker 发布端口。

```sh
sudo install -d -m 0700 /opt/dcelysion-memos /opt/dcelysion-memos-backups
sudo install -d -m 0700 -o 10001 -g 10001 /opt/dcelysion-memos/data
cd /opt/dcelysion-memos
sudo docker compose -f compose.yaml -f compose.bridge.yaml config --quiet
sudo docker compose -f compose.yaml -f compose.bridge.yaml pull
sudo docker compose -f compose.yaml -f compose.bridge.yaml up -d
sudo python3 /opt/dcelysion-memos/production-setup.py connect-origin
curl --fail --max-time 5 http://127.0.0.1:5231/api/v1/instance/profile
```

镜像 Dockerfile/entrypoint 支持以非 root 运行；正式实例已按 UID/GID 10001 启动。Docker Hub 拉取超时后使用腾讯镜像传输，仍固定相同 OCI 摘要 `sha256:24c2707ddd8fbd2ceaa7a61ecab86a53cdcde640b24ce572b73da14b00b5785f`，不改为浮动版本或特权容器。

Windows 先确认本地 15231 空闲，再启动并保持 SSH 隧道：

```powershell
ssh -4 -i C:/Users/Darcy/Downloads/Ubuntu.pem -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=C:/Users/Darcy/.ssh/known_hosts -o ExitOnForwardFailure=yes -N -L 127.0.0.1:15231:127.0.0.1:5231 ubuntu@124.220.196.115
```

验证 `http://127.0.0.1:15231/` 页面和 JS/CSS 后再打开浏览器。正式初始化已由服务器生成并私存运维管理员与普通作者凭据，无需重建账号或通过聊天传密码。实例 PRIVATE 与注册关闭已读回；明确选 PUBLIC 才成为导出候选。邮件、webhook、AI 和外部存储不在本轮范围；LOCAL 附件限定数据目录。日常写作使用后台凭据桥，原始隧道仅供授权运维，不能作为跳过后台会话的公共入口。

正式部署已采用 `dc-memos-private` 内部网络、服务别名 `dc-memos-origin`；后台额外连接该网，Memos 不进入既有数据库网络。原始服务仅供服务器通过 Nginx `127.0.0.1:5231` 读取。该 Nginx 指向经核实的容器 IP，容器重建后必须先运行 `sudo python3 /opt/dcelysion-memos/production-setup.py refresh-origin`，再发送同步凭据；发布 service 已将其设为前置检查。不要假定 Docker 动态 IP 永久不变。

正式公网入口为 `memos.dcelysion.cn` → tunnel → `127.0.0.1:18446` → 后台网关。原后台域名的 Cloudflare Access 保持原配置；Memos 域名没有独立 Access 应用，由网关逐请求检查原后台会话。HTML、API、附件及分享均不能直达原始服务；不能把匿名 401 当作真实统一登录已通过。

## 一致备份与回退

初次数据初始化并完成试用后做一次；日常建议每日一次、保留 7 日/4 周/3 月（保留策略是提案，未安装 timer）。SQLite、WAL/SHM、LOCAL 附件、配置必须同一停写窗口复制。先确认没有第二写入者和目录外存储；不要在线只拷贝 `.db`。完整备份包含私密内容，目录 0700、文件 0600，不入公共 Git/Release。

下面在 root shell 中逐段执行；任何检查失败停止，归档失败也恢复原实例服务并报告失败；不自动删旧备份。

```sh
cd /opt/dcelysion-memos
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="/opt/dcelysion-memos-backups/memos-${stamp}.tar.gz"
umask 077
docker compose stop -t 60 memos
test -z "$(docker compose ps --status running -q memos)"
# 停止超时/被强杀须检查 SQLite 完整性后才接受备份。
tar -czf "$archive" -C /opt dcelysion-memos
sha256sum "$archive" > "$archive.sha256"
tar -tzf "$archive" > "$archive.inventory"
docker compose start memos
curl --fail --max-time 5 http://127.0.0.1:5231/api/v1/instance/profile
```

当前一致备份入口为 `sudo python3 /opt/dcelysion-memos/production-setup.py backup`，只停止 Memos，归档完成后恢复服务。本轮已生成并验证可读的 `/opt/dcelysion-memos-backups/memos-20261020T190547Z.tar.gz`，SHA-256 为 `36a52f2f72eb58b8b73b29d71f8c00412d7db1cb55f15617b9db1345b77a86ba`；没有执行破坏性恢复。归档包含私有配置/凭据，不得公开。

记录容器退出状态、镜像 index/平台摘要、备份大小/时间/SHA 和重启结果。原始归档只算同机恢复点；主机灾备需另行授权将加密副本上传独立私有目标、回读校验。同步 PAT 已保存在服务器私有 `sync/pat`（0600）；另行加密备份或恢复后轮换。用户照片的上传前原件由用户另行保存。

## 隔离恢复演练

1. 校验选定归档 SHA，检查 tar 条目不含绝对路径、`..`、越界软链接；在全新 `/opt/dcelysion-memos-restore-<stamp>` 展开。恢复前明确检查绝对路径，不能覆盖原目录。
2. 将归档内 compose.yaml 与 data 保持相邻，确认 data 实际指向恢复目录，不是原卷。使用相同固定镜像及全新项目/网络，另拟只监听回环5232的副本入口，审阅最终 compose 与 Nginx 后才启动。当前 compose 不发布 Docker 主机端口，设置 `MEMOS_HOST_PORT` 不会创建恢复入口；不能复用正式 `dc-memos-private`、服务别名或正式源站 Nginx。恢复前确认原实例没有邮件/webhook 等外部副作用；若已有则先在隔离副本禁用，不直接启动联网恢复副本。
3. 通过独立客户端本地端口 15232→服务器5232 隧道访问。对照原备份清单核对账号、正文、时间、可见性、附件数/大小/下载 SHA、注册及匿名拒绝策略；在副本写合成记录并重启，确认副本持久化且原实例没有该记录。需要时用独立 SQLite 工具对停止后的副本执行 `PRAGMA integrity_check`。
4. 完成后停止恢复项目并保留演练报告；不运行 `down -v` 或自动清理。仅本实例出现问题时停止 Memos 即回退；不停止现有 Docker/Nginx/后台，不删除数据，不将旧镜像直接指向已升级数据库。

已执行初次一致备份、重启及匿名网关拒绝检查；隔离恢复、浏览器编辑/上传/退出完整验收仍不能由这些回执代替，后续以生产验收报告为准。
