import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { galleryConfig } from "../src/config/galleryConfig";

const GALLERY_ROOT = path.resolve("public", "gallery");
const OUTPUT_ROOT = path.resolve(".gallery-previews");
const MANIFEST_FILE = path.resolve("src", "constants", "gallery-previews.json");
const PREVIEW_DIRECTORY = "_previews";
const PREVIEW_WIDTH = 1200;
const AVIF_QUALITY = 70;
const AVIF_EFFORT = 6;
const CONCURRENCY = 2;
const IMAGE_PATTERN = /\.(jpe?g|png|webp|avif|gif)$/i;

interface GalleryPreviewAsset {
	objectKey: string;
	width: number;
	height: number;
	bytes: number;
	sha256: string;
	sourceSha256: string;
}

interface GalleryPreviewManifest {
	version: 1;
	transform: {
		width: number;
		format: "avif";
		quality: number;
		effort: number;
	};
	assets: Record<string, GalleryPreviewAsset>;
}

interface PreviewJob {
	albumId: string;
	fileName: string;
	sourcePath: string;
}

interface PreviewResult {
	originalObjectKey: string;
	asset: GalleryPreviewAsset;
	reused: boolean;
	sourceBytes: number;
}

function getSha256(data: Buffer): string {
	return createHash("sha256").update(data).digest("hex");
}

function getOriginalObjectKey(
	albumId: string,
	fileName: string,
	sourceHash: string,
): string {
	if (galleryConfig.assetVersioning !== "content-hash") {
		return path.posix.join(albumId, fileName);
	}

	const extension = path.extname(fileName);
	const stem = path.basename(fileName, extension);
	return path.posix.join(
		albumId,
		`${stem}-${sourceHash.slice(0, 8)}${extension}`,
	);
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function readPreviousManifest(): Promise<GalleryPreviewManifest | null> {
	try {
		const content = await fs.readFile(MANIFEST_FILE, "utf-8");
		const manifest = JSON.parse(content) as GalleryPreviewManifest;
		if (
			manifest.version !== 1 ||
			manifest.transform.width !== PREVIEW_WIDTH ||
			manifest.transform.format !== "avif" ||
			manifest.transform.quality !== AVIF_QUALITY ||
			manifest.transform.effort !== AVIF_EFFORT
		) {
			return null;
		}
		return manifest;
	} catch {
		return null;
	}
}

async function collectJobs(): Promise<PreviewJob[]> {
	const jobs: PreviewJob[] = [];
	for (const album of galleryConfig.albums) {
		const albumDirectory = path.join(GALLERY_ROOT, album.id);
		let entries: string[];
		try {
			entries = await fs.readdir(albumDirectory);
		} catch {
			console.warn(
				`[Gallery previews] Album directory not found: ${albumDirectory}`,
			);
			continue;
		}

		for (const fileName of entries
			.filter((entry) => IMAGE_PATTERN.test(entry))
			.sort()) {
			jobs.push({
				albumId: album.id,
				fileName,
				sourcePath: path.join(albumDirectory, fileName),
			});
		}
	}
	return jobs;
}

async function generatePreview(
	job: PreviewJob,
	previousManifest: GalleryPreviewManifest | null,
): Promise<PreviewResult> {
	const sourceBuffer = await fs.readFile(job.sourcePath);
	const sourceHash = getSha256(sourceBuffer);
	const originalObjectKey = getOriginalObjectKey(
		job.albumId,
		job.fileName,
		sourceHash,
	);
	const cached = previousManifest?.assets[originalObjectKey];
	if (cached?.sourceSha256 === sourceHash) {
		const cachedPath = path.join(OUTPUT_ROOT, ...cached.objectKey.split("/"));
		if (await fileExists(cachedPath)) {
			const stats = await fs.stat(cachedPath);
			const cachedBuffer =
				stats.size === cached.bytes ? await fs.readFile(cachedPath) : null;
			if (cachedBuffer && getSha256(cachedBuffer) === cached.sha256) {
				return {
					originalObjectKey,
					asset: cached,
					reused: true,
					sourceBytes: sourceBuffer.length,
				};
			}
		}
	}

	const { data, info } = await sharp(sourceBuffer)
		.rotate()
		.resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
		.avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT })
		.toBuffer({ resolveWithObject: true });
	const previewHash = getSha256(data);
	const extension = path.extname(job.fileName);
	const stem = path.basename(job.fileName, extension);
	const previewFileName = `${stem}-${sourceHash.slice(0, 8)}-w${PREVIEW_WIDTH}-${previewHash.slice(0, 8)}.avif`;
	const objectKey = path.posix.join(
		job.albumId,
		PREVIEW_DIRECTORY,
		previewFileName,
	);
	const outputPath = path.join(OUTPUT_ROOT, ...objectKey.split("/"));
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, data);

	return {
		originalObjectKey,
		asset: {
			objectKey,
			width: info.width,
			height: info.height,
			bytes: data.length,
			sha256: previewHash,
			sourceSha256: sourceHash,
		},
		reused: false,
		sourceBytes: sourceBuffer.length,
	};
}

async function mapLimit<T, R>(
	items: T[],
	limit: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;
	const workers = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			while (nextIndex < items.length) {
				const currentIndex = nextIndex;
				nextIndex += 1;
				results[currentIndex] = await worker(items[currentIndex], currentIndex);
			}
		},
	);
	await Promise.all(workers);
	return results;
}

async function main() {
	const previousManifest = await readPreviousManifest();
	const jobs = await collectJobs();
	console.log(
		`[Gallery previews] Generating ${jobs.length} preview(s) at up to ${PREVIEW_WIDTH}px...`,
	);

	const results = await mapLimit(jobs, CONCURRENCY, async (job, index) => {
		const result = await generatePreview(job, previousManifest);
		console.log(
			`[Gallery previews] ${index + 1}/${jobs.length} ${job.albumId}/${job.fileName}${result.reused ? " (cached)" : ""}`,
		);
		return result;
	});

	const assets = Object.fromEntries(
		results
			.sort((a, b) => a.originalObjectKey.localeCompare(b.originalObjectKey))
			.map((result) => [result.originalObjectKey, result.asset]),
	);
	const manifest: GalleryPreviewManifest = {
		version: 1,
		transform: {
			width: PREVIEW_WIDTH,
			format: "avif",
			quality: AVIF_QUALITY,
			effort: AVIF_EFFORT,
		},
		assets,
	};
	await fs.mkdir(path.dirname(MANIFEST_FILE), { recursive: true });
	await fs.writeFile(
		MANIFEST_FILE,
		`${JSON.stringify(manifest, null, "\t")}\n`,
		"utf-8",
	);

	const sourceBytes = results.reduce(
		(total, result) => total + result.sourceBytes,
		0,
	);
	const previewBytes = results.reduce(
		(total, result) => total + result.asset.bytes,
		0,
	);
	const generated = results.filter((result) => !result.reused).length;
	console.log(
		`[Gallery previews] Done: ${generated} generated, ${results.length - generated} cached, ${(sourceBytes / 1024 / 1024).toFixed(2)} MiB originals -> ${(previewBytes / 1024 / 1024).toFixed(2)} MiB previews.`,
	);
	console.log(`[Gallery previews] Upload root: ${OUTPUT_ROOT}`);
	console.log(`[Gallery previews] Manifest: ${MANIFEST_FILE}`);
}

main().catch((error) => {
	console.error("[Gallery previews] Failed:", error);
	process.exitCode = 1;
});
