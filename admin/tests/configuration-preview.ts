// Explicit isolated stage-five browser fixture; never imported by production.
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { Media } from "../shared/media.js";
import { configurationFixture, fixtureWav } from "./configuration-fixture.js";

const port = Number(process.env.ADMIN_CONFIGURATION_FIXTURE_PORT || 4327);
const f = await configurationFixture(port);
const wav = fixtureWav();
const audio = await f.media.upload(
	7,
	randomUUID(),
	"隔离试听.wav",
	wav.length,
	Readable.from([wav]),
	"music",
);
const photos: Media[] = [];
for (const color of ["#659ad4", "#c5859b"]) {
	const png = await sharp({
		create: { width: 160, height: 100, channels: 3, background: color },
	})
		.png()
		.toBuffer();
	photos.push(
		await f.media.upload(
			7,
			randomUUID(),
			`隔离图片-${photos.length + 1}.png`,
			png.length,
			Readable.from([png]),
			"gallery",
		),
	);
}
await f.media.idle();
// Public fixture assets use same-origin paths; private media stays behind the API.
f.baseline.music.tracks[0].url = "/__fixture/audio.wav";
f.baseline.music.tracks[0].cover = "/__fixture/image.png";
f.baseline.gallery.albums[0].photos[0].original = "/__fixture/image.png";
f.baseline.gallery.albums[0].photos[0].preview = "/__fixture/preview.webp";
for (const kind of ["music", "gallery", "settings"] as const)
	await writeFile(
		resolve(f.root, `src/config/manifests/${kind}.json`),
		`${JSON.stringify(f.baseline[kind], null, 2)}\n`,
	);
await f.git(["add", "--", "src/config/manifests"]);
await f.git(["commit", "-m", "test: local browser media"]);
await f.git(["push", f.target.remote, "HEAD:refs/heads/master"]);
const image = await sharp({
	create: { width: 160, height: 100, channels: 3, background: "#84b790" },
})
	.png()
	.toBuffer();
const preview = await sharp(image).webp().toBuffer();
const dist = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const server = createServer(async (req, res) => {
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-robots-tag", "noindex, nofollow");
	const url = new URL(req.url || "/", f.config.origin);
	try {
		if (url.pathname === "/api/status") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					ok: true,
					data: {
						configured: true,
						missing: [],
						blogOrigin: f.config.blogOrigin,
						testEnvironment:
							"第五阶段隔离验收：模拟身份、PGlite、mock 媒体与临时 Git；发布构建是明确 fixture",
					},
				}),
			);
			return;
		}
		if (url.pathname.startsWith("/api/")) {
			await f.api(req, res, url);
			return;
		}
		if (url.pathname.startsWith("/__fixture/")) {
			const bytes = url.pathname.endsWith("audio.wav")
				? wav
				: url.pathname.endsWith("preview.webp")
					? preview
					: image;
			res.writeHead(200, {
				"content-type": url.pathname.endsWith("audio.wav")
					? "audio/wav"
					: url.pathname.endsWith("preview.webp")
						? "image/webp"
						: "image/png",
			});
			res.end(bytes);
			return;
		}
		const file = resolve(
			dist,
			url.pathname === "/" ? "index.html" : url.pathname.slice(1),
		);
		if (!file.startsWith(dist + sep)) throw new Error("path");
		const bytes = await readFile(file);
		res.writeHead(200, {
			"content-type":
				(
					{
						".html": "text/html",
						".js": "text/javascript",
						".css": "text/css",
					} as Record<string, string>
				)[extname(file)] || "application/octet-stream",
		});
		res.end(bytes);
	} catch {
		if (!res.headersSent) res.writeHead(404);
		res.end();
	}
});
server.listen(port, "127.0.0.1", () =>
	console.log(
		`第五阶段隔离后台：http://127.0.0.1:${port}/ （preview / preview）；临时数据：${f.privateRoot}；媒体 ${audio.id} / ${photos.map((p) => p.id).join(", ")}`,
	),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () => {
		server.close();
		void (async () => {
			await f.jobs.close();
			await f.media.close();
			await f.db.close();
		})();
	});
