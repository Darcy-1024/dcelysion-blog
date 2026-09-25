import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, "cache", "tencent-r2-export");
const buckets = ["dcelysion-gallery", "dcelysion-music", "dcelysion-wallpapers"];
const listOnly = process.argv.includes("--list-only");
const configPath = path.join(destination, "wrangler.export.json");

function localPath(bucket, key) {
	const parts = key.split("/");
	if (
		!key ||
		parts.some((part) =>
			!part || part === "." || part === ".." || /[<>:"|?*\\\x00-\x1f]/u.test(part) ||
			/[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
		)
	) {
		throw new Error(`Object key cannot be represented safely on Windows: ${bucket}/${key}`);
	}
	const target = path.resolve(destination, bucket, ...parts);
	if (!target.startsWith(path.resolve(destination, bucket) + path.sep)) {
		throw new Error(`Object key escapes bucket directory: ${bucket}/${key}`);
	}
	return target;
}

async function main() {
	await mkdir(destination, { recursive: true });
	await writeFile(configPath, JSON.stringify({
		name: "r2-export-local-only",
		compatibility_date: "2026-09-23",
		r2_buckets: buckets.map((bucket, index) => ({ binding: `B${index}`, bucket_name: bucket, remote: true })),
	}, null, 2));
	const proxy = await getPlatformProxy({ configPath, remoteBindings: true, persist: false });
	try {
		const manifest = { accountId: "25d4e6f2e01c0cde639588a28d13814d", generatedAt: new Date().toISOString(), buckets: {}, objects: [] };
		for (const [index, bucket] of buckets.entries()) {
			const binding = proxy.env[`B${index}`];
			let cursor;
			let count = 0;
			let bytes = 0;
			const seen = new Set();
			do {
				const page = await binding.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
				if (page.truncated && !page.cursor) throw new Error(`Missing pagination cursor for ${bucket}`);
				for (const item of page.objects) {
					if (seen.has(item.key)) throw new Error(`Duplicate key: ${bucket}/${item.key}`);
					seen.add(item.key);
					const target = localPath(bucket, item.key);
					const entry = { bucket, key: item.key, bytes: item.size, etag: item.etag };
					if (!listOnly) {
						await mkdir(path.dirname(target), { recursive: true });
							const object = await binding.get(item.key);
							if (!object) throw new Error(`Object disappeared: ${bucket}/${item.key}`);
							if (object.size !== item.size || object.etag !== item.etag) throw new Error(`Object changed during export: ${bucket}/${item.key}`);
							const temporary = `${target}.r2-part`;
							const hash = createHash("sha256");
							let downloaded = 0;
							try {
								await pipeline(Readable.fromWeb(object.body), new Transform({
									transform(chunk, _encoding, callback) { hash.update(chunk); downloaded += chunk.length; callback(null, chunk); },
								}), createWriteStream(temporary));
								if (downloaded !== item.size) throw new Error(`Size mismatch: ${bucket}/${item.key}`);
								await rename(temporary, target);
								entry.sha256 = hash.digest("hex");
							} catch (error) {
								await rm(temporary, { force: true });
								throw error;
							}
					}
					manifest.objects.push(entry);
					count++;
					bytes += item.size;
				}
				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor);
			manifest.buckets[bucket] = { count, bytes };
			console.log(`${bucket}: ${count} objects, ${bytes} bytes${listOnly ? " (listed only)" : " (downloaded/verified)"}`);
		}
		if (!listOnly) {
			manifest.objects.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.key.localeCompare(b.key));
			await writeFile(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
		}
	} finally {
		await proxy.dispose();
		await rm(configPath, { force: true });
	}
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
