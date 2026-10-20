# Memos → 博客本地同步器

2026-10-20 补充：本文件描述的独立 `index.mjs` 仍不执行Git/部署；阶段三新增受控外层发布适配，见 [PUBLISH.md](PUBLISH.md)。后台内嵌及用户已选的作者凭据桥见 [SSO.md](SSO.md)。这些是本地实现，生产默认禁用，未安装真实Memos。

2026-10-18：实现与合成验证；未安装 Memos、未写服务器、未接正式发布。固定契约为 Memos **v0.31.0 /api/v1**。与 [部署操作稿](README.md) 的准备状态分别记录。

## 入口和配置

Node 使用项目 `package.json` 的版本范围及已有依赖，不新增 npm 包。入口：

```sh
node scripts/memos-sync/index.mjs --config /private/sync.json
node scripts/memos-sync/index.mjs --config /private/sync.json --apply
```

默认 dry-run 读取源、下载并验证候选图片，仅输出路径/操作/前后 SHA 的候选清单；不保存正文、原件或映射。运行时会创建并移除互斥锁，可能创建空工作目录。`--apply` 从头重新核对源，不接受旧 dry-run 文件作为应用指令；首次时间只在成功 apply 后固定，dry-run 后稍晚执行首次 apply 的时间/文件名可相应变化。两种模式均不执行 Git、构建、推送或部署，配置必须显式 `publish:false`。

[配置样例](sync.example.json) 只有占位值。实际配置、PAT、状态目录必须在私有服务器目录，不能放公共源码仓库，`stateDir` 被强制限制在 `outputRoot` 之外。`instanceId` 是操作员为该实例设置的稳定唯一标识；换实例不能复用旧 ID/状态。作者必须使用 API 返回的资源名 `users/<id>`，PAT 必须属于该作者，管理员代读不能作为归档完整性证明。首次使用会核对 `/instance/profile.version` 及 `/auth/me.user.name`，不匹配停止。

`timezone` 应与 `src/config/siteConfig.ts` 的 `siteConfig.timezone` 一致，当前为 Asia/Shanghai。绝对路径按运行系统填写；Windows 可以用 `F:/...`，但私有状态仍须在输出仓库外并限制 Windows ACL。Linux 状态目录要求 0700、PAT 文件要求 0600；文件原子写入使用 0600。不要将这些目录或备份挂到静态服务器。同步账号应独占输出目录及私有状态；其他编辑器、Git 更新与构建也必须在同步任务结束后串行运行。

尚无真实可用 PAT/实例，不要把样例执行命令当安装授权。阶段三已提供独立clone适配器和未启用的timer/service样例；机器人权限、生产配置与真实调度仍未安装/授权。没有webhook。

## 导出规则

- 只导出指定作者、`NORMAL`、明确 `PUBLIC`、无 parent/作为子记录的 COMMENT relation 的主动态。PRIVATE/PROTECTED/SPACE、归档与评论的正文不写入公开目录，也不通过 `draft:true` 保存。
- 同时完整扫描 NORMAL/ARCHIVED，遍历 lowerCamelCase `nextPageToken`。重复 token/ID、页数/条数/超时/错误响应、详情不一致都使本次失败。对所有已管理身份和新公开候选再读详情；附件使用独立完整列表核对。消失的记录必须在两次完整扫描中，均以作者身份详情 404 确认；403/网络失败不当删除。
- 图片就绪后再做第二次完整核对；任何正文、资格或附件变化使整次停止，下一轮重新生成。比较身份、公开资格、正文、时间、附件、位置、置顶和评论关系的规范化摘要，不把 computed snippet/reactions 或省略的默认值当源版本；不能只相信可被修改的 `updateTime`。分页本身不提供事务快照；双读是竞态保护，**不能保证最终核对后源绝不变化**。正式发布前仍需阶段三再次核对源资格和串行发布顺序。
- 首次看到公开记录时固定首次公开时间，不能从 createTime 猜测过去首次公开时刻。文件名 `YYYY-MM-DD-HHmmss-memos-<instance+ID摘要>.md` 按配置时区生成，显式保留秒及稳定后缀；frontmatter 用带 Z 的 ISO 时间保存真实时刻，避免 YAML 把本地时间当 UTC。后续编辑、撤回再公开不改文件名/slug/首次时间，评论身份始终 `/dynamic/<slug>/`。
- 原文、标点、表情保留，仅替换附件图片地址；不做自动语言校对/润色。`pinned` 映射布尔值；位置只映射 `location.placeholder`，用 YAML 安全字符串，不导出经纬度。
- 图片只接受同实例 `/file/attachments/<uid>[/filename]` 且属于该 memo 的本地图片。正文 inline 图片按正文顺序导出，已引用的不重复追加；未引用附件按 API 完整附件数组顺序追加。真实 Memos UI 上传及拖动顺序仍待实例验收，不能把合成数组验证称为 UI 验证。
- 与当前动态页提取器兼容的简单 `![描述](地址)` 才可导出。原始 HTML、引用式/复杂图片、代码块中会被前台误提取的图片、私有内部链接、危险 URL、外链图片、externalLink、SVG、HEIC、视频及其他未知格式均明确失败，不静默删改、猜测地址或生成缺图版本。普通 HTTP(S)/mailto/锚点 Markdown 链接可以保留。附件文件名不进入输出路径，避免路径注入。

## 图片与安全下载

