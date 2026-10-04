// Reuse trusted stage-eight build without rerunning the build or its test matrix.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { inside } from "../server/paths.js";
import { listenLocal } from "./local-listener.js";
import { routingFixture } from "./routing-fixture.js";

const root = resolve("cache/stage8-routing-blog");
for (const path of [
	"src/utils/media-routing.ts",
	"src/utils/media-client.ts",
	"src/utils/media-contract.ts",
	"src/plugins/rehype-media-routing.mjs",
	"src/components/features/MediaRouting.astro",
]) {
	assert.equal(
		await readFile(resolve(path), "utf8"),
		await readFile(join(root, path), "utf8"),
		`Stale trusted build input: ${path}`,
	);
}
const old = JSON.parse(
	await readFile(join(root, "fixture-info.json"), "utf8"),
).manifest;
const f = await routingFixture(join(root, "fixture.mp4"));
assert.deepEqual(
	f.manifest.entries.map((e) => [e.key, e.sha256]),
	old.entries.map((e: { key: string; sha256: string }) => [e.key, e.sha256]),
);
const replacements = new Map<string, string>();
for (const source of ["r2", "tencent"] as const) {
	const next = f.manifest.entries[0].sources[source];
	assert.ok(next);
	replacements.set(
		new URL(old.entries[0].sources[source]).origin,
		new URL(next).origin,
	);
}
const dist = join(root, "dist");
const server = createServer(async (req, res) => {
	const url = new URL(req.url || "/", "http://localhost");
	if (url.pathname === "/__fixture/status") {
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				reuse: true,
				manifest: f.manifest,
				requests: f.requests,
			}),
		);
		return;
	}
	const path = resolve(
		dist,
		`.${url.pathname}`,
		url.pathname.endsWith("/") ? "index.html" : "",
	);
	try {
		if (!inside(dist, path)) throw new Error("path");
		let bytes = await readFile(path);
		const ext = extname(path);
		if ([".html", ".js", ".json"].includes(ext)) {
			let source = bytes.toString();
			for (const [a, b] of replacements) source = source.replaceAll(a, b);
			bytes = Buffer.from(source);
		}
		res.setHeader("cache-control", "no-store");
		res.setHeader(
			"content-type",
			(
				{
					".html": "text/html; charset=utf-8",
					".js": "text/javascript",
					".json": "application/json",
					".css": "text/css",
				} as Record<string, string>
			)[ext] || "application/octet-stream",
		);
		res.end(bytes);
	} catch {
		res.writeHead(404);
		res.end();
	}
});
const address = await listenLocal(server);
const url = `http://127.0.0.1:${address.port}/route-fixture/`;
await writeFile(
	resolve("cache/stage9-evidence/routing-reuse.json"),
	JSON.stringify(
		{ url, coreSourceMatched: true, buildReused: true, manifest: f.manifest },
		null,
		2,
	),
);
console.log(
	`Trusted Astro artifact reuse: ${url}; two new local HTTP sources; fixture origins only rewritten in responses`,
);
