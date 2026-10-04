import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inside } from "../server/paths.js";
import { publication, publicationFixture } from "./publish-fixture.js";

const port = Number(process.env.ADMIN_FIXTURE_PORT || 4325);
const f = await publicationFixture(port);
const seed = (
	await f.drafts.create(7, {
		requestId: randomUUID(),
		kind: "posts",
		path: "stage3-seed.md",
		source: `${publication}\n隔离版本基准`,
	})
).draft;
const plan = await f.jobs.diff(7, {
	draftId: seed.id,
	revision: 1,
	targetId: f.target.id,
});
await f.jobs.create(7, {
	requestId: randomUUID(),
	draftId: seed.id,
	revision: 1,
	targetId: f.target.id,
	kind: "publish",
	base: plan.base,
	confirm: f.target.fingerprint,
});
await f.jobs.idle();
await f.drafts.create(7, {
	requestId: randomUUID(),
	kind: "posts",
	path: "stage3-preview.mdx",
	source: `${publication}\n第三阶段私有草稿`,
});
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const server = createServer(async (req, res) => {
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-robots-tag", "noindex, nofollow");
	try {
		if (req.headers.host !== new URL(f.config.origin).host) {
			res.writeHead(421);
			res.end();
			return;
		}
		const url = new URL(req.url || "/", f.config.origin);
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
							"第三阶段隔离验收：模拟 Waline + PGlite + fixture 构建 + 本地 bare remote / release；非真实 Astro、非生产发布",
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
		if (!inside(dist, file)) {
			res.writeHead(404);
			res.end();
			return;
		}
		const contents = await readFile(file);
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
		res.end(contents);
	} catch {
		res.writeHead(500);
		res.end();
	}
});
server.listen(port, "127.0.0.1", () =>
	console.log(
		`第三阶段隔离后台：${f.config.origin}（preview / preview）；数据 ${f.privateRoot}`,
	),
);
const timer = setInterval(() => f.jobs.kick(), 3000);
timer.unref();
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () => {
		clearInterval(timer);
		server.close();
		void f.jobs.close().then(() => f.db.close());
	});
