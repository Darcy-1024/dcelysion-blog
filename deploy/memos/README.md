# Memos 隔离试用操作稿

2026-10-20：阶段三本地发布适配及失败恢复见 [PUBLISH.md](PUBLISH.md)，后台内嵌与用户已确认的独立作者凭据桥见 [SSO.md](SSO.md)。正式安装/真实联调、生产入口和自动发布均未启用；以下初始化、备份恢复步骤仍是待授权操作稿。

本地同步器的独立阶段二实现、配置与验证见 [SYNC.md](SYNC.md) 和 [阶段二报告](../../docs/plans/2026-10-18-memos-stage2-sync.md)。这些结果不改变下列服务器尚未安装/启动的准备状态。

2026-10-18：仅准备，尚未复制到服务器、拉取镜像或启动服务。事实、API 与验收矩阵见 [阶段一核实](../../docs/plans/2026-10-18-memos-stage1-readiness.md)。以下均为**获得部署授权后**在 Ubuntu 执行的命令，不是执行回执。

## 安装与入口

使用独立 `/opt/dcelysion-memos`，备份放在 `/opt/dcelysion-memos-backups`；不加入既有 Docker 网络，不挂载后台、媒体、Git 或 Docker socket。固定镜像为 0.31.0 的 OCI index 摘要；amd64 子镜像摘要见阶段报告。384 MiB / 0.5 CPU 是试用上限，实际上传峰值尚未测量，OOM 时暂停并评估，不自动提高共享主机资源额度。

先重新检查 5231/5232 和目录不存在，再由操作员复制本目录的 compose.yaml 到 `/opt/dcelysion-memos/compose.yaml`。安装目录 root:root 0700；数据目录 UID/GID 10001、0700；不自动创建缺失挂载，避免拼错路径启动空实例。

```sh
sudo install -d -m 0700 /opt/dcelysion-memos /opt/dcelysion-memos-backups
sudo install -d -m 0700 -o 10001 -g 10001 /opt/dcelysion-memos/data
cd /opt/dcelysion-memos
sudo docker compose config --quiet
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
curl --fail --max-time 5 http://127.0.0.1:5231/api/v1/instance/profile
```

镜像 Dockerfile/entrypoint 支持以非 root 运行；上面预先设置目录所有权，避免依赖 entrypoint 的 root chown。该硬化组合尚未运行验收，权限或启动失败时保留日志，不改为特权容器。

Windows 先确认本地 15231 空闲，再启动并保持 SSH 隧道：

```powershell
ssh -4 -i C:/Users/Darcy/Downloads/Ubuntu.pem -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=C:/Users/Darcy/.ssh/known_hosts -o ExitOnForwardFailure=yes -N -L 127.0.0.1:15231:127.0.0.1:5231 ubuntu@124.220.196.115
```

验证 `http://127.0.0.1:15231/` 页面和 JS/CSS 后再打开浏览器。首个管理员只经隧道初始化，账户密码由用户设置。设置：实例访问 PRIVATE、关闭注册、默认 memo PRIVATE；明确选 PUBLIC 才成为后续导出候选。禁用/不配置分享链接、邮件、webhook、AI 和外部存储；LOCAL 附件路径限定数据目录内的 `assets/`，上传上限建议 20 MiB（待用户实际图片需求确认）。设置必须读回并验证接口行为，不能把 Compose 当作已完成访问策略设置。

本轮不需域名、证书、Nginx、Cloudflare 或防火墙变更。手机远程常用入口后续可用独立 `memos.dcelysion.cn` + Access + tunnel；该名字仅提案，未检查占用、未创建 DNS/Access。对外暴露前单独授权并确认 Access 全路径覆盖，包括 API、附件及分享地址。同步器同机走回环；若经 Access，服务令牌和 Memos PAT 分别认证，不做匿名 Bypass。

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

记录容器退出状态、镜像 index/平台摘要、备份大小/时间/SHA 和重启结果。原始归档只算同机恢复点；主机灾备需另行授权将加密副本上传独立私有目标、回读校验；本轮不复用现有数据库备份脚本或凭据。PAT 文件未来计划放在服务器私有状态目录 `sync/pat`、0600，尚未创建；另行加密备份或恢复后轮换。用户照片的上传前原件由用户另行保存。

## 隔离恢复演练

1. 校验选定归档 SHA，检查 tar 条目不含绝对路径、`..`、越界软链接；在全新 `/opt/dcelysion-memos-restore-<stamp>` 展开。恢复前明确检查绝对路径，不能覆盖原目录。
2. 将归档内 compose.yaml 与 data 保持相邻，确认 data 实际指向恢复目录，不是原卷。使用相同固定镜像、`MEMOS_HOST_PORT=5232 docker compose -p dcelysion-memos-restore config` 审阅最终映射，然后启动。恢复前确认原实例没有邮件/webhook 等外部副作用；若已有则先在隔离网络副本禁用，不直接启动联网恢复副本。
3. 通过独立客户端本地端口 15232→服务器5232 隧道访问。对照原备份清单核对账号、正文、时间、可见性、附件数/大小/下载 SHA、注册及匿名拒绝策略；在副本写合成记录并重启，确认副本持久化且原实例没有该记录。需要时用独立 SQLite 工具对停止后的副本执行 `PRAGMA integrity_check`。
4. 完成后停止恢复项目并保留演练报告；不运行 `down -v` 或自动清理。仅本实例出现问题时停止 Memos 即回退；不停止现有 Docker/Nginx/后台，不删除数据，不将旧镜像直接指向已升级数据库。

当前备份、恢复、持久化、匿名拒绝和浏览器编辑验收均未执行。
