# DcElysion Waline overlay

基于腾讯固定 **Waline 1.41.6**（镜像摘要见 `../Dockerfile.waline-reset`），与管理客户端 **0.34.2** 配套。基础鉴权、昵称、通知和找回密码部署边界见 `../README.md`。本目录源码覆盖同版本镜像的 `/app/src/`，不升级上游。本阶段新增代码仅本地验证，尚未构建/安装真实镜像。

## management-v1（第六阶段）

- `logic/management.js`：只允许当前 Waline administrator 的 GET；其他方法405。page/pageSize、正整数ID及搜索/路径/状态有界。
- `controller/management.js` + `lib/management-read.js`：仅通过现有 `getModel('Comment'/'Users')` select/count 读取，固定字段及排序。提供评论分页总数、原始正文、正文搜索、精确路径/user_id/状态过滤；用户昵称/邮箱搜索、详情；线程限定同一url的根/回复，删除数量使用上游实际 objectId/pid/rid OR 条件。每次复制 field 数组，因为固定 SQL adapter 会 push id。密码、2FA、IP、user-agent等不进入读取 DTO。用户 auth_version 仅供服务端条件更新/指纹，新后台不透传。
- 新后台写评论仍走原 `/api/comment` POST/PUT/DELETE。原服务删除自身、pid或rid指向目标的回复；审批待审回复和新回复可能触发原通知/hooks。不要把“回复接口返回超时”当作未落库或未发邮件。
- `controller/user.js` 的 `_managementState` 分支只允许 administrator 管理其他 guest/banned，校验 expectedType/expectedVersion；不走上游 DELETE（其可能删除未验证用户）。`service/storage/postgresql.js` 基于官方 [@waline/vercel 1.41.6 npm 源码](https://registry.npmjs.org/@waline/vercel/-/vercel-1.41.6.tgz)，保留原实现并添加单条匹配id/type/auth_version的UPDATE。上游普通 update()是先SELECT再按id UPDATE，不能拿它伪称CAS。新方法同时递增auth_version，防止封禁后解禁复用旧JWT。其他storage没有该方法时明确拒绝状态变更。
- `003_security_version.sql` 是已有 password-reset 迁移之后的增量补丁，给密码/邮箱版本触发器增加type及`"2fa"`实际变化；原重置链接撤销触发器继续消费版本变化。该补丁涉及真实数据库，需部署阶段授权；不能仅改旧迁移来假设已安装环境生效。

PostgreSQL适配器复制自固定官方版本，遵循GPL-2.0并保留项目既有 `../vendor/LICENSE`。其余新增接口与后台接入说明见 `../../../admin/README.md` 第六阶段。管理令牌不进入浏览器；本人改密先通过原 `/api/token` 当前密码/二步码再认证。安全页 `/ui/profile` 仍使用现有Waline管理脚本处理二步验证，新后台用服务端 `ADMIN_WALINE_SECURITY_URL` 区分浏览器入口与内网API地址；未配置时不显示无效入口。

本地验证：`node --test deploy/tencent/waline-overlay/management.test.cjs`（3项）检查只读鉴权/最小字段、实际隔离PGlite版本触发器、条件更新在目标已提升管理员时拒绝。修改JS均做 `node --check`。这不等于完整ThinkJS/Waline HTTP实例、真实PostgreSQL或邮件通知联调。没有生产评论/用户/会话写入、数据库迁移或部署。
