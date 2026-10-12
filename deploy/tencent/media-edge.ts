import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { MediaBudget } from "../../admin/server/media-budget.js";
import { createMediaEdge } from "../../admin/server/media-edge.js";
import { hostMediaPermit } from "../../admin/server/media-host-permit.js";
import {
	type MediaDistribution,
	parsePublicMediaManifest,
} from "../../src/utils/media-contract.js";

// Use loopback, or an isolated Docker bridge with no public backend port.
const manifestPath =
	process.env.MEDIA_EDGE_MANIFEST ||
	"/srv/dcelysion/admin-public-media/.distribution.json";
let cachedManifest: { identity: string; value: MediaDistribution } | undefined;
const manifest = async () => {
	const info = await stat(manifestPath);
	if (!info.isFile() || info.size > 2097152)
		throw new Error("Bounded public index required");
	const identity = `${info.ino}:${info.mtimeMs}:${info.size}`;
	if (cachedManifest?.identity === identity) return cachedManifest.value;
	const value = JSON.parse(
		await readFile(manifestPath, "utf8"),
	) as MediaDistribution;
	parsePublicMediaManifest({
		...value,
		entries: value.entries.map(({ localKey: _localKey, ...entry }) => entry),
	});
	cachedManifest = { identity, value };
	return value;
};
const monthly = Number(process.env.MEDIA_EDGE_MONTHLY_BYTES || 250_000_000_000);
if (!Number.isSafeInteger(monthly) || monthly < 1 || monthly > 250_000_000_000)
	throw new Error("Media monthly budget must not exceed 250GB");
const server = createServer(
	createMediaEdge({
		root: resolve(
			process.env.MEDIA_EDGE_PUBLIC_ROOT || "/srv/dcelysion/admin-public-media",
		),
		manifest,
		enabled: process.env.MEDIA_EDGE_ENABLED === "1",
		admission: () => hostMediaPermit(process.env.MEDIA_EDGE_HOST_PERMIT),
		advertiseCapacity: process.env.MEDIA_EDGE_ADVERTISE_CAPACITY === "1",
		concurrent: Number(process.env.MEDIA_EDGE_CONCURRENT || 2),
		bytesPerSecond: Number(process.env.MEDIA_EDGE_BYTES_PER_SECOND || 327680),
		budget: new MediaBudget(
			process.env.MEDIA_EDGE_BUDGET_JOURNAL ||
				"/srv/dcelysion/media-budget/edge.jsonl",
			monthly,
		),
	}),
);
server.maxConnections = 32;
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
// Docker may bind its isolated bridge; never publish that backend port publicly.
const bind = process.env.MEDIA_EDGE_BIND || "127.0.0.1";
if (!["127.0.0.1", "0.0.0.0"].includes(bind))
	throw new Error("Media edge bind must be loopback or isolated bridge");
server.listen(8082, bind);
