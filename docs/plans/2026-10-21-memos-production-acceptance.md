# Memos 生产部署与真实验收

后续已增加原生“＋ → 插入表情”菜单，部署和验证见[表情菜单上线记录](2026-10-21-memos-emoji.md)。

日期：2026-10-20—21（Asia/Shanghai）。本记录接续[阶段三准备](2026-10-20-memos-stage3-publish.md)，以下区分部署、Git、构建、线上内容和浏览器结果。

## 已部署

- Memos v0.31.0，OCI digest `24c2707ddd8fbd2ceaa7a61ecab86a53cdcde640b24ce572b73da14b00b5785f`，源码 commit `2b2192d4e153bd04f1d325b60fd880cf00d68b01`。Docker Hub 超时后使用腾讯镜像，digest 不变。
- 实例 PRIVATE、禁止注册；专用普通作者 `users/dcelysion` / USER。独立 operator 与作者密码、同步 PAT 只在服务器私有文件中保管。
- Memos 仅加入内部网络 `dc-memos-private`；后台另外加入该网络，通过 `dc-memos-origin:5230` 连接。无公网原始端口；宿主机同步入口由 Nginx 仅监听 `127.0.0.1:5231`。每次发布前 `production-setup.py refresh-origin` 核对容器项目、服务、运行状态、固定 digest 和内部网络后刷新目标 IP；容器重建后也必须先执行该动作。
- 后台入口包含“动态 · Memos”，继续使用原 Waline 管理员会话和原 2FA 配置；没有修改原身份策略。网关逐请求验证后台会话，监听独立容器端口，经宿主机回环 18446 接入。
- 既有 Cloudflare Tunnel 增加 `memos.dcelysion.cn` → 127.0.0.1:18446，DNS 为代理 CNAME。原 admin 的 Access 配置保留。Memos 域名依赖后台逐请求网关鉴权，不声明有额外 Access 应用覆盖。
- 用户明确授权后，已创建仓库专用可写 Deploy Key：ID `167100845`，标题 `Memos controlled publisher 20261020`，只绑定 `Darcy-1024/dcelysion-blog`。私钥只保存在服务器。
- Linux publisher 镜像 `7e31556d1a7e9c7342a827812e21e8cdb3c44060d92fa3549e70c8100fbdb786`；独立 checkout、UID1000、只读根文件系统、受限资源、host flock 覆盖同步到两站部署观察。生产 config 已 enabled；三轮发布验证完成后 timer 已 enabled/active，每轮完整结束60秒后检查新变化。

## 备份与升级回退

- 既有后台/数据库备份：`/opt/dcelysion-admin-stage2/backups/20261020T105547Z`，三个归档/数据库导出均可读并记录摘要。未执行破坏性还原。
- Memos 停机一致备份：`/opt/dcelysion-memos-backups/memos-20261020T190547Z.tar.gz`，SHA-256 `36a52f2f72eb58b8b73b29d71f8c00412d7db1cb55f15617b9db1345b77a86ba`。备份后原实例重启；归档含私密凭据，应保留原私有权限。
- 首次后台包 SHA-256 `932daf74da52d1b0a73615eb3303245c6b6412d75e290d04816493c328906b34`，release `20261020-memos`；旧容器 `dc-admin-formal-before-memos-20261020` 停止保留。升级脚本只改后台，不还原内容/评论数据库。

## 实际发布回执

测试正文标识为“Memos 发布联调测试”，图片为两张不含个人信息的合成 PNG，按源附件顺序输出 AVIF。源 memo 为 `memos/kiHgH4oPrRNp5y5JrwhMCi`。

