// Isolated browser acceptance only. No production imports of this fixture.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { mediaFixture } from "./media-fixture.js";

const port = Number(process.env.ADMIN_MEDIA_FIXTURE_PORT || 4326);
const f = await mediaFixture(port);
f.objects.failNext = process.env.ADMIN_MEDIA_PURPOSE_PREVIEW !== "1";
await sharp({
	create: { width: 160, height: 100, channels: 3, background: "#5679bc" },
})
	.png()
	.toFile(`${f.privateRoot}/browser-acceptance.png`);
const dist = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const server = createServer(async (req, res) => {
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-robots-tag", "noindex, nofollow");
	const url = new URL(req.url || "/", f.config.origin);
	try {
		if (url.pathname === "/__test/media-fail" && req.method === "POST") {
			const cookie =
				/dc_admin_local=([^;]+)/u.exec(req.headers.cookie || "")?.[1] || "";
			if (
				req.headers.origin !== f.config.origin ||
				!(await f.auth.verify(cookie))
			) {
				res.writeHead(403);
				res.end();
				return;
			}
			f.objects.failNext = true;
			res.writeHead(200);
			res.end("controlled next sync failure");
			return;
		}
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
							"第四阶段隔离验收：模拟身份 + 磁盘 PGlite + 文件系统 mock 对象存储；fixture 构建并非真实 Astro",
					},
				}),
			);
			return;
		}
		if (url.pathname.startsWith("/api/")) {
			await f.api(req, res, url);
			return;
		}
		const file = resolve(
			dist,
			url.pathname === "/" ? "index.html" : url.pathname.slice(1),
		);
		if (!file.startsWith(`${dist}${sep}`)) {
			res.writeHead(404);
			res.end();
			return;
		}
		const types: Record<string, string> = {
			".html": "text/html",
			".js": "text/javascript",
			".css": "text/css",
		};
		const bytes = await readFile(file);
		res.writeHead(200, {
			"content-type": types[extname(file)] || "application/octet-stream",
		});
		res.end(bytes);
	} catch {
		if (!res.headersSent) res.writeHead(404);
		res.end();
	}
});
server.listen(port, "127.0.0.1", () =>
	console.log(
		`第四阶段隔离后台：http://127.0.0.1:${port}/ （preview / preview）；数据：${f.privateRoot}`,
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
