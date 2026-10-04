import { readFile, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createApi } from "./api.js";
import { AuthService } from "./auth.js";
import { readConfig } from "./config.js";
import { DraftService } from "./drafts.js";
import { productionMedia } from "./media-config.js";
import { productionPublishing } from "./publishing-config.js";

const config = readConfig();
const auth = config.ready ? new AuthService(config) : null;
const drafts = config.ready
	? new DraftService(config.contentRoot, config.databaseUrl)
	: null;
const media = drafts
	? productionMedia(config.contentRoot, config.databaseUrl)
	: null;
if (drafts) drafts.managedMedia = media;
const jobs = drafts
	? productionPublishing(
			config.contentRoot,
			config.databaseUrl,
			drafts,
			process.env,
			media,
		)
	: null;
const api = createApi(config, auth, drafts, jobs, media);
media?.kick();
jobs?.kick();
const jobTimer = setInterval(() => {
	jobs?.kick();
	media?.kick();
}, 3000);
jobTimer.unref();
const vite =
	process.env.NODE_ENV === "production"
		? null
		: await (async () => {
				const { createServer } = await import("vite");
				const { default: viteConfig } = await import("../vite.config.js");
				return createServer({
					...viteConfig,
					configFile: false,
					server: { middlewareMode: true },
				});
			})();
const dist = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
async function staticFile(res: ServerResponse, pathname: string) {
	const name = pathname === "/" ? "index.html" : pathname.slice(1);
	const file = resolve(dist, name);
	if (!file.startsWith(`${dist}${sep}`)) {
		res.writeHead(404);
		res.end();
		return;
	}
	try {
		if (!(await stat(file)).isFile()) throw new Error("not file");
		const mime: Record<string, string> = {
			".html": "text/html",
			".js": "text/javascript",
			".css": "text/css",
			".svg": "image/svg+xml",
		};
		const contents = await readFile(file);
		res.writeHead(200, {
			"content-type": `${mime[extname(file)] || "application/octet-stream"}; charset=utf-8`,
			"cache-control": "no-store",
		});
		res.end(contents);
	} catch {
		res.writeHead(404);
		res.end();
	}
}
const server = createServer(async (req, res) => {
	res.setHeader("x-robots-tag", "noindex, nofollow");
	res.setHeader("x-frame-options", "DENY");
	res.setHeader("cache-control", "no-store");
	if (process.env.NODE_ENV === "production") {
		res.setHeader(
			"content-security-policy",
			"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
		);
	}
	if (config.cookieSecure)
		res.setHeader("strict-transport-security", "max-age=31536000");
	res.setHeader("referrer-policy", "no-referrer");
	res.setHeader("x-content-type-options", "nosniff");
	if (req.headers.host !== new URL(config.origin).host) {
		res.writeHead(421);
		res.end();
		return;
	}
	const url = new URL(req.url || "/", config.origin);
	if (url.pathname.startsWith("/api/")) {
		try {
			await api(req, res, url);
		} catch {
			res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: { code: "SERVER" } }));
		}
		return;
	}
	if (vite) {
		vite.middlewares(req, res, () => {
			res.writeHead(404);
			res.end();
		});
		return;
	}
	await staticFile(res, url.pathname);
});
server.listen(config.port, config.host, () => {
	console.log(
		`管理后台：${config.origin}；配置：${config.ready ? "就绪" : `缺少 ${config.missing.join(", ")}`}`,
	);
});
const cleanup = setInterval(() => {
	void auth?.cleanup().catch(() => console.error("session cleanup failed"));
}, 60 * 60_000);
cleanup.unref();
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () => {
		server.close();
		clearInterval(jobTimer);
		void (async () => {
			await jobs?.close();
			await media?.close();
			await auth?.close();
			await drafts?.close();
			await vite?.close();
		})();
	});
