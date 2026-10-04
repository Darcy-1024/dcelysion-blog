import type { GalleryConfig } from "@/types/galleryConfig";
import { albumsFromManifest } from "./manifest-adapters";
import galleryManifest from "./manifests/gallery.json";

const galleryAssetBaseUrl = "https://gallery.dcelysion.cn";

// 相册配置
export const galleryConfig: GalleryConfig = {
	// public/gallery 继续作为构建清单、LQIP 和回滚副本；浏览器从 R2 自定义域读取图片
	assetBaseUrl: galleryAssetBaseUrl,
	// 远端文件名加入内容哈希，允许安全使用长期 immutable 缓存
	assetVersioning: "content-hash",

	// 相册列表
	albums: albumsFromManifest(galleryManifest),

	// 瀑布流最小列宽(px)，浏览器根据容器宽度自动计算列数，默认 240
	// 值越小列数越多，值越大列数越少
	columnWidth: 240,
};
