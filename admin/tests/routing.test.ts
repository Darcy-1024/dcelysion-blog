import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	defaultMediaPolicy,
	dualReady,
	parseMediaPolicy,
} from "../../src/utils/media-contract.js";
import { MediaAttempt, MediaRouter } from "../../src/utils/media-routing.js";
import { MediaBudget } from "../server/media-budget.js";
import { publicDistribution } from "../server/media-distribution.js";
import { createMediaEdge } from "../server/media-edge.js";
import { parseConfiguration } from "../shared/configuration.js";
import type { Media } from "../shared/media.js";
import { listenLocal } from "./local-listener.js";
import { routingFixture } from "./routing-fixture.js";

test("edge reads distinct purpose paths even when object keys match", async () => {
	const root = await mkdtemp(join(tmpdir(), "purpose-edge-"));
	const records: Media[] = [];
	for (const purpose of ["gallery", "wallpaper"] as const) {
		const bytes = Buffer.from(purpose);
		const original = {
			key: "same-key.txt",
			sha256: createHash("sha256").update(bytes).digest("hex"),
			size: bytes.length,
			mime: "text/plain",
			ext: "txt",
		};
		await mkdir(join(root, purpose));
		await writeFile(join(root, purpose, original.key), bytes);
		records.push({
			id: purpose,
			purpose,
			original,
			publicKeys: [original.key],
			destination: {
				version: 1,
				purpose,
				bucket: purpose,
				prefix: "managed",
				publicBase: `https://${purpose}.test`,
				tencentRoot: join(root, purpose),
				tencentBase: `https://tencent.test/media/${purpose}`,
			},
		} as Media);
	}
	const manifest = publicDistribution(
		records,
		"edge",
		"https://legacy.test",
		undefined,
		undefined,
		undefined,
		false,
		root,
	);
	assert.equal(manifest.entries[0].localKey, "gallery/same-key.txt");
	assert.equal(
		publicDistribution(
			records,
			"public",
			"https://legacy.test",
			undefined,
			undefined,
			undefined,
			false,
		).entries[0].localKey,
		undefined,
	);
	const server = createServer(
		createMediaEdge({
			root,
			manifest,
			enabled: true,
			concurrent: 2,
			bytesPerSecond: 327680,
			budget: new MediaBudget(join(root, "budget.jsonl"), 10000),
		}),
	);
	const { port } = await listenLocal(server);
	try {
		for (const purpose of ["gallery", "wallpaper"] as const) {
			const response = await fetch(
				`http://127.0.0.1:${port}/media/${purpose}/same-key.txt`,
			);
			assert.equal(response.status, 200);
			assert.equal(await response.text(), purpose);
		}
		assert.equal(
			(await fetch(`http://127.0.0.1:${port}/media/objects/same-key.txt`))
				.status,
			404,
		);
	} finally {
		await new Promise<void>((accept) => server.close(() => accept()));
	}
});

test("purpose destinations preserve separate domains and legacy URLs", () => {
	const original = {
		key: "immutable/shared.png",
		sha256: "a".repeat(64),
		size: 5,
		mime: "image/png",
		ext: "png",
	};
	const preview = { ...original, key: "immutable/shared-preview.png" };
	const record = {
		id: "gallery",
		original,
		preview,
		publicKeys: [original.key, preview.key],
		tencentKeys: [original.key, preview.key],
		deliveryReceipts: { [original.key]: original, [preview.key]: preview },
	} as unknown as Media;
	const destination = (purpose: "gallery" | "wallpaper") => ({
		purpose,
		version: 1 as const,
		bucket: `bucket-${purpose}`,
		prefix: "managed",
		publicBase: `https://${purpose}.test`,
		tencentRoot: `/media/${purpose}`,
		tencentBase: `https://tencent.test/${purpose}`,
	});
	const manifest = publicDistribution(
		[
			{ ...record, purpose: "gallery", destination: destination("gallery") },
			{
				...record,
				id: "wallpaper",
				purpose: "wallpaper",
				destination: destination("wallpaper"),
			},
			{ ...record, id: "legacy" },
			{
				...record,
				id: "unpublished",
				publicKeys: [],
				destination: destination("gallery"),
			},
		],
		"snapshot",
		"https://legacy.test",
		"https://legacy-tencent.test",
	);
	assert.equal(manifest.entries.length, 6);
	for (const purpose of ["gallery", "wallpaper"] as const) {
		const entries = manifest.entries.filter((e) => e.id === purpose);
		assert.equal(entries.length, 2);
		for (const entry of entries) {
			assert.equal(entry.defaultUrl, `https://${purpose}.test/${entry.key}`);
			assert.equal(
				entry.sources.tencent,
				`https://tencent.test/${purpose}/${entry.key}`,
			);
			assert.ok(dualReady(entry));
			const router = new MediaRouter(manifest, {
				...defaultMediaPolicy,
				enabled: true,
				mode: "r2",
			});
			assert.equal(router.attempt(entry.defaultUrl).url, entry.defaultUrl);
		}
	}
	assert.equal(
		manifest.entries.find((e) => e.id === "legacy")?.defaultUrl,
		`https://legacy.test/${original.key}`,
	);
	assert.equal(
		manifest.entries.some((e) => e.id === "unpublished"),
		false,
	);
});

