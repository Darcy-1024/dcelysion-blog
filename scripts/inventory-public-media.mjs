import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Input must be an already published, verified public release, never src/content.
const [releaseRoot, output] = process.argv.slice(2);
if (!releaseRoot || !output)
	throw new Error(
		"Usage: inventory-public-media.mjs <public-release-assets> <report.json>",
	);
const raster =
	/\.(?:avif|webp|png|jpe?g|gif|svg|ico|mp4|webm|flac|mp3|wav|ogg|m4a|lrc)$/i;
const files = [];
async function walk(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`Symlink rejected: ${full}`);
		if (entry.isDirectory()) await walk(full);
		else if (raster.test(entry.name)) files.push(full);
	}
}
await walk(releaseRoot);
const objects = [];
for (const full of files) {
	const key = path.relative(releaseRoot, full).split(path.sep).join("/");
	const bytes = await readFile(full);
	objects.push({
		key,
		size: (await stat(full)).size,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		status:
			key.startsWith("vndb-covers/") || key.startsWith("pio/")
				? "third-party-provenance-review"
				: "published-local",
	});
}
const report = {
	version: 1,
	source: "verified-published-release",
	objects,
	total: objects.length,
	bytes: objects.reduce((n, o) => n + o.size, 0),
	uniqueBytes: [
		...new Map(objects.map((o) => [o.sha256, o.size])).values(),
	].reduce((a, b) => a + b, 0),
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
	JSON.stringify({
		total: report.total,
		bytes: report.bytes,
		uniqueBytes: report.uniqueBytes,
		provenanceReview: objects.filter((o) => o.status !== "published-local")
			.length,
	}),
);
