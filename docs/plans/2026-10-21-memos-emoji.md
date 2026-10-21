# Memos “＋ → 插入表情”上线记录

日期：2026-10-21（Asia/Shanghai）。用户指定在原版编辑器左下角“＋”菜单新增表情入口，内嵌及新窗口共用。此前的受控发布与统一登录结果见[生产验收记录](2026-10-21-memos-production-acceptance.md)。

## 改动

- 在附件、图片、录音、链接备忘录、位置之后新增“插入表情”。纯 Unicode 面板支持中文/英文关键词搜索，简体、繁体中文及英文文案；其他语言的新键使用英文兜底，原有译文保留。
- 使用 CodeMirror transaction 原生插入，不操作 contenteditable DOM。无选区时在光标处插入，有选区时替换，继续输入及撤销/重做沿用编辑器机制。关闭面板后恢复编辑器焦点；没有新增远程表情服务或 npm 依赖。
- 固定上游源码 `2b2192d4e153bd04f1d325b60fd880cf00d68b01`，只构建前端，不重编 Go 或替换数据容器。源码补丁、输入摘要、可复现构建入口及许可证说明在 [deploy/memos/frontend](../../deploy/memos/frontend/README.md)。补丁 SHA-256：`8e827c1ea05006b727f005e5b3282cb08105808750cc32f2050d1e88251d44ee`。
- 后台网关启动时校验前端文件清单并载入有界内存。新脚本/样式/图片仍受逐请求后台身份检查及刷新身份复核保护；HTML 只在原上游成功返回页面时替换。旧哈希资源、API 和附件继续沿用原代理。没有添加公开静态目录。

## 验证

- 后台网关及配置定向测试 **17/17**，包括新前端的未登录拒绝、会话撤销、HEAD、路径边界、原上游跳转拒绝、文件摘要与不可变读取。后台 TypeScript 与限定 Biome 检查通过。
- 上游前端 `pnpm lint` 通过（含 TypeScript 和 673 个源码/测试文件的 Biome 检查）；最终新增的其他语言键另经 locales 检查通过。
- 编辑器、插入菜单与格式工具栏 **16/16**，覆盖中文搜索选择、菜单顺序、原生光标/选区插入、连续输入和撤销/重做。语言资源 **95/95**；源码补丁在原始归档上 `git apply --check --unidiff-zero` 通过。
- 全套上游测试尝试中已有 387 项通过，语言资源扫描受 0.75 CPU 限额触发默认 5 秒超时而停止；该项改用 20 秒测试超时后发现并补齐全部语言新键，95 项复测通过。未宣称剩余未执行的全套用例通过。
- 构建镜像默认 `NODE_ENV=production` 不适合 React 测试，已仅在测试命令中设置 test；正式构建仍为 production。可选 Biome Linux 二进制下载失败后，从镜像取得相同版本，SHA-512 与上游锁文件完全一致，未修改产品依赖。
- Node 24.20.0 / pnpm 11.0.1 / Vite 8.0.11 正式前端构建通过。300 个文件，12,646,037 字节，完整清单 SHA-256：`cc833f5ca497e7a08f00690520b8507643fa668c2cf0ee5684b7a11151a72cb7`。

## 部署结果

通过 [update-memos-frontend.py](../../deploy/memos/update-memos-frontend.py) 的 prepare/activate 发布：

- 新后台 release：`/opt/dcelysion-admin-stage2/releases/20261021-memos-emoji`。
- 后台 bundle SHA-256：`efceabc196491e2490d61be57462805597645780d123fa1859a8b9743d7e357c`。
- 旧容器 `dc-admin-formal-before-memos-emoji-20261021` 停止保留，旧 release 也保留。原镜像、UID、只读根目录、两网络及 IP、私有凭据挂载均保留；运行环境只增加 `ADMIN_MEMOS_FRONTEND_DIRECTORY=/app/backend/memos-ui`，原 runtime.env 文件不改写。新增环境保存在本次私有 operator 环境快照和容器配置中。
- 整份 release 摘要和真实 Linux sealed loader 通过。rootless builder 不能遍历私有 release 父目录时，使用只包含公开前端文件的构建检查副本，未放宽原私有目录权限。
- 容器内及公网 HTTPS 根页面、API、新 JS 和 index 的匿名访问均为 **401**，响应 `private, no-store`。自动发布 timer 保持运行，未改写 memo 或触发内容公开。

后台程序切换会清空临时 Memos 桥会话；在已登录后台中重新载入 Memos 入口可重建会话。浏览器自动化当前因运行环境缺失无法连接，实际浏览器菜单点击、焦点及保存回读尚待用户使用确认，未由构建或匿名检查冒充通过。浏览器上传仍未测，退出人工验收按用户此前要求跳过。
