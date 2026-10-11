# 恢复上线阶段一交接（2026-10-11）

## 结论

**按用户最新决定跳过 MDX，阶段一以缩减范围收尾；真实 MDX 成功不再阻断进入后续阶段。** 当前完整后台候选已构建、封包并核对摘要；真实 MDX 请求进入过受限容器，但尚无成功预览产物，隔离发布执行器/release 链未验收。最新修复镜像的请求在上传前被内存门拒绝，没有创建容器。

依据：`2026-10-10-public-launch-resume.md`、2026-10-04 readiness、2026-10-03 runtime integration。用户后续只授权暂时停三项具名测试服务争取余量并恢复；未授权提高额度、降低门槛或停止其他服务。条件删除要求确认无用，目前三项服务仍用于联调/回退，故保留全部容器、卷及配置。

## 2026-10-11 用户决定与收尾确认

用户最新原话：**“解决不了，跳过这个MDX 构建吧”**。因此停止后续MDX重试、修复及扩展排查，撤销此前以MDX成功作为进入后续阶段的必要条件；不自动恢复构建，除非用户以后重新明确要求。协调对话更新总方案，本对话仅更新本阶段handoff。

| 状态 | 结果 |
| --- | --- |
| 已验证 | 当前完整可信后台候选构建/封包、142文件摘要；固定依赖内类型/Svelte/前后端/原生Sharp检查；7项定向测试；服务恢复及匿名私有API拒绝。 |
| 跳过 | 后续真实MDX构建、预览产物验收、依赖MDX的完整发布链恢复；不再为此重试或争取更多资源。 |
| 未验证 | 最新候选实际运行/登录/R2业务；真实预览、隔离publish executor/release协议及正式发布。没有以旧联调证据替代。 |
| 保持不可用 | 当前测试candidate的ADMIN_EXECUTOR_STATE_ROOT、ADMIN_PUBLISH_REMOTE/BRANCH、ADMIN_BUILD_REMOTE_URL/IMAGE、ADMIN_TENCENT_SSH_HOST均未配置；无Docker socket挂载。预览/发布配置未启用，后续部署也必须保持禁用或明确返回不可用，不得用fixture模拟成功。 |

最新只读收尾核对：rootless运行容器为空；本轮7个builder用户unit均未运行（其中disk首次接线失败unit保留failed状态，其余inactive）。三项具名测试容器均运行，旧测试admin仍停止；五项正式/统计保护服务运行，正式PG healthy；隔离HTTPS `/`=200、匿名 `/api/me`=401。没有仍需停止的任务。三项测试容器仍承担联调/回退，未满足“确认后续无用途”的删除条件，未删除任何容器、卷、数据或备份。

## 已完成的修改

- `admin/build/builder-service.ts`：上传落盘改为受保护持久磁盘目录；前后内存门保持1152MiB，上传完成 fsync 后再检查。增加固定阶段诊断，不输出任意 MDX 日志、原文或凭据。取消请求等待清理完成；无法确认清理时阻止后续任务。
- `admin/build/work-root.ts`、`admin/.env.example`：新增必填 `BUILDER_WORK_ROOT`，要求绝对真实目录、当前用户所有、0700、非符号链接、非 tmpfs/ramfs、至少2GiB可用。实际试运行目录为 `/home/dc-builder/build-jobs-stage1-20261011`，ext4；没有改全局 `/tmp`。
- `admin/server/build.ts`、`admin/server/build-lifecycle.ts`：分开 create/start，处理创建期间取消；串行停止并有期限；输出落盘等待、取消和超时有明确清理结果。只检查/移除本任务容器，不扩大 Docker 权限。
- `admin/build/entrypoint.sh`：Astro 7 的 CLI 为 `astro/bin/astro.mjs`，旧 `astro/astro.js` 不存在。依赖逐项链接到固定只读镜像，Astro/Vite 缓存写入本任务 `/work/node_modules`；Pagefind PATH 指向固定依赖的 `.bin`。
- `admin/tests/build-lifecycle.test.ts`：覆盖创建期间取消、预先取消、输出 flush 取消/期限，以及拒绝内存文件系统。

未提交、未推送；未执行 Sites。任务外 AGENTS.md、构建参考、FloatingControls、commentConfig、siteConfig、review 日志及 docs/reviews 均保留。没有改用户内容、草稿状态或媒体选路策略。

## 422 与真实尝试证据

所有请求使用同一真实源码输入，包含原文 `src/content/spec/friends.mdx`；不是 fixture，也未在宿主运行用户 MDX。日志只保存固定错误类别及资源状态，不能从日志字节数推断具体内容。

