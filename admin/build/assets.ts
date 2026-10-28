/// <reference path="../../scripts/subset-font.d.ts" />
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import subsetFont from "subset-font";
import type { Plugin } from "vite";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = join(root, "cache/admin-assets");

/** Read Unicode cmap tables from the local SFNT source; retain every mapped character. */
export function fontCodepoints(font: Buffer): number[] {
	let cmap = -1;
	for (let i = 0; i < font.readUInt16BE(4); i++) {
		const record = 12 + i * 16;
		if (font.toString("ascii", record, record + 4) === "cmap")
			cmap = font.readUInt32BE(record + 8);
	}
	if (cmap < 0) throw new Error("MiSans has no cmap");
	const points = new Set<number>();
	for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
		const record = cmap + 4 + i * 8;
		const platform = font.readUInt16BE(record);
		const encoding = font.readUInt16BE(record + 2);
		if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
		const table = cmap + font.readUInt32BE(record + 4);
		const format = font.readUInt16BE(table);
		if (format === 12) {
			for (let g = 0; g < font.readUInt32BE(table + 12); g++) {
				const group = table + 16 + g * 12;
				const start = font.readUInt32BE(group);
				const end = font.readUInt32BE(group + 4);
				const glyph = font.readUInt32BE(group + 8);
				for (let cp = start; cp <= end; cp++) if (glyph + cp - start) points.add(cp);
			}
		} else if (format === 4) {
			const count = font.readUInt16BE(table + 6) / 2;
			for (let segment = 0; segment < count; segment++) {
				const end = font.readUInt16BE(table + 14 + segment * 2);
				const start = font.readUInt16BE(table + 16 + count * 2 + segment * 2);
				const delta = font.readInt16BE(table + 16 + count * 4 + segment * 2);
				const offsetAt = table + 16 + count * 6 + segment * 2;
				const offset = font.readUInt16BE(offsetAt);
				for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
					const raw = offset ? font.readUInt16BE(offsetAt + offset + (cp - start) * 2) : cp;
					const glyph = offset && !raw ? 0 : (raw + delta) & 0xffff;
					if (glyph) points.add(cp);
				}
			}
		}
	}
	if (!points.size) throw new Error("MiSans Unicode cmap is empty or unsupported");
	return [...points].sort((a, b) => a - b);
}

export function unicodeRange(points: number[]): string {
	const ranges: string[] = [];
	for (let i = 0; i < points.length; i++) {
		const start = points[i];
		while (i + 1 < points.length && points[i + 1] === points[i] + 1) i++;
		const end = points[i];
		ranges.push(`U+${start.toString(16)}${end === start ? "" : `-${end.toString(16)}`}`);
	}
	return ranges.join(",");
}

export function splitCodepoints(points: number[], text: string): number[][] {
	const common = new Set([...text].map((char) => char.codePointAt(0)!));
	const core = points.filter((cp) => cp < 256 || common.has(cp));
	const other = points.filter((cp) => cp >= 256 && !common.has(cp));
	const groups = [core];
	for (let i = 0; i < other.length; i += 256) groups.push(other.slice(i, i + 256));
	return groups.filter((group) => group.length);
}

async function prepare() {
	const client = join(root, "admin/client");
	const files = (await readdir(client)).filter((name) => /\.(svelte|ts)$/.test(name)).sort();
	const text = (await Promise.all(files.map((name) => readFile(join(client, name), "utf8")))).join("\n");
	const font = await readFile(join(root, "public/assets/fonts/MiSansVF.ttf"));
	const logos = await Promise.all(["dcelysion-portal-v3.png", "dcelysion-portal-v3-dark.png"].map((name) => readFile(join(root, "public/assets/brand", name))));
	const signature = createHash("sha256").update(font).update(text).update(await readFile(fileURLToPath(import.meta.url))).update(await readFile(join(root, "pnpm-lock.yaml")));
	for (const logo of logos) signature.update(logo);
	const key = signature.digest("hex");
	try {
		const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
		if (manifest.key === key) {
			await Promise.all(manifest.files.map((name: string) => readFile(join(output, name))));
			return;
		}
	} catch { /* Missing/incomplete cache is rebuilt from source. */ }
	await mkdir(output, { recursive: true });
	const groups = splitCodepoints(fontCodepoints(font), text);
	const generated: string[] = [];
	const css: string[] = [];
	for (let i = 0; i < groups.length; i++) {
		const name = `misans-${i === 0 ? "ui" : i}.woff2`;
		const bytes = await subsetFont(font, String.fromCodePoint(...groups[i]), { targetFormat: "woff2" });
		await writeFile(join(output, name), bytes);
		generated.push(name);
		css.push(`@font-face{font-family:"MiSans";src:url("./${name}") format("woff2");font-weight:100 900;font-style:normal;font-display:swap;unicode-range:${unicodeRange(groups[i])}}`);
	}
	await writeFile(join(output, "misans.css"), `${css.join("\n")}\n`);
	generated.push("misans.css");
	for (let i = 0; i < logos.length; i++) {
		const name = i === 0 ? "logo-light.webp" : "logo-dark.webp";
		await sharp(logos[i]).resize({ width: 660, withoutEnlargement: true }).webp({ lossless: true }).toFile(join(output, name));
		generated.push(name);
	}
	await writeFile(join(output, "manifest.json"), JSON.stringify({ key, files: generated, codepoints: groups.flat().length, shards: groups.length }));
	console.log(`Admin assets: MiSans preserved in ${groups.length} WOFF2 shards; logos resized for 3x displays.`);
}

export function adminAssets(): Plugin {
	return { name: "admin-local-assets", buildStart: prepare };
}
