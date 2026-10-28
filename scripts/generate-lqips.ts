// LQIP 方案来源: https://blog.cosine.ren/post/astro-lqip-implementation

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { glob } from "glob";
import sharp from "sharp";

const SRC_DIR = "src";
const PUBLIC_DIR = "public";
const OUTPUT_FILE = "src/constants/lqips.json";
const METADATA_FILE = "cache/build/lqip-meta.json";
type Fingerprints = Record<string, { sourceHash: string; lqip: string }>;
// 需要忽略的目录（相对于项目根目录）
const IGNORE_DIRS = [
	"public/favicon/**",
	"public/pio/**",
	"public/assets/images/effects/**",
	"public/assets/music/**",
	"public/vndb-covers/**",
];

interface RgbColor {
	r: number;
	g: number;
	b: number;
}

type LqipMap = Record<string, string>;

function rgbToHex(color: RgbColor): string {
	const hex = (n: number) => n.toString(16).padStart(2, "0");
	return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

async function processImage(image: Buffer): Promise<string | null> {
	try {
		const { data, info } = await sharp(image)
			.resize(2, 2, { fit: "fill" })
			.raw()
			.toBuffer({ resolveWithObject: true });

		const channels = info.channels;
		const colors: RgbColor[] = [];

		for (let i = 0; i < 4; i++) {
			const offset = i * channels;
			colors.push({
				r: data[offset],
				g: data[offset + 1],
				b: data[offset + 2],
			});
		}

		// 使用 corners[0], [1], [3] 生成 135deg 斜向渐变
		const compact = `${rgbToHex(colors[0]).slice(1)}${rgbToHex(colors[1]).slice(1)}${rgbToHex(colors[3]).slice(1)}`;
		return compact;
	} catch (error) {
		console.error("Error processing image:", error);
		return null;
	}
}

function filePathToKey(filePath: string): string {
	if (filePath.startsWith(PUBLIC_DIR)) {
		return `public:${path.relative(PUBLIC_DIR, filePath).replace(/\\/g, "/")}`;
	}
	return `src:${path.relative(SRC_DIR, filePath).replace(/\\/g, "/")}`;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
	try {
		return JSON.parse(await fs.readFile(file, "utf-8"));
	} catch {
		return fallback;
	}
}

export async function generateLqips({
	root = process.cwd(),
	transform = processImage,
}: {
	root?: string;
	transform?: (image: Buffer) => Promise<string | null>;
} = {}): Promise<{ processed: number; total: number }> {
	const output = path.join(root, OUTPUT_FILE);
	const metadataFile = path.join(root, METADATA_FILE);
	const existing = await readJson<LqipMap>(output, {});
	const fingerprints = await readJson<Fingerprints>(metadataFile, {});
	const files = await glob("{src,public}/**/*.{png,jpg,jpeg,webp,avif}", {
		cwd: root,
		ignore: IGNORE_DIRS,
	});
	const currentKeys = new Set(files.map(filePathToKey));
	const lqips: LqipMap = Object.fromEntries(
		Object.entries(existing).filter(([key]) => currentKeys.has(key)),
	);
	const nextFingerprints: Fingerprints = {};
	let processed = 0;
	for (const file of files.sort()) {
		const key = filePathToKey(file);
		if (existing[key]) lqips[key] = existing[key];
		try {
			// Hash and decode the same bytes, preventing races with source replacement.
			const image = await fs.readFile(path.join(root, file));
			const sourceHash = createHash("sha256").update(image).digest("hex");
			const previous = fingerprints[key];
			if (
				existing[key] &&
				previous?.sourceHash === sourceHash &&
				previous.lqip === existing[key]
			) {
				nextFingerprints[key] = previous;
				continue;
			}
			const compact = await transform(image);
			if (compact !== null) {
				lqips[key] = compact;
				nextFingerprints[key] = { sourceHash, lqip: compact };
				processed++;
			}
		} catch (error) {
			console.error(`Error processing ${file}:`, error);
		}
		// Failed transforms retain the old visual fallback but no success
		// fingerprint, so the failed input will be retried next build.
	}
	await fs.mkdir(path.dirname(output), { recursive: true });
	await fs.writeFile(output, JSON.stringify(lqips, null, 2), "utf-8");
	await fs.mkdir(path.dirname(metadataFile), { recursive: true });
	await fs.writeFile(metadataFile, JSON.stringify(nextFingerprints, null, 2));
	console.log(
		`Done! Processed ${processed}/${files.length} images. Total: ${Object.keys(lqips).length}. Output: ${OUTPUT_FILE}`,
	);
	return { processed, total: files.length };
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
	generateLqips().catch((error) => {
		console.error("LQIP generation failed:", error);
		process.exitCode = 1;
	});
}
