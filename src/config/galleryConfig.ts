import type { GalleryConfig } from "@/types/galleryConfig";

const galleryAssetBaseUrl = "https://gallery.dcelysion.cn";

// 相册配置
export const galleryConfig: GalleryConfig = {
	// public/gallery 继续作为构建清单、LQIP 和回滚副本；浏览器从 R2 自定义域读取图片
	assetBaseUrl: galleryAssetBaseUrl,
	// 远端文件名加入内容哈希，允许安全使用长期 immutable 缓存
	assetVersioning: "content-hash",

	// 相册列表
	albums: [
		// 支持jpg/png/webp/avif/gif格式
		// id: 相册唯一标识符（用于目录命名、URL路径和 R2 对象前缀），比如设置：id: "firefly-2026", 对应 public/gallery/firefly-2026/目录
		// cover: 手动指定封面图（可选，不填会把cover.*文件作为封面图，如果没有cover.*文件，则使用第一张图片作为封面图）
		// name: 相册名称
		// description: 相册描述
		// location: 相册拍摄地点
		// date: 相册日期，格式为 YYYY-MM-DD，用于排序和显示
		// tags: 相册标签，用于分类和过滤
		// password: 访问密码，设置后需要输入密码才能查看相册内容（可选）
		// passwordHint: 密码提示，设置后在输入密码错误时显示（可选，需配合password使用）
		// 每添加一个数组项就相当于添加了一个相册；先在 public/gallery/ 创建对应子目录，再把图片上传到配置的远端资源地址
		{
			id: "wallpaper-2026",
			name: "封面合集",
			description: "网站封面图合集，包含了网站使用的所有封面图。",
			location: "wallpaper",
			date: "2026-07-09",
			tags: ["插画", "壁纸", "合集"],
		},
		/*
		{
			id: "encrypted-test",
			name: "加密相册示例",
			description:
				"这是一个加密相册的示例，设置了访问密码，只有输入正确的密码才能查看相册内容。",
			location: "崩坏：星穹铁道",
			date: "2026-02-01",
			tags: ["加密相册", "示例"],
			password: "123456",
			passwordHint: "示例密码123456",
		},
		*/
	],

	// 瀑布流最小列宽(px)，浏览器根据容器宽度自动计算列数，默认 240
	// 值越小列数越多，值越大列数越少
	columnWidth: 240,
};
