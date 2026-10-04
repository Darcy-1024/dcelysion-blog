// Explicit local-only integration environment; never imported by production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import sharp from "sharp";
import { AnalyticsService } from "../server/analytics.js";
import { createApi } from "../server/api.js";
import { writeControlled } from "../server/executor.js";
import { JobService } from "../server/jobs.js";
import { MediaService } from "../server/media.js";
import { OverviewService } from "../server/overview.js";
import { inside } from "../server/paths.js";
import { LocalReleases } from "../server/releases.js";
import { cloudMock, mockConfig, mockNow } from "./analytics-fixture.js";
import { configurationFixture } from "./configuration-fixture.js";
import { fixture } from "./fixture.js";
import { listenLocal } from "./local-listener.js";
import { managementFixture } from "./management-fixture.js";
import { MockObjects } from "./media-fixture.js";
import { FixtureBuild, publication } from "./publish-fixture.js";

const escapeHtml = (text: string) =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll('"', "&quot;");
class AcceptanceBuild extends FixtureBuild {
	override async build(
		directory: string,
		id: string,
		draft: Parameters<FixtureBuild["build"]>[2],
		preview: boolean,
	) {
		const root = await super.build(directory, id, draft, preview);
		const images = [...draft.source.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
			.map((m) => `<img src="${escapeHtml(m[1])}" alt="隔离附件">`)
			.join("");
		const html = `<html><meta charset="utf-8"><body><h1>第九阶段 fixture · 非真实 Astro</h1><pre>${escapeHtml(draft.source)}</pre>${images}</body></html>`;
		await writeControlled(root, "index.html", html);
		await writeControlled(root, `posts/${draft.contentId}/index.html`, html);
		return root;
	}
}
const load = process.env.ADMIN_ACCEPTANCE_DIRECTORY;
const created = load ? null : await configurationFixture();
if (created) {
	await created.jobs.close();
	await created.media.close();
}
const metadata = created
	? {
			root: created.root,
			privateRoot: created.privateRoot,
			target: created.target,
			publicationConfig: created.publicationConfig,
			mediaConfig: created.mediaConfig,
			objectRoot: created.objects.root,
		}
	: JSON.parse(
			await readFile(join(resolve(load || ""), "environment.json"), "utf8"),
		);
const base = created || (await fixture(4327, metadata.root));
const f = await managementFixture(base);
const builder = new AcceptanceBuild();
const objects = new MockObjects(metadata.objectRoot);
const media = new MediaService(metadata.mediaConfig, objects, "", f.adapter);
f.drafts.managedMedia = media;
const releases = new LocalReleases(join(metadata.privateRoot, "site"));
const jobs = new JobService(
	metadata.publicationConfig,
	f.drafts,
	builder,
	new Map([[metadata.target.id, releases]]),
	"",
	f.adapter,
	media,
);
const analytics = new AnalyticsService(
	mockConfig,
	f.root,
	cloudMock().fetcher,
	() => mockNow,
	5000,
	true,
);
const api = createApi(
	f.config,
	f.auth,
	f.drafts,
	jobs,
	media,
	f.management,
	analytics,
	new OverviewService(f.root, f.drafts, f.management),
);
const dist = resolve("admin/dist");
let busy = false;
const serve = async (
	root: string,
	path: string,
	res: import("node:http").ServerResponse,
) => {
	const file = resolve(
		root,
		path.endsWith("/") ? `${path.slice(1)}index.html` : path.slice(1),
	);
	if (!inside(root, file)) throw new Error("path");
	const bytes = await readFile(file);
	res.setHeader(
		"content-type",
		(
			{
				".html": "text/html; charset=utf-8",
				".js": "text/javascript",
				".css": "text/css",
				".png": "image/png",
				".webp": "image/webp",
			} as Record<string, string>
		)[extname(file)] || "application/octet-stream",
	);
	res.end(
		extname(file) === ".html" && root.startsWith(releases.root)
			? bytes
					.toString()
					.replaceAll("https://managed.example.invalid", publicOrigin)
			: bytes,
	);
};
const publicServer = createServer(async (req, res) => {
	try {
		const path = new URL(req.url || "/", "http://localhost").pathname;
		const archived = /^\/__fixture\/release\/(\d{8}-[a-f0-9]{12})(\/.*)$/u.exec(
			path,
		);
		if (archived) {
			await releases.verified(archived[1]);
			await serve(
				join(releases.root, "releases", archived[1]),
				archived[2],
				res,
			);
		} else if (path.startsWith("/library/"))
			await serve(metadata.mediaConfig.publicRoot, path.slice(8), res);
		else {
			const current = await releases.current();
			if (!current) throw new Error("no release");
			await serve(join(releases.root, "releases", current), path, res);
		}
	} catch {
		res.writeHead(404);
		res.end();
	}
});
const pub = await listenLocal(publicServer);
const publicOrigin = `http://127.0.0.1:${pub.port}`;
// Public URLs remain syntactically HTTPS for production validation. Local HTTP exposes the exact object keys separately.
const server = createServer(async (req, res) => {
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-robots-tag", "noindex, nofollow");
	const url = new URL(req.url || "/", f.config.origin);
	try {
		if (busy) {
			res.writeHead(503);
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
						blogOrigin: publicOrigin,
						testEnvironment:
							"第九阶段隔离环境：模拟 Waline/R2/Umami，PGlite、fixture构建、本地Git/release。preview / preview，二步码123456；非生产",
					},
				}),
			);
			return;
		}
		if (url.pathname === "/__fixture/evidence") {
			res.setHeader("content-type", "application/json");
			res.end(
				JSON.stringify({
					root: f.root,
					privateRoot: metadata.privateRoot,
					publicOrigin,
					current: await releases.current(),
					jobs: await jobs.list(7),
					drafts: await f.drafts.list(7, "posts", 1),
					media: await media.list(7, false, "all"),
				}),
			);
			return;
		}
		if (
			url.pathname === "/__fixture/stop" &&
			req.method === "POST" &&
			req.headers.origin === f.config.origin
		) {
			if (
				!(await f.auth.verify(
					(req.headers.cookie || "")
						.split("dc_admin_local=")[1]
						?.split(";")[0] || "",
				))
			) {
				res.writeHead(401);
				res.end();
				return;
			}
			busy = true;
			await jobs.close();
			await media.close();
			await f.db.close();
			res.end("stopped; PGlite flushed; safe to snapshot");
			server.close();
			publicServer.close();
			return;
		}
		if (url.pathname.startsWith("/api/")) {
			await api(req, res, url);
			return;
		}
		await serve(dist, url.pathname, res);
	} catch (error) {
		console.error(error);
		res.writeHead(500);
		res.end("fixture failed");
	}
});
const address = await listenLocal(server);
f.config.origin = `http://127.0.0.1:${address.port}`;
if (created) {
	const seed = (
		await f.drafts.create(7, {
			requestId: randomUUID(),
			kind: "posts",
			path: "stage9-baseline.md",
			source: `${publication}\n第九阶段基准 release`,
		})
	).draft;
	const diff = await jobs.diff(7, {
		draftId: seed.id,
		revision: 1,
		targetId: metadata.target.id,
	});
	const job = await jobs.create(7, {
		requestId: randomUUID(),
		draftId: seed.id,
		revision: 1,
		targetId: metadata.target.id,
		kind: "publish",
		base: diff.base,
		confirm: metadata.target.fingerprint,
	});
	await jobs.idle();
	assert.equal((await jobs.get(7, job.id)).status, "succeeded");
	await mkdir(resolve("cache/stage9-evidence"), { recursive: true });
	await sharp({
		create: { width: 80, height: 60, channels: 3, background: "#5679bc" },
	})
		.png()
		.toFile(resolve("cache/stage9-evidence/acceptance.png"));
}
media.kick();
jobs.kick();
await media.idle();
await jobs.idle();
await writeFile(
	join(metadata.privateRoot, "environment.json"),
	JSON.stringify(metadata, null, 2),
);
await writeFile(
	resolve("cache/stage9-evidence/environment.json"),
	JSON.stringify(
		{ ...metadata, origin: f.config.origin, publicOrigin },
		null,
		2,
	),
);
console.log(
	JSON.stringify({
		admin: f.config.origin,
		public: publicOrigin,
		environment: join(metadata.privateRoot, "environment.json"),
		root: f.root,
		privateRoot: metadata.privateRoot,
		fixture: true,
	}),
);
