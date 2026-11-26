import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import subsetFont from "subset-font";
import { FontSubsetCache } from "./font-subset-cache";

test("font subset cache reuses subsets, invalidates changed inputs and repairs corrupt entries", async (t) => {
	const dir = await fs.mkdtemp(path.join(tmpdir(), "dcelysion-font-cache-"));
	t.after(async () => {
		for (const file of await fs.readdir(dir))
			await fs.unlink(path.join(dir, file));
		await fs.rmdir(dir);
	});
	const font = await fs.readFile(
		new URL("../public/assets/fonts/MiSansVF.ttf", import.meta.url),
	);
	const sourceHash = createHash("sha256").update(font).digest("hex");
	const options = { targetFormat: "woff2" } as const;
	let generated = 0;
	const open = (algorithm = "current") =>
		new FontSubsetCache(dir, algorithm, (...params) => {
			generated++;
			return subsetFont(...params);
		});
	const core = "布克😀";
	const shard = "莱龘";

	let cache = open();
	const coldCore = await cache.getOrGenerate(font, sourceHash, core, options);
	const coldShard = await cache.getOrGenerate(font, sourceHash, shard, options);
	assert.equal(generated, 2);
	await cache.finish();
	const manifestPath = path.join(dir, "manifest.json");
	const coldManifest = await fs.readFile(manifestPath, "utf8");

	cache = open();
	assert.deepEqual(
		await cache.getOrGenerate(font, sourceHash, shard, options),
		coldShard,
	);
	assert.deepEqual(
		await cache.getOrGenerate(font, sourceHash, "😀克布克", options),
		coldCore,
	);
	assert.equal(generated, 2);
	await cache.finish();
	assert.equal(await fs.readFile(manifestPath, "utf8"), coldManifest);

	cache = open();
	await cache.getOrGenerate(font, sourceHash, `${core}晞`, options);
	assert.deepEqual(
		await cache.getOrGenerate(font, sourceHash, shard, options),
		coldShard,
	);
	assert.equal(generated, 3);
	await fs.writeFile(path.join(dir, "unrelated.bin"), "keep");
	await cache.finish();
	const nextEntries: string[] = JSON.parse(
		await fs.readFile(manifestPath, "utf8"),
	);
	assert.equal(nextEntries.length, 2);
	assert.notEqual(await fs.readFile(manifestPath, "utf8"), coldManifest);
	assert.deepEqual(
		(await fs.readdir(dir)).sort(),
		[...nextEntries, "manifest.json", "unrelated.bin"].sort(),
	);

	for (const entry of nextEntries) {
		const file = path.join(dir, entry);
		const bytes = await fs.readFile(file);
		bytes[bytes.length - 1] ^= 1;
		await fs.writeFile(file, bytes);
	}
	cache = open();
	assert.deepEqual(
		await cache.getOrGenerate(font, sourceHash, shard, options),
		coldShard,
	);
	assert.equal(generated, 4);
	// A different source digest, generator or byte-producing option must not reuse the old shard.
	await cache.getOrGenerate(font, "changed-source", shard, options);
	await open("changed-algorithm").getOrGenerate(
		font,
		sourceHash,
		shard,
		options,
	);
	await cache.getOrGenerate(font, sourceHash, shard, {
		...options,
		noLayoutClosure: true,
	});
	assert.equal(generated, 7);
});
