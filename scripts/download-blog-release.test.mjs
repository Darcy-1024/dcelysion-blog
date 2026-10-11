import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
	validateArchiveEntries,
	verifyPayload,
} from "./download-blog-release.mjs";
import { packagePublicBlog } from "./package-public-blog.mjs";

test("archive boundary rejects traversal, links, duplicate and private members", () => {
	const names = [
		"cloudflare/",
		"cloudflare/assets/",
		"cloudflare/assets/index.html",
		"edgeone/assets/__route/probe-v1.bin",
		"manifest.json",
	];
	assert.equal(
		validateArchiveEntries(
			names.join("\n"),
			["d", "d", "-", "-", "-"].join("\n"),
		).size,
		5,
	);
	for (const name of [
		"/cloudflare/assets/index.html",
		"cloudflare/assets/../../secret",
		"C:/temp/file",
		"cloudflare/assets\\secret",
		"cloudflare/assets/.env",
		"edgeone/assets/assets/music/song.mp3",
		"cloudflare/assets/admin/index.html",
		"other/index.html",
	])
		assert.throws(() => validateArchiveEntries(name, "-"));
	for (const kind of ["l", "h", "b", "c", "p"])
		assert.throws(
			() => validateArchiveEntries("cloudflare/assets/index.html", kind),
			/ARCHIVE_LINK_OR_SPECIAL_FILE/,
		);
	assert.throws(
		() => validateArchiveEntries("manifest.json\nmanifest.json", "-\n-"),
		/INVALID_ARCHIVE_PATH/,
	);
});

test("release verification checks both payloads, source identity and unlisted files", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dc-blog-download-test-"));
	const input = path.join(root, "input");
	await mkdir(input);
	for (const file of ["index.html", "404.html", "robots.txt"])
		await writeFile(path.join(input, file), `fixture ${file}`);
	const revision = "a".repeat(40);
	const output = path.join(root, "release");
	await packagePublicBlog({
		input,
		output,
		releaseId: `blog-${revision}`,
		sourceRevision: revision,
		buildProvenance: "github-actions",
	});
	const execute = promisify(execFile);
	const archive = path.join(root, "blog-public.tar.gz");
	await execute("tar", [
		"-czf",
		archive,
		"-C",
		output,
		"cloudflare",
		"edgeone",
		"manifest.json",
	]);
	const listing = await execute("tar", ["-tzf", archive]);
	const verbose = await execute("tar", ["-tvzf", archive]);
	validateArchiveEntries(listing.stdout, verbose.stdout);
	assert.equal(
		(await verifyPayload(output, revision)).sourceRevision,
		revision,
	);
	await assert.rejects(
		verifyPayload(output, "b".repeat(40)),
		/RELEASE_MANIFEST_INVALID/,
	);
	const target = path.join(output, "edgeone/assets/index.html");
	const original = await readFile(target);
	await writeFile(target, "tampered");
	await assert.rejects(
		verifyPayload(output, revision),
		/RELEASE_PAYLOAD_MISMATCH/,
	);
	await writeFile(target, original);
	await writeFile(
		path.join(output, "edgeone/assets/unlisted.txt"),
		"unexpected",
	);
	await assert.rejects(
		verifyPayload(output, revision),
		/RELEASE_UNLISTED_FILE/,
	);
});
