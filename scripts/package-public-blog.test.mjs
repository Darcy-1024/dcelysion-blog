import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
	cloudflareHeaders,
	edgeoneConfig,
	makeProbe,
	probeBytes,
	sha256,
} from "./blog-route-contract.mjs";
import {
	classifyPublicFile,
	packagePublicBlog,
} from "./package-public-blog.mjs";

test("fixed probe and exact-path platform headers", () => {
	const probe = makeProbe();
	assert.equal(probe.length, probeBytes);
	assert.deepEqual(probe, makeProbe());
	assert.ok(gzipSync(probe).length >= probe.length);
	const config = edgeoneConfig();
	assert.equal(config.headers.length, 2);
	assert.ok(!config.rewrites && !config.redirects);
	for (const rule of config.headers) {
		assert.ok(
			rule.source.startsWith("/__route/") && !rule.source.includes("*"),
		);
		for (const { key, value } of rule.headers)
			assert.ok(cloudflareHeaders().includes(`${key}: ${value}`));
	}
});

test("public boundary retains routes/search and rejects private inputs", () => {
	for (const file of [
		"gallery/album/index.html",
		"posts/example/index.html",
		"pagefind/index.pf_index",
		"_astro/fonts/a.woff2",
		"api/allPostMeta.json",
	]) {
		assert.equal(classifyPublicFile(file), "include");
	}
	for (const file of [
		"gallery/album/photo.webp",
		"assets/music/song.mp3",
		"assets/videos/movie.mp4",
		"server/index.js",
		"admin/index.html",
		"posts/draft.mdx",
		".env",
		"_astro/a.js.map",
		"private/index.html",
		"api/private.json",
	]) {
		assert.equal(classifyPublicFile(file), "exclude");
	}
	assert.throws(
		() => classifyPublicFile("unknown/data.json"),
		/UNREVIEWED_PUBLIC_FILE/,
	);
	assert.throws(() => classifyPublicFile("../index.html"), /INVALID_PATH/);
});

test("two payloads are byte-identical; provenance is never invented; input remains intact", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dc-blog-route-"));
	const input = path.join(root, "input");
	const output = path.join(root, "candidate");
	await mkdir(input);
	for (const [file, bytes] of Object.entries({
		"index.html": "<html>fixture</html>",
		"404.html": "<html>404</html>",
		"robots.txt": "User-agent: *",
		"gallery/album/index.html": "<html>album</html>",
		"gallery/album/private.jpg": "raw-media",
		"server/index.js": "private-wrapper",
		".env": "fixture-not-secret",
		"api/dynamic.json": "[]",
	})) {
		await mkdir(path.dirname(path.join(input, file)), { recursive: true });
		await writeFile(path.join(input, file), bytes);
	}
	const manifest = await packagePublicBlog({
		input,
		output,
		releaseId: "fixture-v1",
	});
	assert.equal(manifest.deploymentEligible, false);
	assert.equal(manifest.sourceRevision, null);
	assert.equal(manifest.platforms.edgeone.status, "not-deployed");
	for (const file of manifest.files) {
		const cf = await readFile(
			path.join(output, "cloudflare/assets", file.path),
		);
		const eo = await readFile(path.join(output, "edgeone/assets", file.path));
		assert.deepEqual(cf, eo);
		assert.equal(cf.length, file.bytes);
		assert.equal(sha256(cf), file.sha256);
	}
	assert.ok(manifest.excluded.includes("server/index.js"));
	assert.equal(
		await readFile(path.join(input, "gallery/album/private.jpg"), "utf8"),
		"raw-media",
	);
	await assert.rejects(
		packagePublicBlog({ input, output, releaseId: "again" }),
		/OUTPUT_EXISTS/,
	);
	await assert.rejects(
		packagePublicBlog({
			input,
			output: path.join(input, "nested"),
			releaseId: "overlap",
		}),
		/OVERLAPPING_DIRECTORIES/,
	);
	await symlink(
		input,
		path.join(root, "linked"),
		process.platform === "win32" ? "junction" : "dir",
	);
	await assert.rejects(
		packagePublicBlog({
			input: path.join(root, "linked"),
			output: path.join(root, "other"),
			releaseId: "linked",
		}),
		/LINK_NOT_ALLOWED/,
	);
});

test("production provenance is explicit, valid and identical in both versions", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dc-blog-production-"));
	const input = path.join(root, "input");
	await mkdir(input);
	const original = {
		"index.html": "<html>current-build</html>",
		"404.html": "<html>404</html>",
		"robots.txt": "User-agent: *",
	};
	for (const [file, bytes] of Object.entries(original))
		await writeFile(path.join(input, file), bytes);
	const sourceRevision = "0123456789abcdef0123456789abcdef01234567";
	for (const buildProvenance of [
		"github-actions",
		"cloudflare-build",
		"edgeone-build",
	]) {
		const output = path.join(root, buildProvenance);
		const manifest = await packagePublicBlog({
			input,
			output,
			releaseId: `production-${buildProvenance}`,
			sourceRevision,
			buildProvenance,
		});
		assert.equal(manifest.mode, "production");
		assert.equal(manifest.deploymentEligible, true);
		assert.equal(manifest.sourceRevision, sourceRevision);
		assert.equal(manifest.buildProvenance, buildProvenance);
		assert.equal(manifest.platforms.cloudflare.status, "not-deployed");
		for (const file of manifest.files) {
			const cf = await readFile(
				path.join(output, "cloudflare/assets", file.path),
			);
			const eo = await readFile(path.join(output, "edgeone/assets", file.path));
			assert.deepEqual(cf, eo);
			assert.equal(sha256(cf), file.sha256);
		}
		const version = JSON.parse(
			await readFile(
				path.join(output, "edgeone/assets/__route/version.json"),
				"utf8",
			),
		);
		assert.equal(version.deploymentEligible, true);
		assert.equal(version.sourceRevision, sourceRevision);
		assert.equal(version.buildProvenance, buildProvenance);
		assert.equal(version.publicTreeSha256, manifest.publicTreeSha256);
	}
	for (const [file, bytes] of Object.entries(original))
		assert.equal(await readFile(path.join(input, file), "utf8"), bytes);
});

test("partial, invalid or unsupported production provenance is rejected before IO", async () => {
	const sourceRevision = "0123456789abcdef0123456789abcdef01234567";
	for (const provenance of [
		{ sourceRevision },
		{ buildProvenance: "github-actions" },
		{ sourceRevision: "0123456", buildProvenance: "github-actions" },
		{ sourceRevision: "z".repeat(40), buildProvenance: "github-actions" },
		{ sourceRevision: null, buildProvenance: "github-actions" },
		{ sourceRevision, buildProvenance: "local" },
		{ sourceRevision, buildProvenance: "unverified" },
		{ sourceRevision, buildProvenance: null },
	]) {
		await assert.rejects(
			packagePublicBlog({
				input: "nonexistent-input",
				output: "nonexistent-output",
				releaseId: "invalid-provenance",
				...provenance,
			}),
			/INVALID_BUILD_PROVENANCE/,
		);
	}
});