凭据只送到配置的 HTTPS origin 或显式 HTTP 回环 origin。不跟随任何重定向，不读取任意外链；所有请求均 GET。单响应按流式实际字节限额，连接有超时和最多 3 次短暂重试（429、指定 5xx、网络/超时）。一次运行默认最多 5 分钟、每个列表 100 页/10000 条、单图 20 MiB、累计下载附件 128 MiB。达到限制失败，不生成截断结果；首次大批导出需审阅后调整上限。

校验附件 size、声明 MIME 与实际解码格式、尺寸、动画帧数、透明度。静态 JPEG/PNG/WebP/AVIF 经 Sharp 验证、校正 EXIF 朝向并转高质量 AVIF（80）；不裁切缩放。GIF/WebP 动画完整解码验证后保留源字节，不能安全处理的动画拒绝。单图最多 4000 万解码像素、100 帧；编码内存峰值尚未在 384 MiB 服务器限制下测量，阶段一资源额度不能当作已通过的运行容量。

Memos 下载原件按 SHA 放私有 `originals/<sha256>`，输出按转码结果 SHA 放 `src/content/dynamic/images/memos-image-<sha256>.<ext>`，相同内容复用。保留的是 **Memos 下载文件**，不保证等于用户上传前字节；Memos 可能处理 EXIF。真实照片朝向、色彩、移动端体验仍需联调。

撤回移除同步器拥有的 Markdown，但按原计划**不自动物理删除历史图片**，私有原件也保留。Git 历史、旧构建、CDN 和可能独立公开的历史图片不会因此安全抹除；如需图片清理或敏感内容应急处理，必须另定范围和验证，不以撤回回执冒充完成。

## 状态、冲突与恢复

私有 `state.json` 保存实例/作者/输出根目录/时区绑定、generation、memo→路径/slug/首次时间、源摘要、附件 SHA 映射、最近同步代数。`lastPublishedVersion` 当前始终 null：没有真实发布。`receipt.json` 是最近成功本地应用回执，分开标记 Git disabled、build not-run、deployment disabled；退出非零和 stderr 的 failed 回执代表本次失败，不能只看上次成功文件。常规日志不含 PAT、API 响应或正文。

只有映射拥有且当前字节 SHA 与上次成功输出完全一致的文件可改/撤回。人工改动、缺失、同名文件、显式 slug 冲突使**整次**停止，保留人工内容；当前采用较保守的整批冲突边界。先人工核对/备份再解决，不删状态强行覆盖，也不导入历史动态。

状态目录锁及输出根目录锁均为独占创建；另一状态目录也不能同时写同一个输出根。锁不按时间过期抢占。进程异常退出留下锁时，确认本机进程已死亡再运行：

```sh
node scripts/memos-sync/index.mjs --config /private/sync.json --apply --recover-lock
```

仅允许相同主机且 PID 确认不存在的锁自动移除；活进程、权限不足或其他主机的锁都拒绝。PID 复用时需操作员核对后处理，不盲目删锁。状态/输出父路径拒绝 symlink/junction 越界。

每个文件以同目录临时文件 + fsync + rename 写入；批次先持久化 `journal.json`，最后写状态提交标记，再移除 journal。未提交批次重启先校验当前字节只能是已知旧/新值，回滚到上次状态，再重新读取源；绝不盲目重放陈旧公开正文。已提交批次只清理 journal。恢复遇到人工差异停止，不覆盖。dry-run 遇未完成 journal 拒绝恢复，让操作员明确执行 apply。

这保证受控单写者下的文件原子替换和进程中断恢复，**不是整个目录对并发读者的一次原子切换**，也没有证明断电/磁盘损坏恢复。阶段三构建器必须等同步成功后才读目录。保留状态+原件+配置+PAT 的私有一致备份；不要删除状态重建身份。

## 可复现验证

```sh
node --test scripts/memos-sync/sync.test.mjs
node scripts/memos-sync/prepare-build-fixture.mjs
# 使用上一命令打印的 root/id，从主仓库运行：
node scripts/memos-sync/verify-build.mjs --root <root> --id <id> --direct-existing-tools
```

fixture 工具在已忽略 `cache/memos-stage2-*` 创建源码副本和独立私有状态，只复制当前 Git 已跟踪/未忽略的源码与配置，不复制秘密。依赖用 node_modules 联接复用，不安装；Windows 创建联接可能需要工具批准。构建使用副本的独立 Astro/Vite 缓存，不改主目录 dist/缓存/历史内容。源码副本含已存在、尚未提交的当前功能，所以构建结果不能归于单一 HEAD 提交。

普通入口可使用项目固定 pnpm；本机 pnpm 11 的自动依赖检查会尝试安装并被 `ERR_PNPM_UNSAFE_MODULES_DIR` 拒绝。`--direct-existing-tools` 按当前 package.scripts.build 的所有步骤、原顺序调用已安装的 tsx/Astro/Node，并为 Pagefind 提供本地 bin PATH；只覆盖隔离副本 Astro/Vite 缓存位置。它不绕过 pnpm 的删除保护、不恢复 MDX 后台执行器，不声明 `pnpm build` 已通过。完整构建依然可能使用现有构建链的网络缓存/回退。

构建工具核对完整公开动态 ID、合成动态图片顺序/原图字节、WebP 预览及 srcSet 实体资源、动态页和评论页产物。评论实际浏览器交互、Memos 认证/匿名拒绝、真实附件、服务器重启/备份恢复和正式发布均不在 fixture 验证范围。阶段报告记录实际运行结果。
