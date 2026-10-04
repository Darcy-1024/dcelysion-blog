// Explicit local fixture. No production configuration, credentials, writes or upstream traffic.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { analyticsFixture } from "./analytics-fixture.js";
import { listenLocal } from "./local-listener.js";

const f = await analyticsFixture();
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const server = createServer(async (req, res) => {
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-robots-tag", "noindex, nofollow");
	const url = new URL(req.url || "/", f.config.origin);
	if (url.pathname === "/fixture" && req.method === "GET") {
		res.setHeader("content-type", "text/html; charset=utf-8");
		res.end(
			'<h1>第七阶段模拟数据源控制（非生产功能）</h1><form method="post" action="/__fixture/mode"><button name="mode" value="success">正常模拟</button><button name="mode" value="unconfigured">未配置</button><button name="mode" value="error">上游错误</button><button name="mode" value="partial">部分失败</button></form>',
		);
		return;
	}
	if (
		url.pathname === "/__fixture/mode" &&
		req.method === "POST" &&
		req.headers.origin === f.config.origin
	) {
		let body = "";
		for await (const chunk of req) {
			body += chunk;
			if (body.length > 100) {
				res.writeHead(400);
				res.end();
				return;
			}
		}
		const mode = new URLSearchParams(body).get("mode");
		if (!["success", "unconfigured", "error", "partial"].includes(mode || "")) {
			res.writeHead(400);
			res.end();
			return;
		}
		f.setAnalyticsMode(mode || "success");
		res.writeHead(303, { location: "/" });
		res.end();
		return;
	}
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
						"第七阶段隔离模拟：Umami PV120 / UV7 / visits9；仓库文章1+草稿1，私有草稿31，Waline评论3/待审1/用户2；非真实流量。账号 preview / preview，二步码123456",
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
f.config.origin = `http://127.0.0.1:${address.port}`;
console.log(
	`Stage-seven explicit mock: ${f.config.origin} (controls: /fixture)`,
);
