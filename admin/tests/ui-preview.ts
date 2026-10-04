// Explicitly isolated UI fixture. Never import from the production server.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { listContent } from "../server/content.js";

const root = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const contentRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const port = 4323;
let session = "";
function json(
	res: import("node:http").ServerResponse,
	status: number,
	body: unknown,
) {
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(body));
}
createServer(async (req, res) => {
	const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
	if (url.pathname === "/api/status")
		return json(res, 200, {
			ok: true,
			data: {
				configured: true,
				missing: [],
				blogOrigin: "https://blog.dcelysion.cn",
			},
		});
	if (url.pathname === "/api/login" && req.method === "POST") {
		let input = "";
		for await (const chunk of req) input += chunk;
		const { identity, password } = JSON.parse(input);
		if (identity !== "preview" || password !== "preview")
			return json(res, 401, {
				ok: false,
				error: { code: "LOGIN_FAILED", message: "模拟账号或密码无效" },
			});
		session = "local-ui-fixture";
		res.setHeader(
			"set-cookie",
			`fixture=${session}; Path=/; HttpOnly; SameSite=Strict`,
		);
		return json(res, 200, { ok: true, data: { id: 1, name: "本地模拟博主" } });
	}
	if (url.pathname === "/api/logout" && req.method === "POST") {
		session = "";
		res.setHeader(
			"set-cookie",
			"fixture=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
		);
		return json(res, 200, { ok: true, data: null });
	}
	if (!url.pathname.startsWith("/api/")) {
		const file = resolve(
			root,
			url.pathname === "/" ? "index.html" : url.pathname.slice(1),
		);
		if (!file.startsWith(`${root}${sep}`)) {
			res.writeHead(404);
			res.end();
			return;
		}
		try {
			const mime: Record<string, string> = {
				".html": "text/html",
				".js": "text/javascript",
				".css": "text/css",
			};
			const contents = await readFile(file);
			res.writeHead(200, {
				"content-type": mime[extname(file)] || "application/octet-stream",
			});
			res.end(contents);
		} catch {
			res.writeHead(404);
			res.end();
		}
		return;
	}
	if (!session || !req.headers.cookie?.includes(`fixture=${session}`))
		return json(res, 401, {
			ok: false,
			error: { code: "UNAUTHORIZED", message: "请重新登录" },
		});
	if (url.pathname === "/api/me")
		return json(res, 200, { ok: true, data: { id: 1, name: "本地模拟博主" } });
	if (url.pathname.startsWith("/api/content/")) {
		if (url.searchParams.get("search") === "!error")
			return json(res, 500, {
				ok: false,
				error: { code: "CONTENT_READ", message: "模拟读取失败" },
			});
		const kind = url.pathname.endsWith("posts") ? "posts" : "dynamic";
		const status = url.searchParams.get("status") || "all";
		const page = Number(url.searchParams.get("page") || 1);
		const search = url.searchParams.get("search") || "";
		const data = await listContent(contentRoot, {
			kind,
			status: status as "all" | "published" | "draft",
			search,
			page,
			pageSize: 15,
		});
		return json(res, 200, { ok: true, data });
	}
	return json(res, 404, {
		ok: false,
		error: { code: "NOT_FOUND", message: "接口不存在" },
	});
}).listen(port, "127.0.0.1", () =>
	console.log(
		`仅供 UI 验证的模拟服务：http://127.0.0.1:${port} （preview / preview）`,
	),
);
