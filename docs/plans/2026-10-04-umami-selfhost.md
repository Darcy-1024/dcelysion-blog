# 自建 Umami 与统一后台接入（2026-10-04）

腾讯自建 Umami 3.4.0 已部署，现有腾讯私有后台统计 API 已读取真实数据。正式主站尚未部署本次前台配置；Cloud 历史保留，不导出迁移、不与自建数字合并。

## 已部署资源与入口

- DNS：`stats.dcelysion.cn` A 指向 `124.220.196.115`，仅 DNS；本次创建新记录，未覆盖其他记录。
- 官方固定镜像：`ghcr.io/umami-software/umami:3.4.0@sha256:85909afc45bdcda1917394594a087421fdbb05610fded0fa9f6fb861abb2f367`。没有在服务器编译应用。
- 专用容器：`dc-umami` / `dc-umami-pg`，新数据卷 `dc-umami-pgdata`。PostgreSQL 17.11 复用现有固定镜像，但数据库实例及账号完全独立。应用角色 `umami_app` 非超级用户、无建库/建角色权限，仅拥有本实例 Umami 库/迁移 schema。
- 数据库不发布端口；应用仅宿主 `127.0.0.1:18300`。数据库网络 `dc-umami-internal` 为 internal；应用另有入口网络。为测试后台读取，仅将 Umami 连接到既有测试网络 `dc-admin-it-20261002-internal`，没有接入生产 Waline/PG 网络。
- Umami 384MiB、额外 swap128MiB、0.5CPU、128PID；PG192MiB、无额外swap、0.25CPU、128PID，25连接，应用池5连接。一次样本 Umami281.2MiB、PG29.6MiB，服务器可用872MiB；仅是低负载样本，不是压测或构建并发保证。
- `/script.js` 和 `POST/OPTIONS /api/send` 对真实访客公开。其他管理页面/API只允许回环连接；公网管理读取实测403。
- DNS01签发 TLS 成功，证书到期2027-01-01。HTTP01曾被引向其他地址，失败；没有关闭证书验证。沿用已安装 certbot-dns-cloudflare，并配置自动续期及 Nginx reload。新 vhost `dcelysion-umami`，无关 server 块未改。

Umami 网站 ID（非秘密）：`3317734c-d6c0-44f7-8e45-a2945dce43fd`；登记主域名 `blog.dcelysion.cn`。Cloud 历史 ID：`db010c0d-422d-49c6-8a89-6a0aa6b79c23`。

管理界面不是公网入口。操作员可建立 `ssh -N -L 127.0.0.1:18300:127.0.0.1:18300 <既有SSH连接参数>`，然后在本机访问 `http://127.0.0.1:18300`；凭据仅从受保护服务器文件读取。此电脑本轮19300隧道在本机TCP连接阶段超时，不能保证该电脑的转发可用，亦未改安全软件设置。看板的正式服务器读取不依赖该本机隧道。

## 凭据与真实只读权限

服务器 `/opt/dcelysion-umami` 为0700；应用、数据库、账号、看板和DNS续期配置为0600，未进入 Git/客户端。默认 admin/umami 已失效。

管理员持有专用团队和网站。`dashboard-reader` 系统角色 `view-only`，团队角色 `team-view-only`，长效 API key仅用于后台统计。不能将网站直接归属这个用户：3.4.0个人网站的写权限只检查所有者。实际 key读取统计成功、站点更新被拒绝、另一站点读取被拒绝；不声称 key只能调用三个API（仍有上游该账号自身的权限）。后台适配只发固定站点的 GET stats/pageviews/metrics。

`/opt/dcelysion-umami/dashboard.env` 是供统一正式上线消费的配置，API根为 `https://stats.dcelysion.cn/api`，但管理API公网受限；正式后台应通过同主机回环API，或受隔离Docker服务地址读取。切勿给公网请求解除管理限制。

当前私有测试后台使用同测试网络 `http://dc-umami:3000/api`，并明确设置 `ADMIN_UMAMI_ALLOW_INTERNAL_HTTP=1`。只允许这个固定Docker服务名，公网HTTP不因该开关获准。配置存放在测试挂载 `/it/state/umami.env`，文件0600、uid1000。

## 代码与部署范围

`ADMIN_UMAMI_SOURCE=cloud|self-hosted`；自建必须明确 API根和网站ID，不从 Cloud 身份猜测、不静默回落 mock。Cloud 原 API key及 `/v1` 协议保留，前台 `cloudWebsiteId` 仅用于历史兼容，不加载第二份采集脚本。缓存、并发合并、鉴权、区间UV和日期比较复用原实现。

3.4.0/PostgreSQL把已转换为请求时区的桶标签附上字面量Z。自建 mapper按北京时间壁钟标签解析，Cloud保持原规则。此适配针对已固定版本；升级时核对上游契约。

