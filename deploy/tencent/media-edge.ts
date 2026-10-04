import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { MediaBudget } from "../../admin/server/media-budget.js";
import { createMediaEdge } from "../../admin/server/media-edge.js";
import type { MediaDistribution } from "../../src/utils/media-contract.js";

// Bind to loopback only. Install/restart separately after operator authorization.
const manifest = async () =>
	JSON.parse(
		await readFile(
			process.env.MEDIA_EDGE_MANIFEST ||
				"/srv/dcelysion/admin-public-media/.distribution.json",
			"utf8",
		),
	) as MediaDistribution;
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
server.listen(8082, "127.0.0.1");