test("one bounded round, storage reuse, fixed modes, capacity fail-closed, manual affects future only", async () => {
	const f = await routingFixture();
	try {
		let saved: string | null = null;
		const storage = {
			getItem: () => saved,
			setItem: (_key: string, value: string) => {
				saved = value;
			},
		};
		const policy = { ...defaultMediaPolicy, enabled: true };
		const route = new MediaRouter(f.manifest, policy, storage);
		const before = route.attempt(f.url("photo"));
		assert.equal(before.url, f.url("photo"));
		const calls = [route.start(), route.start(), route.start()];
		assert.equal(calls[0], calls[1]);
		assert.deepEqual(await Promise.all(calls), [
			"tencent",
			"tencent",
			"tencent",
		]);
		assert.equal(
			f.requests.filter((r) => r.path === "/media/capacity").length,
			1,
		);
		assert.equal(f.requests.filter((r) => r.path.includes("probe-")).length, 2);
		const after = route.attempt(f.url("photo"));
		assert.equal(after.url, f.url("photo", "tencent"));
		assert.equal(before.url, f.url("photo"));
		await new MediaRouter(f.manifest, policy, storage).start();
		assert.equal(f.requests.length, 3);
		f.state.deny = true;
		assert.equal(await route.start(true), "r2");
		assert.equal(after.url, f.url("photo", "tencent"));
		assert.equal(route.attempt(f.url("photo")).backup(), undefined);
		const fixed = new MediaRouter(f.manifest, { ...policy, mode: "tencent" });
		assert.equal(await fixed.start(), "r2");
		f.state.deny = false;
		const fixedGood = new MediaRouter(f.manifest, {
			...policy,
			mode: "tencent",
		});
		const count = f.requests.length;
		assert.equal(await fixedGood.start(), "tencent");
		assert.equal(f.requests.length, count + 1);
		const r2 = new MediaRouter(f.manifest, { ...policy, mode: "r2" });
		const count2 = f.requests.length;
		assert.equal(await r2.start(), "r2");
		assert.equal(f.requests.length, count2);
		const broken = new MediaRouter(f.manifest, policy, {
			getItem() {
				throw new Error("blocked");
			},
			setItem() {
				throw new Error("blocked");
			},
		});
		await broken.start();
		const count3 = f.requests.length;
		await broken.start();
		assert.equal(f.requests.length, count3);
		assert.equal(broken.storageAvailable, false);
		const pending = {
			getItem: () => '{"version":1,"phase":"pending","preferred":"r2"}',
			setItem() {},
		};
		const count4 = f.requests.length;
		await new MediaRouter(f.manifest, policy, pending).start();
		assert.equal(f.requests.length, count4);
		f.state.r2Delay = 900;
		const timeout = new MediaRouter(f.manifest, { ...policy, timeoutMs: 500 });
		assert.equal(await timeout.start(), "r2");
	} finally {
		await f.close();
	}
});