| 尝试 | 实际结果 |
| --- | --- |
| 初始只读资源核对 | MemAvailable1126928KiB，低于1179648KiB，缺52720KiB；未提交请求。 |
| `7f588913-5c1e-42fe-8040-d1bc90e079a9` | HTTP422，0.94秒；上传前1220592KiB，后965772KiB，未创建容器。服务器 `/tmp` 是tmpfs，224MiB上传占用了宿主内存。当前已复现该入口问题；历史请求缺诊断，不能声称历史422已逐行证实同因。 |
| 磁盘配置初次接线 | 仍引用旧环境文件，`BUILDER_DISK_ROOT_REQUIRED`，未POST。修正接线后才继续。 |
| `a3a4b4df-cc5a-468f-a187-3e5f4f50df02` | 磁盘上传前后资源门通过；容器启动，HTTP422，7.77秒，exit1、OOM=false、无输出。随后检查到旧Astro CLI路径不存在。 |
| `4259c95d-a997-4ded-8d54-a2b45725480e` | CLI修复镜像内运行17.14秒，exit1、OOM=false、stderr701字节、无输出。可信空源码探针随后复现只读依赖缓存失败，不能把未保留的真实原始日志说成已逐行核对。 |
| 可信缓存探针 | 只含固定空配置，无MDX、无用户内容。整体 node_modules 链接失败，报 `.vite/deps_temp` ENOENT；依赖逐项链接后同一探针exit0。不是实际MDX验收。 |
| `29ee71ba-100d-464a-948d-bb9a3f3d3b51` | 本次镜像修改误写 `/opt/entrypoint.sh`，实际入口仍为 `/opt/build-entrypoint.sh`；运行8.24秒，exit1，固定类别MODULE_NOT_FOUND。已纠正并从容器复制实际入口回读核对摘要，不把此轮算修复后成功。 |
| `9adba805-bc21-4829-8768-49bffe7147d8`（最后一轮） | 修正镜像后HTTP422，0.35秒；健康检查时1243000KiB，实际上传前1143880KiB，低于1179648KiB，缺35768KiB（约34.9MiB）。阶段`reserve-before-upload`，`BUILD_MEMORY_RESERVE`，未创建/启动MDX容器。资源不足交付阻断，不盲重试。 |

部分临时 wrapper 在提交HTTP前将 `realBuildExecuted` 设置true，因此**不得单独使用该字段作为容器启动证据**；以上以阶段诊断及 container-state 为准。

## 资源与隔离

专用 dc-builder UID1002，所有命令显式指定 `unix:///run/user/1002/docker.sock`；rootless、cgroup v2/systemd 及内存/swap/CPU/PID能力已核对。

- 实际MDX容器：uid1000:1000、network none、只读根、cap-drop ALL、no-new-privileges、无宿主bind；768MiB内存、总memory-swap1280MiB、0.5CPU、192PID、10分钟。
- 父 `user-1002.slice`：MemoryMax805306368、额外MemorySwapMax536870912、CPUQuotaPerSecUSec500ms、TasksMax512。额度保持；无swap调整或drop_caches。
- 原主机1962MiB内存，根磁盘约30GiB可用；上传落盘不等于消除内存波动。实际容器尝试未触发384MiB宿主底线、OOM或正式服务异常；最后一轮没有启动容器。
- 原依赖镜像：`sha256:7d80192eb45362b46bc601b7ef5243cb772ae456f8a48b8d3fa034c4de8c9210`。
- 最新实际入口镜像：`sha256:7034637a28c9011b2e66f25c5a6ef42d9c0887fe5836c14c11d76df77d66f111`；入口 `/opt/build-entrypoint.sh`，SHA256 `b0096c777aa7c9ab90d40de07c1c0643508f876f7d9e4d2f881ac41930ddaa46`。由原镜像创建从未启动的可信容器、复制入口再commit，无依赖安装。实际入口回读字节相等，镜像内 `sh -n` 通过；真实MDX仍待资源满足后验证。
- 保留原镜像及具名可信镜像准备容器，未全局prune。所有本轮短时builder服务已停止，最终rootless运行容器列表为空。

## 当前源码、输入与候选包

HEAD `48e0155ea115b83012faae2f6104cbc314ea3520`，版本6.16.8；候选反映当前未提交工作树，不是仅HEAD，也不是旧index拼接。

冻结快照位于忽略目录 `cache/launch-stage1-20261011-final/`。完整源码包含1005文件，后台构建输入248文件；排除秘密、运行数据、缓存、AGENTS及任务外reviews。源码快照生成在本handoff最终更新前，因此handoff文档版本不同；后台构建输入不包含此文档，业务输入一致。

| 产物 | 字节 | SHA256 |
| --- | ---: | --- |
| source.tar.gz | 667503644 | d773322d46fc5375c7133249e7b68639e7219257f8cce7129fbfb0d252d2a480 |
| build-input.tar.gz | 564859 | 63465164ada2306dda263dfb32c32a8e43c6f0e3137c0a11f2d50c4ed7b5d0a0 |
| admin-candidate.tar.gz（最新） | 9150967 | 0160d4a7ff15a4840f0bc4487b9e0688e8c9b8565a11781714be006ca4ac64f5 |
| real-mdx-input.tar | 224251392 | 541bebd07226573b450eb812b962e5384b5af1f3c9ce2332caf5ff3da6979425 |

