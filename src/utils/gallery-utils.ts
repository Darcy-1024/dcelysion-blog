import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { GalleryAlbum, GalleryConfig } from "@/types/galleryConfig";
import { url } from "@/utils/url-utils";

type GalleryAssetOptions = Pick<
	GalleryConfig,
	"assetBaseUrl" | "assetVersioning"
>;

const contentHashCache = new Map<string, { signature: string; hash: string }>();

function withBase(assetPath: string): string {
	if (!assetPath) return "";
	if (/^(https?:)?\/\//i.test(assetPath) || /^(data|blob):/i.test(assetPath)) {
		return assetPath;
	}
	const normalizedPath = assetPath.startsWith("/")
		? assetPath
		: `/${assetPath}`;
	const base = import.meta.env.BASE_URL || "/";
	if (base !== "/" && normalizedPath.startsWith(base)) {
		return normalizedPath;
	}
	return url(normalizedPath);
}

function getContentHash(filePath: string): string {
	const stats = fs.statSync(filePath);
	const signature = `${stats.size}:${stats.mtimeMs}`;
	const cached = contentHashCache.get(filePath);
	if (cached?.signature === signature) return cached.hash;

	const hash = createHash("sha256")
		.update(fs.readFileSync(filePath))
		.digest("hex")
		.slice(0, 8);
	contentHashCache.set(filePath, { signature, hash });
	return hash;
}

function getRemoteFileName(
	fileName: string,
	filePath: string,
	versioning: GalleryConfig["assetVersioning"],
): string {
	if (versioning !== "content-hash") return fileName;
	const extension = path.extname(fileName);
	const stem = path.basename(fileName, extension);
	return `${stem}-${getContentHash(filePath)}${extension}`;
}

function buildRemoteAssetUrl(
	assetBaseUrl: string,
	relativePath: string,
): string {
	const encodedPath = relativePath
		.split("/")
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	return `${assetBaseUrl.replace(/\/+$/, "")}/${encodedPath}`;
}

function getLocalGalleryRelativePath(
	albumId: string,
	assetPath: string,
): string | null {
	const normalizedPath = assetPath.replace(/\\/g, "/");
	if (normalizedPath.startsWith("/gallery/")) {
		return normalizedPath.slice("/gallery/".length);
	}
	if (normalizedPath.startsWith("gallery/")) {
		return normalizedPath.slice("gallery/".length);
	}
	if (normalizedPath.startsWith("/")) return null;
	return `${albumId}/${normalizedPath.replace(/^\.\//, "")}`;
}

function resolveConfiguredCover(
	album: GalleryAlbum,
	options: GalleryAssetOptions,
): string {
	if (!album.cover) return "";
	if (
		/^(https?:)?\/\//i.test(album.cover) ||
		/^(data|blob):/i.test(album.cover)
	) {
		return album.cover;
	}
	if (!options.assetBaseUrl) return withBase(album.cover);

	const relativePath = getLocalGalleryRelativePath(album.id, album.cover);
	if (!relativePath) return withBase(album.cover);

	const galleryRoot = path.resolve(process.cwd(), "public", "gallery");
	const localFilePath = path.resolve(
		galleryRoot,
		...relativePath.split("/").filter(Boolean),
	);
	const galleryRootPrefix = `${galleryRoot}${path.sep}`;
	if (
		!localFilePath.startsWith(galleryRootPrefix) ||
		!fs.existsSync(localFilePath) ||
		!fs.statSync(localFilePath).isFile()
	) {
		return withBase(album.cover);
	}

	const directory = path.posix.dirname(relativePath);
	const remoteFileName = getRemoteFileName(
		path.posix.basename(relativePath),
		localFilePath,
		options.assetVersioning,
	);
	const remotePath =
		directory === "." ? remoteFileName : `${directory}/${remoteFileName}`;
	return buildRemoteAssetUrl(options.assetBaseUrl, remotePath);
}

/**
 * 扫描相册目录中的所有图片文件
 */
export function scanAlbumPhotos(
	albumId: string,
	options: GalleryAssetOptions = {},
): string[] {
	const dir = path.join(process.cwd(), "public", "gallery", albumId);
	if (!fs.existsSync(dir)) return [];
	const files = fs
		.readdirSync(dir)
		.filter((f) => /\.(jpe?g|png|webp|avif|gif)$/i.test(f))
		.sort();
	// 将 cover.* 排到第一位
	const coverIdx = files.findIndex((f) => /^cover\./i.test(f));
	if (coverIdx > 0) {
		const [coverFile] = files.splice(coverIdx, 1);
		files.unshift(coverFile);
	}
	const localPhotos = files.map((fileName) => {
		if (!options.assetBaseUrl) {
			return withBase(`/gallery/${albumId}/${fileName}`);
		}
		const filePath = path.join(dir, fileName);
		const remoteFileName = getRemoteFileName(
			fileName,
			filePath,
			options.assetVersioning,
		);
		return buildRemoteAssetUrl(
			options.assetBaseUrl,
			`${albumId}/${remoteFileName}`,
		);
	});

	// 读取 urls.txt 中的远程图片 URL
	const urlsFile = path.join(dir, "urls.txt");
	let remotePhotos: string[] = [];
	if (fs.existsSync(urlsFile)) {
		remotePhotos = fs
			.readFileSync(urlsFile, "utf-8")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#"));
	}

	return [...localPhotos, ...remotePhotos];
}

/**
 * 获取相册封面图
 * 优先级：手动指定 > cover.* 文件 > 第一张图片
 */
export function getAlbumCover(
	album: GalleryAlbum,
	photos: string[],
	options: GalleryAssetOptions = {},
): string {
	if (album.cover) return resolveConfiguredCover(album, options);
	const coverFile = photos.find((photo) =>
		/(?:^|\/)cover(?:-[0-9a-f]{8})?\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(
			photo,
		),
	);
	return coverFile || photos[0] || "";
}

/**
 * 将本站 R2 相册 URL 映射回本地 public/gallery 路径，继续复用构建期 LQIP。
 */
export function getGalleryLqipSource(
	assetUrl: string,
	options: GalleryAssetOptions = {},
): string {
	if (!assetUrl || !options.assetBaseUrl) return assetUrl;

	try {
		const baseUrl = new URL(`${options.assetBaseUrl.replace(/\/+$/, "")}/`);
		const remoteUrl = new URL(assetUrl);
		const basePath = baseUrl.pathname.endsWith("/")
			? baseUrl.pathname
			: `${baseUrl.pathname}/`;
		if (
			remoteUrl.origin !== baseUrl.origin ||
			!remoteUrl.pathname.startsWith(basePath)
		) {
			return assetUrl;
		}

		const relativePath = remoteUrl.pathname
			.slice(basePath.length)
			.split("/")
			.filter(Boolean)
			.map((segment) => decodeURIComponent(segment));
		if (relativePath.length < 2) return assetUrl;

		if (options.assetVersioning === "content-hash") {
			const fileName = relativePath.at(-1);
			if (!fileName) return assetUrl;
			relativePath[relativePath.length - 1] = fileName.replace(
				/-[0-9a-f]{8}(?=\.[^.]+$)/i,
				"",
			);
		}

		return `/gallery/${relativePath.join("/")}`;
	} catch {
		return assetUrl;
	}
}
