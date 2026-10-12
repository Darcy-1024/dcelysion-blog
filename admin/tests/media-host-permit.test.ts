import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MediaBudget } from "../server/media-budget.js";
import { createMediaEdge } from "../server/media-edge.js";
import { hostMediaPermit } from "../server/media-host-permit.js";
import { listenLocal } from "./local-listener.js";

test("whole-host admission rejects absent, corrupt, denied, stale and excessive permits", async () => {
	const path = join(
		await mkdtemp(join(tmpdir(), "host-permit-")),
		"permit.json",
	);
	const now = 100000;
	assert.equal(await hostMediaPermit(undefined, now), false);
	assert.equal(await hostMediaPermit(path, now), false);
	for (const source of [
		"invalid",
		JSON.stringify({ allowed: false, expiresAt: now + 10000 }),
		JSON.stringify({ allowed: true, expiresAt: now }),
		JSON.stringify({ allowed: true, expiresAt: now + 60001 }),
		" ".repeat(1025),
	]) {
		await writeFile(path, source);
		assert.equal(await hostMediaPermit(path, now), false);
	}
	await writeFile(
		path,
		JSON.stringify({ allowed: true, expiresAt: now + 30000 }),
	);
	assert.equal(await hostMediaPermit(path, now), true);
});

test("host denial blocks real object bodies while unadvertised controlled delivery stays possible", async () => {
	const root = await mkdtemp(join(tmpdir(), "host-edge-"));
	const bytes = Buffer.from("public sample");
	await writeFile(join(root, "sample.txt"), bytes);
	let admitted = true;
	const server = createServer(
		createMediaEdge({
			root,
			manifest: {
				version: 1,
				snapshot: "host-admission-test",
				entries: [
					{
						id: "sample",
						variant: "original",
						key: "sample.txt",
						sha256: createHash("sha256").update(bytes).digest("hex"),
						size: bytes.length,
						mime: "text/plain",
						defaultUrl: "https://r2.test/sample.txt",
						sources: {},
					},
				],
			},
			enabled: true,
			advertiseCapacity: false,
			admission: async () => admitted,
			concurrent: 1,
			bytesPerSecond: 65536,
			budget: new MediaBudget(join(root, "budget.jsonl"), 1000),
		}),
	);
	const { port } = await listenLocal(server);
	const base = `http://127.0.0.1:${port}`;
	try {
		const capacity = await (await fetch(`${base}/media/capacity`)).json();
		assert.equal(capacity.allowed, false);
		assert.equal(
			await (await fetch(`${base}/media/objects/sample.txt`)).text(),
			bytes.toString(),
		);
		admitted = false;
		const denied = await fetch(`${base}/media/objects/sample.txt`);
		assert.equal(denied.status, 503);
		assert.equal((await denied.arrayBuffer()).byteLength, 0);
	} finally {
		await new Promise<void>((accept) => server.close(() => accept()));
	}
});
