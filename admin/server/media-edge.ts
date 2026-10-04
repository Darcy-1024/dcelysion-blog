import { once } from "node:events";
import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { MediaDistribution } from "../../src/utils/media-contract.js";
import { safeFile } from "./executor.js";
import type { MediaBudget } from "./media-budget.js";
import { verifyFile } from "./media-storage.js";

export function createMediaEdge(config: {
	root: string;
	manifest: MediaDistribution | (() => Promise<MediaDistribution>);
	enabled: boolean;
	bytesPerSecond: number;
	concurrent: number;
	budget: MediaBudget;
}) {
	if (
		!Number.isInteger(config.concurrent) ||
		config.concurrent < 1 ||
		config.concurrent > 2 ||
		!Number.isInteger(config.bytesPerSecond) ||
		config.bytesPerSecond < 16384 ||
		config.bytesPerSecond > 327680
	)
		throw new Error("Conservative edge limits required");
	let active = 0;
	let nextSlot = 0;
	const verified = new Map<string, Promise<string>>();
	const allowed = async () =>
		config.enabled &&
		active < config.concurrent &&
		(await config.budget.available());
	return async (req: IncomingMessage, res: ServerResponse) => {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Timing-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Range");
		res.setHeader(
			"Access-Control-Expose-Headers",
			"Content-Length, Content-Range, Accept-Ranges",
		);
		res.setHeader("Cache-Control", "no-store");
		const path = new URL(req.url || "/", "http://localhost").pathname;
		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}
		if (!["GET", "HEAD"].includes(req.method || "")) {
			res.writeHead(405);
			res.end();
			return;
		}
		try {
			if (path === "/media/capacity") {
				const index =
					typeof config.manifest === "function"
						? await config.manifest()
						: config.manifest;
				const body = JSON.stringify({
					allowed:
						index.version === 1 &&
						index.entries.length > 0 &&
						(await allowed()),
					expiresAt: Date.now() + 10000,
				});
				res.writeHead(200, {
					"content-type": "application/json",
					"content-length": Buffer.byteLength(body),
				});
				res.end(req.method === "HEAD" ? undefined : body);
				return;
			}
			const manifest =
				typeof config.manifest === "function"
					? await config.manifest()
					: config.manifest;
			const entry = manifest.entries.find((e) =>
				e.sources.tencent
					? path === new URL(e.sources.tencent).pathname
					: path === `/media/objects/${e.key}`,
			);
			if (!entry) {
				res.writeHead(404);
				res.end();
				return;
			}
			if (!(await allowed())) {
				res.writeHead(503, { "Retry-After": "10" });
				res.end();
				return;
			}
			// Acquire synchronously after asynchronous capacity read; never oversubscribe.
			if (active >= config.concurrent) {
				res.writeHead(503);
				res.end();
				return;
			}
			active++;
			try {
				const localKey = entry.localKey || entry.key;
				const cacheKey = `${localKey}:${entry.sha256}:${entry.size}:${entry.mime}`;
				let file = verified.get(cacheKey);
				if (!file) {
					file = (async () => {
						const candidate = await safeFile(config.root, localKey);
						await verifyFile(candidate, {
							key: entry.key,
							sha256: entry.sha256,
							size: entry.size,
							mime: entry.mime,
							ext: "",
						});
						return candidate;
					})();
					verified.set(cacheKey, file);
				}
				const filename = await file;
				let start = 0;
				let end = entry.size - 1;
				let partial = false;
				if (req.headers.range) {
					const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
					if (!match || (!match[1] && !match[2])) {
						res.writeHead(416, { "Content-Range": `bytes */${entry.size}` });
						res.end();
						return;
					}
					start = match[1]
						? Number(match[1])
						: Math.max(0, entry.size - Number(match[2]));
					end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
					if (
						!Number.isSafeInteger(start) ||
						!Number.isSafeInteger(end) ||
						start > end ||
						start >= entry.size
					) {
						res.writeHead(416, { "Content-Range": `bytes */${entry.size}` });
						res.end();
						return;
					}
					partial = true;
				}
				const length = end - start + 1;
				if (req.method !== "HEAD") await config.budget.reserve(length);
				res.writeHead(partial ? 206 : 200, {
					"content-type": entry.mime,
					"content-length": length,
					"accept-ranges": "bytes",
					"cache-control": "public, max-age=31536000, immutable",
					...(partial
						? { "content-range": `bytes ${start}-${end}/${entry.size}` }
						: {}),
				});
				if (req.method === "HEAD") {
					res.end();
					return;
				}
				const stream = createReadStream(filename, {
					start,
					end,
					highWaterMark: 16384,
				});
				const close = () => stream.destroy();
				res.once("close", close);
				try {
					for await (const bytes of stream) {
						if (res.destroyed) break;
						// One scheduler for ALL media hosts/connections in this process.
						nextSlot =
							Math.max(Date.now(), nextSlot) +
							(bytes.length * 1000) / config.bytesPerSecond;
						await delay(Math.max(0, nextSlot - Date.now()));
						if (res.destroyed) break;
						if (!res.write(bytes))
							await once(res, "drain", { signal: AbortSignal.timeout(10000) });
					}
					res.end();
				} finally {
					res.off("close", close);
					stream.destroy();
				}
			} finally {
				active--;
			}
		} catch {
			if (res.headersSent) res.destroy();
			else {
				res.writeHead(503, { "Retry-After": "10" });
				res.end();
			}
		}
	};
}
