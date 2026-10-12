import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readdir,
	readFile,
	rename,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createGunzip } from "node:zlib";
import { sha256 } from "./blog-route-contract.mjs";
import { classifyPublicFile } from "./package-public-blog.mjs";

const execute = promisify(execFile);
const maximumBytes = 150 * 1024 * 1024;
const tarOptions = {
	timeout: 120_000,
	maxBuffer: 12 * 1024 * 1024,
	windowsHide: true,
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function validateArchiveEntries(names, verbose) {
	const entries = names.trim().split(/\r?\n/u);
	const types = verbose.trim().split(/\r?\n/u);
	if (
		!names.trim() ||
		entries.length > 40_020 ||
		entries.length !== types.length
	)
		throw new Error("INVALID_ARCHIVE_LIST");
	const seen = new Set();
	for (let index = 0; index < entries.length; index++) {
		const original = entries[index];
		const name = original.replace(/^\.\//u, "").replace(/\/$/u, "");
		const kind = types[index][0];
		if (!["-", "d"].includes(kind))
			throw new Error("ARCHIVE_LINK_OR_SPECIAL_FILE");
		if (original === "./" && kind === "d") continue;
		if (
			!name ||
			/[\\:]/u.test(name) ||
			[...name].some(
				(character) =>
					character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
			) ||
			name.startsWith("/") ||
			name.split("/").some((part) => !part || part === "." || part === "..") ||
			seen.has(name)
		)
			throw new Error("INVALID_ARCHIVE_PATH");
		seen.add(name);
		if (name === "manifest.json" && kind === "-") continue;
		const parts = name.split("/");
		const platform = parts[0];
		if (!["cloudflare", "edgeone"].includes(platform))
			throw new Error("INVALID_ARCHIVE_ROOT");
		if (kind === "d") {
			if (parts.length === 1 || parts[1] === "assets") continue;
			throw new Error("INVALID_ARCHIVE_DIRECTORY");
		}
		if (name === "cloudflare/wrangler.json" || name === "edgeone/edgeone.json")
			continue;
		if (parts[1] !== "assets" || parts.length < 3)
			throw new Error("INVALID_ARCHIVE_FILE");
		const relative = parts.slice(2).join("/");
		if (
			[
				"__route/probe-v1.bin",
				"__route/version.json",
				"__route/public-media.json",
			].includes(relative)
		)
			continue;
		if (platform === "cloudflare" && relative === "_headers") continue;
		if (classifyPublicFile(relative) !== "include")
			throw new Error("PRIVATE_ARCHIVE_FILE");
	}
	return seen;
}

async function boundedDownload(url, destination, limit, deadline) {
	let failures = 0;
	while (Date.now() < deadline) {
		let response;
		try {
			response = await fetch(url, {
				signal: AbortSignal.timeout(60_000),
				redirect: "follow",
			});
		} catch {
			if (++failures >= 3) throw new Error("RELEASE_NETWORK_FAILED");
			await pause(Math.min(5_000, Math.max(0, deadline - Date.now())));
			continue;
		}
		if (response.status === 404) {
			await response.body?.cancel();
			console.log("Release artifact pending; retrying in 30 seconds.");
			await pause(Math.min(30_000, Math.max(0, deadline - Date.now())));
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel();
			if (++failures >= 3) throw new Error(`RELEASE_HTTP_${response.status}`);
			await pause(Math.min(5_000, Math.max(0, deadline - Date.now())));
			continue;
		}
		if (
			!response.body ||
			Number(response.headers.get("content-length")) > limit
		) {
			await response.body?.cancel();
			throw new Error("RELEASE_SIZE_LIMIT");
		}
		const handle = await open(destination, "w", 0o600);
		const hash = createHash("sha256");
		let bytes = 0;
		try {
			for await (const chunk of response.body) {
				bytes += chunk.length;
				if (bytes > limit) throw new Error("RELEASE_SIZE_LIMIT");
				hash.update(chunk);
				await handle.writeFile(chunk);
			}
			await handle.sync();
			return { bytes, sha256: hash.digest("hex") };
		} catch (error) {
			if (error.message === "RELEASE_SIZE_LIMIT") throw error;
			if (++failures >= 3) throw new Error("RELEASE_TRANSFER_FAILED");
		} finally {
			await handle.close();
		}
		await pause(Math.min(5_000, Math.max(0, deadline - Date.now())));
	}
	throw new Error("RELEASE_WAIT_TIMEOUT");
}

async function filesIn(root, prefix = "") {
	const files = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const target = path.join(root, entry.name);
		const info = await lstat(target);
		if (info.isSymbolicLink()) throw new Error("EXTRACTED_LINK");
		if (info.isDirectory())
			files.push(...(await filesIn(target, `${prefix}${entry.name}/`)));
		else if (info.isFile()) files.push(`${prefix}${entry.name}`);
		else throw new Error("EXTRACTED_SPECIAL_FILE");
	}
	return files;
}

export async function verifyPayload(directory, revision) {
	const manifest = JSON.parse(
		await readFile(path.join(directory, "manifest.json"), "utf8"),
	);
	if (
		manifest.sourceRevision !== revision ||
		manifest.deploymentEligible !== true ||
		manifest.mode !== "production" ||
		manifest.buildProvenance !== "github-actions" ||
		!Array.isArray(manifest.files) ||
		manifest.files.length > 20_003
	)
		throw new Error("RELEASE_MANIFEST_INVALID");
	const expected = new Set([
		"manifest.json",
		"cloudflare/wrangler.json",
		"edgeone/edgeone.json",
		"cloudflare/assets/_headers",
	]);
	const payloadPaths = new Set();
	for (const file of manifest.files) {
		if (
			typeof file.path !== "string" ||
			!Number.isSafeInteger(file.bytes) ||
			file.bytes < 0 ||
			file.bytes > 25_000_000 ||
			!/^[a-f0-9]{64}$/u.test(file.sha256 ?? "") ||
			payloadPaths.has(file.path)
		)
			throw new Error("RELEASE_FILE_INVALID");
		validateArchiveEntries(`cloudflare/assets/${file.path}\n`, "- synthetic\n");
		validateArchiveEntries(`edgeone/assets/${file.path}\n`, "- synthetic\n");
		payloadPaths.add(file.path);
		for (const platform of ["cloudflare", "edgeone"]) {
			const relative = `${platform}/assets/${file.path}`;
			expected.add(relative);
			const bytes = await readFile(path.join(directory, relative));
			if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
				throw new Error("RELEASE_PAYLOAD_MISMATCH");
		}
	}
	for (const required of [
		"index.html",
		"404.html",
		"robots.txt",
		"__route/version.json",
		"__route/probe-v1.bin",
	])
		if (!payloadPaths.has(required))
			throw new Error("RELEASE_REQUIRED_FILE_MISSING");
	const actual = await filesIn(directory);
	if (
		actual.length !== expected.size ||
		actual.some((file) => !expected.has(file))
	)
		throw new Error("RELEASE_UNLISTED_FILE");
	for (const platform of ["cloudflare", "edgeone"]) {
		const version = JSON.parse(
			await readFile(
				path.join(directory, platform, "assets/__route/version.json"),
				"utf8",
			),
		);
		if (
			version.sourceRevision !== revision ||
			version.deploymentEligible !== true ||
			version.buildProvenance !== manifest.buildProvenance ||
			version.releaseId !== manifest.releaseId ||
			version.publicTreeSha256 !== manifest.publicTreeSha256
		)
			throw new Error("RELEASE_VERSION_INVALID");
	}
	return manifest;
}

export async function downloadBlogRelease(platform = "cloudflare") {
	if (!["cloudflare", "edgeone"].includes(platform))
		throw new Error("INVALID_PLATFORM");
	const workspace = process.cwd();
	const { stdout } = await execute("git", ["rev-parse", "HEAD"], {
		windowsHide: true,
	});
	const revision = stdout.trim();
	if (!/^[a-f0-9]{40}$/u.test(revision))
		throw new Error("INVALID_SOURCE_REVISION");
	const cache = path.join(workspace, "cache");
	await mkdir(cache, { recursive: true });
	if ((await lstat(cache)).isSymbolicLink())
		throw new Error("CACHE_LINK_NOT_ALLOWED");
	const temporary = await mkdtemp(path.join(cache, "blog-release-"));
	const archive = path.join(temporary, "blog-public.tar.gz");
	const checksum = path.join(temporary, "blog-public.tar.gz.sha256");
	const url = `https://github.com/Darcy-1024/dcelysion-blog/releases/download/blog-${revision}/blog-public.tar.gz`;
	const deadline = Date.now() + 10 * 60_000;
	const downloaded = await boundedDownload(
		url,
		archive,
		maximumBytes,
		deadline,
	);
	await boundedDownload(`${url}.sha256`, checksum, 1024, deadline);
	const checksumText = (await readFile(checksum, "utf8")).trim();
	const match = /^([a-f0-9]{64})(?:[ \t]+\*?blog-public\.tar\.gz)?$/u.exec(
		checksumText,
	);
	if (!match || match[1] !== downloaded.sha256)
		throw new Error("RELEASE_CHECKSUM_MISMATCH");
	let expanded = 0;
	await pipeline(
		createReadStream(archive),
		createGunzip(),
		new Writable({
			write(chunk, _encoding, done) {
				expanded += chunk.length;
				done(
					expanded > 512 * 1024 * 1024
						? new Error("RELEASE_EXPANDED_SIZE_LIMIT")
						: null,
				);
			},
		}),
	);
	const listing = await execute("tar", ["-tzf", archive], tarOptions);
	const verbose = await execute("tar", ["-tvzf", archive], tarOptions);
	validateArchiveEntries(listing.stdout, verbose.stdout);
	const extracted = path.join(temporary, "extracted");
	await mkdir(extracted);
	await execute("tar", ["-xzf", archive, "-C", extracted], tarOptions);
	const manifest = await verifyPayload(extracted, revision);
	const dist = path.join(workspace, "dist");
	try {
		const old = await lstat(dist);
		if (!old.isDirectory() || old.isSymbolicLink())
			throw new Error("DIST_NOT_SAFE_DIRECTORY");
		await rename(dist, path.join(cache, `dist-backup-${randomUUID()}`));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	await cp(path.join(extracted, platform, "assets"), dist, {
		recursive: true,
		errorOnExist: true,
		force: false,
	});
	await writeFile(
		path.join(temporary, "verified.json"),
		`${JSON.stringify({ revision, platform, archiveSha256: downloaded.sha256, publicTreeSha256: manifest.publicTreeSha256 }, null, 2)}\n`,
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			revision,
			platform,
			publicTreeSha256: manifest.publicTreeSha256,
			files: manifest.files.length,
		}),
	);
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	if (process.argv.length > 3)
		throw new Error(
			"Usage: node scripts/download-blog-release.mjs [cloudflare|edgeone]",
		);
	await downloadBlogRelease(process.argv[2]);
}
