import {
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	cloudflareHeaders,
	edgeoneConfig,
	makeProbe,
	origins,
	probeBytes,
	probePath,
	sha256,
	versionPath,
} from "./blog-route-contract.mjs";

const appDirectories = new Set([
	"_astro",
	"assets",
	"favicon",
	"images",
	"pagefind",
	"pio",
	"vndb-covers",
	"og",
]);
const appExtensions = new Set([
	".js",
	".mjs",
	".css",
	".json",
	".txt",
	".svg",
	".png",
	".jpg",
	".jpeg",
	".webp",
	".avif",
	".gif",
	".ico",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".wasm",
	".pagefind",
	".pf_fragment",
	".pf_index",
	".pf_meta",
	".html",
]);
const rootFiles = new Set([
	"index.html",
	"404.html",
	"rss.xml",
	"atom.xml",
	"sitemap-0.xml",
	"sitemap-index.xml",
	"robots.txt",
	"llms.txt",
	"anime-list.json",
	"avatar.jpg",
]);
const publicApi = new Set(["api/allPostMeta.json", "api/dynamic.json"]);
const privateDirectories = new Set([
	"server",
	"admin",
	"src",
	"node_modules",
	"cache",
	"drafts",
	"private",
	"deploy",
	"docs",
]);

// This is a packaging boundary, not a substitute for trusted draft-aware building.
export function classifyPublicFile(relative) {
	const parts = relative.split("/");
	if (parts.some((part) => !part || part === ".." || part === "."))
		throw new Error("INVALID_PATH");
	if (
		parts.some(
			(part) =>
				part.startsWith(".") || privateDirectories.has(part.toLowerCase()),
		)
	)
		return "exclude";
	if (
		/\.(?:map|md|mdx|markdown|pem|key|env|bak|zip|tar|gz|mp3|mp4|flac|wav|ogg|m4a|webm)$/i.test(
			relative,
		)
	)
		return "exclude";
	if (
		/^assets\/(?:music|videos)(?:\/|$)/i.test(relative) ||
		parts[0] === "__route"
	)
		return "exclude";
	if (parts[0] === "gallery")
		return relative.endsWith("/index.html") ? "include" : "exclude";
	if (parts[0] === "api")
		return publicApi.has(relative) ? "include" : "exclude";
	if (rootFiles.has(relative)) return "include";
	if (
		parts.length > 1 &&
		appDirectories.has(parts[0]) &&
		appExtensions.has(path.extname(relative))
	)
		return "include";
	// Astro's prerendered public routes; source/draft files are never accepted.
	if (parts.length > 1 && relative.endsWith("/index.html")) return "include";
	throw new Error(`UNREVIEWED_PUBLIC_FILE: ${relative}`);
}

function contains(parent, child) {
	const relative = path.relative(parent, child);
	return (
		!relative ||
		(!relative.startsWith(`..${path.sep}`) &&
			relative !== ".." &&
			!path.isAbsolute(relative))
	);
}

async function collect(directory, prefix = "") {
	const result = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		const relative = prefix + entry.name;
		const stat = await lstat(absolute);
		if (stat.isSymbolicLink()) throw new Error(`LINK_NOT_ALLOWED: ${relative}`);
		if (stat.isDirectory())
			result.push(...(await collect(absolute, `${relative}/`)));
		else if (stat.isFile()) result.push({ relative, absolute });
		else throw new Error(`SPECIAL_FILE_NOT_ALLOWED: ${relative}`);
	}
	return result.sort((a, b) => a.relative.localeCompare(b.relative, "en"));
}