腾讯私有后台仅替换统计模块：原编译入口三个统计声明改名，导入独立 adapter；其余模块/环境/挂载/数据库保持原部署。旧入口为 `backend/admin/server/index.before-umami.mjs`；变更摘要位于 `/opt/dcelysion-umami/private-admin-patch.json`。没有将当前并行的R2/构建/发布实现打包覆盖服务器。正式后台仍待统一上线时正常构建整体源码，不把这次局部补丁作为最终源码包。

前台脚本改为 `https://stats.dcelysion.cn/script.js`。域名白名单包含 `blog.dcelysion.cn`、`dcelysion.cn`、`www.dcelysion.cn`；localhost、其他私有预览不采集。保留 Umami 原生 History监听，没有新增手动 Swup PV上报。回放仍关闭，其他统计供应商本任务未修改。

## 必要验证与限制

1. 公网严格TLS脚本200/application-javascript，管理API403；Nginx语法检查与受控reload成功。
2. 实际 Astro产物的代表页面首次访问、点击一次实际 Swup站内链接；QA响应临时将domains改为127.0.0.1并移除其他统计脚本，未手改dist。正式源码白名单不受QA覆盖影响。
3. PostgreSQL真实结果：两个合成路径各1PV、1个session。腾讯私有后台经真实合成Waline/2FA登录读取：PV2、UV1、visits1；7d趋势为北京时间2026-10-04午夜桶；今日明细为北京时间01:00小时桶、2PV，图轴00:00是区间起点；两个路径均1PV。匿名401、客户端websiteId覆盖400。
4. 统计测试5/5、后台类型/Svelte0错误0警告、后台Vite构建通过；Astro构建通过，最终产物明确包含主域名白名单。受影响统计文件局部Biome通过；已有Layout任务外格式/导入排序问题未全文件改写。

证据：服务器 `admin-evidence.json`、`private-admin-patch.json`；本地 `cache/umami-selfhost`。本机UI验证身份/评论/草稿为隔离fixture，统计通过SSH只读执行通道读取服务器真实API；不能将这些其他模块称为生产数据，也不把此通道称为本机普通fetch隧道已通过。

正式主站尚未切换：本轮没有Git提交/推送、主站release/自动部署、Sites同步/版本保存/部署。自建的两条合成验证数据保留并明确标为QA路径。主站正式部署后才记录正式采集切换时间；不伪造切换前的历史。

## 备份、恢复与回退

独立 `dc-umami-backup.timer` 北京时间每日03:45后0–120秒运行；不改现有Waline备份timer。`umami-backup.py` 用本实例operator生成custom-format dump、SHA256并检查pg_restore目录；本地根 `/opt/dcelysion-umami/backups` 为0700，无自动删除旧备份或统计数据。本地dump及格式检查成功。旧备份凭据返回401后，使用本次用户提供的新S3凭据，独立写入 `/opt/dcelysion-umami/backup-r2.conf`（0600），通过独立 `backup.env` 启用异地上传；现有Waline配置未改。rclone 1.60.1中移除导致上传后501的 `--s3-no-head-object`，保留对象HEAD；最终服务退出0，dump及SHA256文件上传至 `dcelysion-db-backups/database/umami/`，dump完整回读SHA256一致。最终dump `umami-20261004T030847Z.dump`，67536字节，SHA256 `dfe4642919a4c3b86feef95da477e18fbc78533e6ccdef3bad949161f3ad96ef`。每日任务已启用本地及R2备份。

恢复必须新建空目标库，不能覆盖现有数据。示例（只操作独立Umami实例，目标名称由操作员明确选择）：

```sh
docker exec dc-umami-pg createdb -U umami_operator -O umami_app umami_restore_YYYYMMDD
docker exec -i dc-umami-pg pg_restore -U umami_operator --role=umami_app --no-owner --no-privileges --exit-on-error -d umami_restore_YYYYMMDD < /opt/dcelysion-umami/backups/umami-TIMESTAMP.dump
```

恢复后只把新实例 DATABASE_URL 指向新库；原库保留。此轮仅验证备份格式，没有重跑完整恢复演练。

回退前台：恢复Cloud `websiteId` 与 `https://cloud.umami.is/script.js`，重新构建并通过统一发布路径上线；不可同时启用两份Umami。回退私有后台：恢复 `index.before-umami.mjs` 到入口，重启本任务测试admin；保留新统计库及API key配置供后续重新接入。暂停服务可停止 `dc-umami`，不删PG数据卷。回退当前补丁只影响私有统计模块；正式整体后台应使用对应release回退。

官方依据：[3.4.0发布](https://github.com/umami-software/umami/releases/tag/v3.4.0)、[认证](https://docs.umami.is/docs/api/authentication)、[网站权限](https://github.com/umami-software/umami/blob/v3.4.0/src/permissions/website.ts)、[趋势时区实现](https://github.com/umami-software/umami/blob/v3.4.0/src/lib/prisma.ts)。
