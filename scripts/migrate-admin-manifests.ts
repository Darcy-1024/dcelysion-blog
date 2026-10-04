// One-time trusted source migration. Never imported by the admin server.
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { galleryConfig } from "../src/config/galleryConfig";
import { musicPlayerConfig } from "../src/config/musicConfig";

const root = "src/config/manifests";
for (const name of ["music", "gallery", "settings"]) {
	try {
		await access(`${root}/${name}.json`);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
		throw cause;
	}
	throw new Error(
		"Manifest already exists; refusing to overwrite edited configuration",
	);
}
await mkdir(root, { recursive: true });
const write = (name: string, value: unknown) =>
	writeFile(`${root}/${name}.json`, `${JSON.stringify(value, null, 2)}\n`);
await write("music", {
	version: 1,
	tracks: (musicPlayerConfig.local?.playlist || []).map((track, i) => ({
		id: `track-${i + 1}`,
		...track,
	})),
});
const previews = JSON.parse(
	await readFile("src/constants/gallery-previews.json", "utf8"),
);
const albums = [];
for (const album of galleryConfig.albums) {
	const folder = `public/gallery/${album.id}`;
	const files = (await readdir(folder))
		.filter((f) => /\.(jpe?g|png|webp|avif|gif)$/i.test(f))
		.sort();
	const cover = files.findIndex((f) => /^cover\./i.test(f));
	if (cover > 0) files.unshift(...files.splice(cover, 1));
	const photos = [];
	for (const file of files) {
		const sha256 = createHash("sha256")
			.update(await readFile(`${folder}/${file}`))
			.digest("hex");
		const key = `${album.id}/${basename(file, extname(file))}-${sha256.slice(0, 8)}${extname(file)}`;
		const original = `${galleryConfig.assetBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
		const preview = previews.assets[key];
		photos.push({
			id: `photo-${sha256.slice(0, 16)}-${photos.length + 1}`,
			original,
			objectKey: key,
			sha256,
			...(preview
				? {
						preview: `${galleryConfig.assetBaseUrl}/${preview.objectKey.split("/").map(encodeURIComponent).join("/")}`,
						width: preview.width,
						height: preview.height,
					}
				: {}),
		});
	}
	try {
		for (const line of (await readFile(`${folder}/urls.txt`, "utf8"))
			.split("\n")
			.map((s) => s.trim())
			.filter((s) => s && !s.startsWith("#")))
			photos.push({ id: `external-${photos.length + 1}`, original: line });
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
	}
	albums.push({ ...album, photos });
}
await write("gallery", { version: 1, albums });
await write("settings", {
	version: 1,
	title: "DcElysion",
	subtitle: "blog",
	description: "God’s in his heaven，All’s right with the world",
	keywords: [
		"Elysion",
		"Firefly",
		"Fuwari",
		"Astro",
		"ACGN",
		"博客",
		"技术博客",
		"静态博客",
	],
	navbarTitle: "DcElysion",
});
