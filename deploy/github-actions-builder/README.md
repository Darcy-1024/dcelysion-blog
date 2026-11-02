# 后台私有云端构建仓库

本目录是专用 **GitHub 私有仓库** 的可信源码；部署时将 `build.yml` 放到 `.github/workflows/build.yml`，其余文件保持相对目录。仓库默认分支固定为 `main`，后台额外固定该分支提交 SHA；主分支被修改后，必须由操作员核对并更新后台配置才会继续接受构建。

工作流仅接受 `workflow_dispatch`，没有 push、PR 或定时触发。输入为 `jobId`、`attemptId`、`releaseId` 和 `inputSha256`；运行名称为 `build-<jobId>-<attemptId>`。后台在此私有仓库创建 `job-<jobId>` 的普通 prerelease（不是 draft），上传 `input-<inputSha256>.tar.gz`，然后触发固定主分支工作流。工作流校验仓库为 private、release 标签、asset 大小以及完整压缩包 SHA256 后再构建。

输入压缩包及解包内容上限均为 1 GiB。三个依赖配置必须与本目录 `dependencies/` 内操作员维护的副本逐字节一致；依赖更新后需要同步这些可信副本并更新工作流固定 SHA，不能由草稿自行修改依赖。依赖准备阶段仅使用 `.dockerignore` 允许的可信 Dockerfile、入口与依赖文件。

执行 Markdown/MDX 的容器使用当前步骤准备好的不可变镜像 ID，断网、只读根文件系统、非 root、无 capabilities、禁止提权，无 Git、数据库、R2、SSH、GitHub token 或宿主目录挂载。资源限制为 4 GiB 内存、2 CPU、256 PIDs、20 分钟；工作区为 2 GiB tmpfs，临时目录为 64 MiB tmpfs。输入从 stdin 送入，输出仅从 stdout 送出压缩包；任意内容执行日志直接丢弃，不进入公开日志。

可信宿主步骤再次检查输出路径、文件类型、重复条目、数量和 1 GiB 解包预算，确认首页存在后才上传 `build-<jobId>` artifact。压缩包本身也限制为 1 GiB；artifact 内仅含 `artifact.tar.gz`，保留一天。后台必须绑定精确运行名、工作流固定 SHA 与对应 artifact，下载校验后才能进入公开仓库推送阶段。

私有 release 含未公开草稿，不能将该仓库改为 public，也不能把相关输入包复制到公开博客。工作流 token 只有 contents read，且只在下载步骤提供；容器构建步骤不接收 token。输入 release 与任务回执的保留/删除由后台操作员统一管理。