后台包：固定依赖镜像内Node24.20.0、linux/amd64、musl；类型检查通过，svelte-check 0 errors/0 warnings，前端build、后端esbuild、Sharp0.35.4/libvips8.18.6与1像素WebP实际转换通过。最新输入相较已通过完整构建输入只差 `admin/build/entrypoint.sh`，逐文件比较后复用前后端产物并重新封包；不是沿用旧历史候选。候选142个文件回传本地逐项核对bytes/SHA256通过，源manifest摘要 `db57a134b16de59d15e8977f8e012a850707c4d6d35be3136806b2337cda0970`。

后台包在 `/home/ubuntu/dc-admin-private-20261002/launch-stage1-candidate-20261011/admin-candidate.tar.gz`；本地为上述final目录下 `launch-stage1-evidence-20261011/admin-candidate.tar.gz`。**尚未替换运行中的历史测试candidate，不能把恢复后HTTP健康算作新候选运行验收。**

实际MDX为 `src/content/spec/friends.mdx`，原文摘要 `761015764ef84daeb2e498b6cfc18eb8321033e1c69a7d51d8835b578ea28086`。输入694文件、782tar成员、内容223596462字节，严格输入检查无违规。预览输入排除了 `public/gallery`、`public/assets/music`、`public/assets/videos`；这不是完整发布输入。当前发布执行器导出的全部tracked public使完整源码约667MiB，大于544MiB上传及512MiB解包预算；这是未解决的历史完整发布限制。依用户决定不继续修复或扩展排查，不能静默改变媒体策略或扩大安全预算，也不能宣称完整链可用。

package.json / pnpm-lock.yaml / pnpm-workspace.yaml 本地与固定镜像输入匹配：

- `a0c5632a8c2ecea8a00ec0e7fad1206a17c2ff85edfee53e9744d52850a777ae`
- `2c2fb6046f1eb486dbd0527c7b1695537ef7ff527885c9761b70382ec9e659d0`
- `d55a2e1d40549a1bfb40cb9fea473f2ca9492abde93d0ba508541b61e11940bb`

## 检查与限制

- 7项定向测试通过（build-lifecycle + remote-build）；5个修改TS文件Biome只读检查通过，未全目录格式化；入口sh语法检查通过。
- 本地tsc仍报告media-storage.ts的3项既有S3Client.send类型错误，不算本地通过；固定依赖镜像内同一源码tsc通过。未用类型断言或依赖安装掩盖本地差异。
- Corepack在本地sandbox缓存路径ENOENT，改用已经安装的Biome CLI完成检查；未安装环境。
- Astra最后一次咨询因用量限制失败，未得到本轮独立建议；此前生命周期建议已纳入定向检查。
- 未成功生成真实MDX预览；未运行新候选HTTP/登录/R2业务验收；未验证隔离Git、publish executor或release协议；不把旧联调成功转记为本次通过。

## 服务恢复、保护与回退

每次试运行先确认三项 `dc.task=admin-private-20261002` 标签，并通过测试PG核对无queued/running发布或媒体任务。仅停止：candidate→测试Waline→测试PG；finally恢复实际停止项：PG（等待ready）→Waline→candidate，并按当前候选网络namespace重新绑定测试relay。

最后一轮全部恢复运行，PG ready；本机隔离HTTPS `/`=200、匿名 `/api/me`=401。旧 `dc-admin-it-20261002-admin` 仍停止，未与候选并发写入。原运行候选配置、数据库及卷保留。

五项保护服务 `dcelysion-waline-1`、`dcelysion-password-reset-1`、`dcelysion-postgres-1`、`dc-umami`、`dc-umami-pg` 每轮监控及恢复核对均运行；正式PG healthy。没有修改正式后台、主站、DNS、Access、全局Nginx、媒体公开策略或正式Git。无任何容器/卷/数据库删除。

临时builder环境副本0600、目录0700，仅在试运行systemd用户unit注入新work-root和镜像；原受保护配置保留，token从未输出。恢复时停止本任务unit和移除本任务job容器，旧测试candidate不替换，所以无需数据库回退。回到原镜像只代表恢复旧配置，不代表原CLI可完成构建。

服务器连接严格校验既有ED25519指纹 `SHA256:+sHIpPqeHf/UAFIHfb7zPubSnli7bd7I7WhSlQaUjb4`；使用用户提供私钥，未显示或复制到源码。非秘密结果已回传final目录的evidence子目录；完整inspect、环境、账号等受保护文件未回传。

## 下一步与阶段二输入

1. 后续阶段可以接收本次完整可信后台候选包、固定输入摘要及构建证据；MDX失败不再是进入后续阶段的阻断。候选包已生成，不需要把可信后台打包与用户MDX构建混为一谈。
2. 后续部署仍需验证新候选实际运行、认证/存储等该阶段范围内的行为，不能把本次恢复旧测试candidate的健康结果当作新候选运行证明。
3. 依赖MDX的预览/发布动作保持禁用或明确返回不可用；不启动builder，不改用宿主MDX或fixture。仅用户重新明确恢复该功能时，才重新处理历史资源/输入限制。
4. 保留正式服务及必要测试联调/回退服务、配置与数据；不因跳过MDX而扩大清理范围。现有有效检查可复用，只有相关变化才补检查。

阶段二未启动、未新建对话。Git提交/推送、自动部署、正式腾讯release、DNS、Sites均未执行。