export async function packagePublicBlog({
	input,
	output,
	releaseId,
	sourceRevision,
	buildProvenance,
}) {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(releaseId ?? ""))
		throw new Error("INVALID_RELEASE_ID");
	// Only the production caller, immediately after a successful complete cloud
	// build, can attest these values. Never infer provenance from local HEAD.
	const deploymentEligible =
		sourceRevision !== undefined || buildProvenance !== undefined;
	if (
		deploymentEligible &&
		(typeof sourceRevision !== "string" ||
			!/^[a-fA-F0-9]{40}$/.test(sourceRevision) ||
			!["github-actions", "cloudflare-build", "edgeone-build"].includes(
				buildProvenance,
			))
	)
		throw new Error("INVALID_BUILD_PROVENANCE");
	const provenance = {
		sourceRevision: deploymentEligible ? sourceRevision : null,
		buildProvenance: deploymentEligible ? buildProvenance : "unverified",
		deploymentEligible,
	};
	const inputPath = path.resolve(input);
	if ((await lstat(inputPath)).isSymbolicLink())
		throw new Error("LINK_NOT_ALLOWED");
	const source = await realpath(inputPath);
	const outputPath = path.resolve(output);
	// Resolve the existing output parent to reject junction-based overlap too.
	const parent = await realpath(path.dirname(outputPath));
	const destination = path.join(parent, path.basename(outputPath));
	if (contains(source, destination) || contains(destination, source))
		throw new Error("OVERLAPPING_DIRECTORIES");
	try {
		await lstat(destination);
		throw new Error("OUTPUT_EXISTS");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const selected = [];
	const excluded = [];
	for (const file of await collect(source)) {
		if (classifyPublicFile(file.relative) === "exclude") {
			excluded.push(file.relative);
			continue;
		}
		const bytes = await readFile(file.absolute);
		if (bytes.length > 25_000_000)
			throw new Error(`PLATFORM_FILE_LIMIT: ${file.relative}`);
		selected.push({ path: file.relative, bytes, sha256: sha256(bytes) });
	}
	for (const required of ["index.html", "404.html", "robots.txt"]) {
		if (!selected.some((file) => file.path === required))
			throw new Error(`MISSING_PUBLIC_FILE: ${required}`);
	}
	if (selected.length + 3 > 20_000)
		throw new Error("PLATFORM_FILE_COUNT_LIMIT");
	const mediaMime = {
		".avif": "image/avif",
		".webp": "image/webp",
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".svg": "image/svg+xml",
		".ico": "image/x-icon",
	};
	const publicMedia = selected.filter(
		(file) =>
			mediaMime[path.extname(file.path)] &&
			!file.path.startsWith("vndb-covers/") &&
			!file.path.startsWith("pio/"),
	);
	const mediaInventory = Buffer.from(
		`${JSON.stringify({
			schema: 1,
			sourceRevision: provenance.sourceRevision,
			deploymentEligible,
			objects: publicMedia.map((file) => ({
				key: file.path,
				size: file.bytes.length,
				sha256: file.sha256,
				mime: mediaMime[path.extname(file.path)],
			})),
		})}\n`,
	);
	selected.push({
		path: "__route/public-media.json",
		bytes: mediaInventory,
		sha256: sha256(mediaInventory),
	});
	const inventory = selected.map(({ path, bytes, sha256 }) => ({
		path,
		bytes: bytes.length,
		sha256,
	}));
	const publicTreeSha256 = sha256(JSON.stringify(inventory));
	const probe = makeProbe();
	const version = {
		schema: 1,
		releaseId,
		publicTreeSha256,
		...provenance,
		probe: { path: probePath, bytes: probeBytes, sha256: sha256(probe) },
	};
	const versionBytes = Buffer.from(`${JSON.stringify(version, null, 2)}\n`);
	const payload = [
		...selected,
		{ path: probePath.slice(1), bytes: probe, sha256: sha256(probe) },
		{
			path: versionPath.slice(1),
			bytes: versionBytes,
			sha256: sha256(versionBytes),
		},
	];
	await mkdir(destination);
	for (const platform of ["cloudflare", "edgeone"]) {
		for (const file of payload) {
			const target = path.join(destination, platform, "assets", file.path);
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, file.bytes, { flag: "wx" });
		}
	}
	await writeFile(
		path.join(destination, "cloudflare", "assets", "_headers"),
		cloudflareHeaders(),
		{ flag: "wx" },
	);
	await writeFile(
		path.join(destination, "cloudflare", "wrangler.json"),
		`${JSON.stringify(
			{
				name: "dcelysion-blog",
				compatibility_date: "2026-07-09",
				assets: {
					directory: "./assets",
					not_found_handling: "404-page",
				},
			},
			null,
			2,
		)}\n`,
		{ flag: "wx" },
	);
	await writeFile(
		path.join(destination, "edgeone", "edgeone.json"),
		`${JSON.stringify(edgeoneConfig(), null, 2)}\n`,
		{ flag: "wx" },
	);
	const manifest = {
		schema: 1,
		releaseId,
		mode: deploymentEligible ? "production" : "rehearsal",
		...provenance,
		origins,
		publicTreeSha256,
		files: payload.map(({ path, bytes, sha256 }) => ({
			path,
			bytes: bytes.length,
			sha256,
		})),
		excluded,
		platforms: {
			cloudflare: { deploymentId: null, status: "not-deployed" },
			edgeone: { deploymentId: null, status: "not-deployed" },
		},
	};
	await writeFile(
		path.join(destination, "manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
		{ flag: "wx" },
	);
	return manifest;
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	const args = process.argv.slice(2);
	if (args.length !== 3 && args.length !== 5)
		throw new Error(
			"Usage: node scripts/package-public-blog.mjs INPUT NEW_OUTPUT RELEASE_ID [SOURCE_REVISION BUILD_PROVENANCE]",
		);
	const result = await packagePublicBlog({
		input: args[0],
		output: args[1],
		releaseId: args[2],
		sourceRevision: args[3],
		buildProvenance: args[4],
	});
	console.log(
		JSON.stringify(
			{
				releaseId: result.releaseId,
				mode: result.mode,
				files: result.files.length,
				bytes: result.files.reduce((sum, file) => sum + file.bytes, 0),
				publicTreeSha256: result.publicTreeSha256,
				probe: {
					path: probePath,
					bytes: probeBytes,
					sha256: sha256(makeProbe()),
				},
			},
			null,
			2,
		),
	);
}