| 操作 | Git 与构建 | 线上证据 |
| --- | --- | --- |
| 首次公开 | `9c448b34bd797a157eb81f2a92ff317aa6adc696`，Release 两个附件存在 | 两站 sourceRevision 匹配、公开树摘要均 `247f0ffbcfc927052d63c98215f91a1e172e01749b2405dd612b236530c6ca5b`；动态 JSON 含正文和两图，图片请求成功且两站字节哈希一致。 |
| 编辑第二版 | `f8d25c23b91214af1ba3090ca756a1e2ce8d89f2` | 两站公开树摘要均 `09500cc5269d4cae9077d4555e274e5d664f83289fd641a17809b0830f3b267b`；第二版正文可读，原动态 ID 与两图保持。 |
| 改为私有撤回 | `e69178b7c00607215d85e01b14493e3befc8e03f`，Release 资产存在 | 两站公开树摘要均 `bda8fd22686366dec2994c7029624bdd160e153858ed1c550a982477479432e3`，动态 JSON 均不含测试正文，列表数量一致。源 memo 保持 PRIVATE，未删除源或历史图片。 |

首次动态 ID：`2026-10-21-030724-memos-5c715c0a35ec7006`。两张 AVIF 摘要依次为 `197cb812e8bdbb31a594a5023c5999b2fab2dcce00f5849cbe47bf578236e5c2`、`cf6a7c2e35fb3608b46321834ae162b76947510996061fec4c4dc9c339c49e7d`。`lastPublishedVersion` 未被版本观察工具冒充为逐内容验收结果。

## 真实登录与必要修复

用户已在真实 Edge 完成 Access 和后台登录，自动化成功读取登录后的后台与 Memos 入口。首次 iframe 显示浏览器错误页，新窗口由用户确认 Cloudflare 502。限时 Nginx 诊断仅记录 method、无 query 的路径、状态码和 Origin，没有记录 Cookie、票据、Authorization 或正文。

真实 API 证明 signin 返回 200、正确 USER 和短期 access token，但刷新 Cookie 位于 `Grpc-Metadata-Set-Cookie` 而非 `Set-Cookie`。桥接代码现仅从固定私有上游兼容该字段，仍检查 Cookie 格式，且不向浏览器转发它。修改后 11 项桥接测试和后台 TypeScript 检查通过。已部署新 release `20261021-memos-cookie`（bundle SHA-256 `6cb80650f2bcc50a7b51899c3b36d0e7efef5de330d9ed42af48de73c5b9e68a`），运行环境变量逐项未变，旧容器 `dc-admin-formal-before-memos-cookie-20261021` 停止保留；用户已确认内嵌和新窗口正常。

用户截图已确认 iframe 内编辑框、第二版测试正文和两张图片可见，语言可切换简体中文。浏览器上传未测试；退出人工验收按用户要求跳过，现有逐请求保护未移除；手机实际工作流未测试。匿名公网根页面和 API 已验证 401，不能替代以上登录态验收。原评论/点赞交互没有在本轮重做验收。

## 验证与运维

- 发布器 14 项 Git fixture 测试通过；增加 SSH origin 的限定域名校验，默认关闭/SSH 配置用例再次通过。普通编辑导致的提交前源变化可在下周期重新读取；已存在 publication journal 或已提交候选的风险仍停机，不重放旧撤回内容。
- Linux sharp 0.35.4/libvips 8.18.6 实际生成并读取小图，marked/yaml 导入成功；shell/service 静态检查通过。
- 发布通过 `sudo systemctl start --no-block dc-memos-publish.service`。停止后续自动执行使用 `sudo systemctl disable --now dc-memos-publish.timer`。失败会落私有 halt 并停止 timer；排查后按 [PUBLISH.md](../../deploy/memos/PUBLISH.md) 的 journal/远端祖先规则恢复，禁止强推和盲目删除状态。
- 各周期等待当前 SHA 的两站版本/公开树匹配后才允许下一周期；构建发布仍有延迟，撤回不等于立刻清除历史 Git/CDN/已下载副本。
- 本轮 Git 实现基线已推送 `698fbe3b`；后续运行时与真实协议修复独立具名提交，结果以 Git 回执为准。无 OpenAI Sites 发布。

发布器私有状态与凭据同机备份：`/opt/dcelysion-memos-backups/publisher-private-20261020T192351Z.tar.gz`，SHA-256 `bac328e5d88b524975f191ee9ddd686c7c39e1cf8463847b8787672813a04321`，0600；归档可读。该备份不含整份 clone；干净且已推送的 checkout 可由远端重建。未来如有本地未推送候选，须按 PUBLISH.md 成对保留 clone。临时请求诊断现已关闭。
