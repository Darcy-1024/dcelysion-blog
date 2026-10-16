# Waline 登录与后台品牌样式

适用于固定 `@waline/admin@0.34.2`，不修改上游 bundle、认证、API 或数据库。登录、注册、个人资料与 Waline 管理页共用页头；本目录替换其标志、favicon、颜色、卡片和表单样式。独立找回密码页面与博客内评论组件不在本次范围。

- `wordmark.png` / `wordmark-dark.png` 原样复制自 `public/assets/brand/dcelysion-portal-v3*.png`。
- `favicon.png` 原样复制自 `public/favicon/dc-mark-v2-64.png`。
- 色相 308、明暗主题颜色与圆角取自博客当前配置。跨域页面不能读取博客显示设置，这里按系统明暗偏好切换。
- 保留原品牌文本供读屏使用，替换显示图像；保留原导航、上游致谢及所有操作。

## 发布时安装

本次仅准备本地文件，未发布。取得目标服务器发布授权后，将本目录与 `install-waline-brand.sh` 上传到同一部署目录，先运行 `bash install-waline-brand.sh` 安装同源 `/admin-assets/brand-v1/` 资源，再将对应 Nginx 配置中的品牌 stylesheet、favicon 和 title 三项注入合入服务器当前配置。公网评论域、私有预览与 Access 后台三份模板都已加入引用；不要用私有预览安装器覆盖当前公网配置。

备份服务器配置，执行 `nginx -t` 成功后 reload。此改动无需重建镜像、操作数据库或更改监听/Access。验证资源 HTTP 与文件哈希、登录/注册页，以及已登录的评论管理/用户管理/个人资料页；核对窄屏、明暗模式和已有头像裁剪浮层。不要为视觉验收提交真实评论、改密码或修改用户。

资源路径按不可变文件处理：上线后的修改须换版本目录及注入路径。回退时移除品牌 CSS、favicon 和 title 注入；保留显示密码与头像上传脚本及现有安全配置。
