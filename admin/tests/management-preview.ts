// Local explicit mock. System assigns a free port; no production environment is loaded.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { listenLocal } from "./local-listener.js";
import { managementFixture } from "./management-fixture.js";

const f = await managementFixture();
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const server = createServer(async (req, res) => {
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-robots-tag", "noindex, nofollow");
	const url = new URL(req.url || "/", f.config.origin);
	if (url.pathname === "/api/status") {
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				ok: true,
				data: {
					configured: true,
					missing: [],
					blogOrigin: f.config.blogOrigin,
					testEnvironment:
						"第六阶段隔离验收：模拟身份与评论、PGlite后台会话；无真实Waline/邮件/生产写入。账号 preview / preview，二步码 123456",
				},
			}),
		);
		return;
	}
	if (url.pathname.startsWith("/api/")) {
		await f.api(req, res, url);
		return;
	}
	try {
		const file = resolve(
			dist,
			url.pathname === "/" ? "index.html" : url.pathname.slice(1),
		);
		if (!file.startsWith(resolve(dist) + sep)) throw new Error();
		const bytes = await readFile(file);
		res.setHeader(
			"content-type",
			(
				{
					".html": "text/html",
					".js": "text/javascript",
					".css": "text/css",
				} as Record<string, string>
			)[extname(file)] || "application/octet-stream",
		);
		res.end(bytes);
	} catch {
		res.writeHead(404);
		res.end();
	}
});
const address = await listenLocal(server);
f.config.port = address.port;
f.config.origin = `http://127.0.0.1:${address.port}`;
console.log(`Stage-six explicit mock: ${f.config.origin}`);
