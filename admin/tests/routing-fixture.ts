import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type {
	MediaDistribution,
	PublicMedia,
} from "../../src/utils/media-contract.js";
import { MediaBudget } from "../server/media-budget.js";
import { createMediaEdge } from "../server/media-edge.js";
import { listenLocal } from "./local-listener.js";

export function smallWav(seconds = 4) {
	const samples = seconds * 8000;
	const bytes = Buffer.alloc(44 + samples * 2);
	bytes.write("RIFF");
	bytes.writeUInt32LE(bytes.length - 8, 4);
	bytes.write("WAVEfmt ", 8);
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20);
	bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(8000, 24);
	bytes.writeUInt32LE(16000, 28);
	bytes.writeUInt16LE(2, 32);
	bytes.writeUInt16LE(16, 34);
	bytes.write("data", 36);
	bytes.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i++)
		bytes.writeInt16LE(
			Math.round(Math.sin((2 * Math.PI * 440 * i) / 8000) * 300),
			44 + i * 2,
		);
	return bytes;
}
export async function routingFixture(video?: string) {
	const root = await mkdtemp(join(tmpdir(), "dc-media-route-"));
	const publicRoot = join(root, "public");
	await mkdir(publicRoot);
	const entries: PublicMedia[] = [];
	const png = await sharp({
		create: { width: 80, height: 60, channels: 3, background: "#4488bb" },
	})
		.png()
		.toBuffer();
	const resources: [string, string, Uint8Array][] = [
		["probe", "image/png", png],
		["photo", "image/png", png],
		["preview", "image/png", png],
		["fail", "image/png", png],
		["song1", "audio/wav", smallWav()],
		["song2", "audio/wav", smallWav()],
		["lyric", "text/plain", Buffer.from("[00:00.00]本地测试")],
	];
	if (video)
		resources.push(
			["video1", "video/mp4", await readFile(video)],
			["video2", "video/mp4", await readFile(video)],
		);
	for (const [id, mime, bytes] of resources) {
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const key = `${id}-${sha256}.${mime.split("/")[1]}`;
		await writeFile(join(publicRoot, key), bytes);
		entries.push({
			id,
			variant: id === "preview" ? "preview" : "original",
			key,
			sha256,
			mime,
			size: bytes.length,
			sources: {},
			defaultUrl: "",
		});
	}
	const manifest: MediaDistribution = {
		version: 1,
		snapshot: "trusted-local-fixture",
		entries,
		probe: { id: "probe", variant: "original" },
	};
	const requests: {
		source: string;
		path: string;
		range?: string;
		method?: string;
	}[] = [];
	const state = {
		deny: false,
		r2Delay: 220,
		tencentDelay: 5,
		failTencent: new Set<string>(),
		failR2: new Set<string>(),
	};
	const servers: ReturnType<typeof createServer>[] = [];
	for (const source of ["r2", "tencent"] as const) {
		const edge = createMediaEdge({
			root: publicRoot,
			manifest,
			enabled: true,
			concurrent: 2,
			bytesPerSecond: 327680,
			budget: new MediaBudget(join(root, `${source}.jsonl`), 10_000_000),
		});
		const server = createServer(async (req, res) => {
			const path = req.url || "/";
			requests.push({
				source,
				path,
				range: req.headers.range,
				method: req.method,
			});
			if (source === "tencent" && state.deny) {
				res.writeHead(503, { "Access-Control-Allow-Origin": "*" });
				res.end();
				return;
			}
			const failed = source === "tencent" ? state.failTencent : state.failR2;
			if (
				entries.some(
					(entry) => failed.has(entry.id) && path.includes(entry.key),
				)
			) {
				res.writeHead(503, { "Access-Control-Allow-Origin": "*" });
				res.end();
				return;
			}
			await new Promise((resolve) =>
				setTimeout(
					resolve,
					source === "r2" ? state.r2Delay : state.tencentDelay,
				),
			);
			if (source === "r2") {
				const entry = entries.find(
					(entry) => path === `/media/objects/${entry.key}`,
				);
				if (!entry) {
					res.writeHead(404);
					res.end();
					return;
				}
				const bytes = await readFile(join(publicRoot, entry.key));
				let start = 0;
				let end = bytes.length - 1;
				const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
				if (match) {
					start = Number(match[1]);
					end = match[2] ? Math.min(Number(match[2]), end) : end;
				}
				res.writeHead(match ? 206 : 200, {
					"Content-Type": entry.mime,
					"Content-Length": end - start + 1,
					"Accept-Ranges": "bytes",
					"Cache-Control": "public, max-age=31536000, immutable",
					"Access-Control-Allow-Origin": "*",
					"Timing-Allow-Origin": "*",
					...(match
						? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` }
						: {}),
				});
				res.end(
					req.method === "HEAD" ? undefined : bytes.subarray(start, end + 1),
				);
				return;
			}
			await edge(req, res);
		});
		const { port } = await listenLocal(server);
		servers.push(server);
		const base = `http://127.0.0.1:${port}`;
		for (const entry of entries) {
			entry.sources[source] = `${base}/media/objects/${entry.key}`;
			if (source === "r2") entry.defaultUrl = entry.sources[source] || "";
		}
		if (source === "tencent") manifest.capacityUrl = `${base}/media/capacity`;
	}
	state.failTencent.add("fail");
	return {
		root,
		publicRoot,
		manifest,
		state,
		requests,
		url(id: string, source = "r2") {
			const entry = entries.find((e) => e.id === id);
			if (!entry) throw new Error(id);
			return source === "r2" ? entry.defaultUrl : entry.sources.tencent || "";
		},
		async close() {
			await Promise.all(
				servers.map(
					(server) =>
						new Promise<void>((resolve) => server.close(() => resolve())),
				),
			);
		},
	};
}
