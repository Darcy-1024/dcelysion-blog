// This executable is a test fixture only. Production never imports it.
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "./fixture.js";

const port = Number(process.env.ADMIN_FIXTURE_PORT || 4324);
const f = await fixture(port, process.env.ADMIN_FIXTURE_DIRECTORY);
const dist = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
let failNext = false;
const server = createServer(async (req, res) => {
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-robots-tag", "noindex, nofollow");
	const url = new URL(req.url || "/", f.config.origin);
	try {
		// Controlled test scenarios, loopback + simulated admin + exact Origin only.
		if (url.pathname === "/__test/control" && req.method === "POST") {
			if (req.headers.origin !== f.config.origin) {
				res.writeHead(403);
				res.end();
				return;
			}
			const cookie =
				/dc_admin_local=([^;]+)/u.exec(req.headers.cookie || "")?.[1] || "";
			if (!(await f.auth.verify(cookie))) {
				res.writeHead(401);
				res.end();
				return;
			}
			let body = "";
			for await (const chunk of req) {
				body += chunk;
				if (body.length > 4096) throw new Error("too large");
			}
			const control = JSON.parse(body);
			if (control.action === "fail") failNext = true;
			else if (control.action === "revoke")
				await f.db.exec(
					"UPDATE wl_users SET auth_version=auth_version+1 WHERE id=7",
				);
			else if (control.action === "source")
				await writeFile(
					join(f.root, "src/content/posts/example.mdx"),
					`${await readFile(join(f.root, "src/content/posts/example.mdx"), "utf8")}\n来源变化`,
				);
			else if (control.action === "revision") {
				const draft = await f.drafts.get(control.id, 7);
				await f.drafts.save(7, draft.id, {
					requestId: randomUUID(),
					revision: draft.revision,
					source: `${draft.source}\n另一标签页保存`,
				});
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
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
							"隔离测试：模拟身份 + 本机 PGlite；草稿存入临时目录",
					},
				}),
			);
			return;
		}
		if (url.pathname.startsWith("/api/")) {
			if (failNext && url.pathname.endsWith("/save")) {
				failNext = false;
				res.writeHead(503, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: false, error: { code: "DRAFT_STORE" } }));
				return;
			}
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
		const contents = await readFile(file);
		res.writeHead(200, {
			"content-type": types[extname(file)] || "application/octet-stream",
		});
		res.end(contents);
	} catch {
		res.writeHead(500, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: false, error: { code: "SERVER" } }));
	}
});
server.listen(port, "127.0.0.1", () =>
	console.log(
		`隔离编辑验收：http://127.0.0.1:${port} （preview / preview）；临时数据：${f.root}`,
	),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () => {
		server.close();
		void f.db.close();
	});