test("real response headers/Range, finite backup and played latch; publication/schema gates", async () => {
	const f = await routingFixture();
	try {
		const head = await fetch(f.url("song1", "tencent"), { method: "HEAD" });
		assert.equal(head.status, 200);
		assert.equal(head.headers.get("content-type"), "audio/wav");
		assert.ok(head.headers.get("cache-control")?.includes("immutable"));
		assert.equal(head.headers.get("timing-allow-origin"), "*");
		const range = await fetch(f.url("song1"), {
			headers: { Range: "bytes=0-15" },
		});
		assert.equal(range.status, 206);
		assert.equal((await range.arrayBuffer()).byteLength, 16);
		assert.ok(range.headers.get("content-range")?.startsWith("bytes 0-15/"));
		const entry = f.manifest.entries[1];
		const attempt = new MediaAttempt(
			entry.sources.tencent || "",
			entry,
			"tencent",
		);
		assert.equal(attempt.backup(), entry.defaultUrl);
		assert.equal(attempt.backup(), undefined);
		const playing = new MediaAttempt(entry.defaultUrl, entry, "r2");
		playing.played = true;
		assert.equal(playing.backup(), undefined);
		assert.equal(
			dualReady({ ...entry, sources: { r2: entry.defaultUrl } }),
			false,
		);
		const original = {
			key: "immutable/key.png",
			sha256: createHash("sha256").update("bytes").digest("hex"),
			size: 5,
			mime: "image/png",
			ext: "png",
		};
		const media = {
			id: "id",
			original,
			preview: { ...original, key: "preview/key.png" },
			publicKeys: [original.key],
			tencentKeys: [original.key],
			deliveryReceipts: {
				[original.key]: {
					sha256: original.sha256,
					size: original.size,
					mime: original.mime,
				},
			},
		} as Media;
		const publicResult = publicDistribution(
			[
				media,
				{ ...media, id: "private", publicKeys: [] },
				{ ...media, id: "unverified", tencentKeys: [] },
				{
					...media,
					id: "mismatched",
					deliveryReceipts: {
						[original.key]: {
							sha256: "0".repeat(64),
							size: original.size,
							mime: original.mime,
						},
					},
				},
			],
			"snapshot",
			"https://r2.test/media",
			"https://tencent.test/media/objects",
		);
		assert.equal(publicResult.entries.length, 1);
		assert.equal(publicResult.entries[0].variant, "original");
		assert.equal(JSON.stringify(publicResult).includes("private"), false);
		assert.throws(() =>
			parseMediaPolicy({
				...defaultMediaPolicy,
				probeUrl: "https://evil.test",
			}),
		);
		const baseline = await readFile(
			"src/config/manifests/settings.json",
			"utf8",
		);
		const parsed = JSON.parse(baseline);
		parsed.mediaRouting = {
			...defaultMediaPolicy,
			mode: "tencent",
			enabled: true,
		};
		assert.equal(
			(
				parseConfiguration("settings", JSON.stringify(parsed), baseline)
					.mediaRouting as { mode: string }
			).mode,
			"tencent",
		);
		parsed.mediaRouting.timeoutMs = 999999;
		assert.throws(() =>
			parseConfiguration("settings", JSON.stringify(parsed), baseline),
		);
	} finally {
		await f.close();
	}
});

test("durable monthly reservations, concurrent limit, shared payload scheduler and private paths", async () => {
	const root = await mkdtemp(join(tmpdir(), "media-budget-test-"));
	const journal = join(root, "budget.jsonl");
	const budget = new MediaBudget(journal, 10);
	const results = await Promise.allSettled([
		budget.reserve(6),
		budget.reserve(6),
	]);
	assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
	await assert.rejects(new MediaBudget(journal, 10).reserve(5));
	await writeFile(journal, "invalid\n");
	await assert.rejects(budget.available());
	const f = await routingFixture();
	try {
		f.state.tencentDelay = 0;
		const target = f.url("song1", "tencent");
		const start = performance.now();
		const [a, b, c] = await Promise.all([
			fetch(target),
			fetch(target),
			fetch(target),
		]);
		assert.equal([a, b, c].filter((r) => r.status === 503).length, 1);
		await Promise.all([a, b, c].map((r) => r.arrayBuffer()));
		assert.ok(performance.now() - start >= 300);
		const privateUrl = new URL("/api/library/private/original", target);
		assert.equal((await fetch(privateUrl)).status, 404);
		const capacity = await (await fetch(f.manifest.capacityUrl || "")).json();
		assert.deepEqual(Object.keys(capacity).sort(), ["allowed", "expiresAt"]);
	} finally {
		await f.close();
	}
});
