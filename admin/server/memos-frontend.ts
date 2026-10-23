import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const upstreamCommit = "2b2192d4e153bd04f1d325b60fd880cf00d68b01";
const types: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".webmanifest": "application/manifest+json",
	".txt": "text/plain; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".avif": "image/avif",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
};
type Asset = { bytes: Buffer; type: string; gzip?: Buffer };

async function noLinks(filename: string) {
	let current = path.parse(filename).root;
	for (const part of filename
		.slice(current.length)
		.split(path.sep)
		.filter(Boolean)) {
		current = path.join(current, part);
		if ((await fs.lstat(current)).isSymbolicLink())
			throw new Error("Memos frontend links refused");
	}
}

/** A sealed, bounded build loaded once. It never maps request paths to disk. */
export class MemosFrontend {
	private constructor(private readonly assets: Map<string, Asset>) {}
	static async load(directory: string): Promise<MemosFrontend> {
		if (!path.isAbsolute(directory))
			throw new Error("Absolute frontend path required");
		await noLinks(directory);
		const manifestPath = path.join(directory, "frontend-manifest.json");
		await noLinks(manifestPath);
		const manifestStat = await fs.stat(manifestPath);
		if (!manifestStat.isFile() || manifestStat.size > 1024 * 1024)
			throw new Error("Invalid frontend manifest");
		const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
		if (
			manifest.schema !== 1 ||
			manifest.upstreamCommit !== upstreamCommit ||
			!/^[a-f0-9]{64}$/u.test(manifest.patchSHA256) ||
			!Array.isArray(manifest.entries) ||
			!manifest.entries.length ||
			manifest.entries.length > 2000
		)
			throw new Error("Unrecognized Memos frontend build");
		const assets = new Map<string, Asset>();
		let total = 0;
		for (const entry of manifest.entries) {
			const name = entry.path;
			if (
				typeof name !== "string" ||
				!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(name) ||
				name
					.split("/")
					.some(
						(part) =>
							!part || part === "." || part === ".." || part.startsWith("."),
					) ||
				/^(?:api|file|_bridge)(?:\/|$)|^memos\.api\./u.test(name) ||
				name === "frontend-manifest.json" ||
				assets.has(`/${name}`) ||
				!Number.isSafeInteger(entry.bytes) ||
				entry.bytes < 0 ||
				entry.bytes > 20 * 1024 * 1024 ||
				!/^[a-f0-9]{64}$/u.test(entry.sha256)
			)
				throw new Error("Invalid frontend entry");
			const type = types[path.extname(name)];
			if (!type || (name.endsWith(".html") && name !== "index.html"))
				throw new Error("Unsupported frontend file");
			total += entry.bytes;
			if (total > 64 * 1024 * 1024)
				throw new Error("Frontend exceeds memory bound");
			const filename = path.join(directory, ...name.split("/"));
			await noLinks(filename);
			const stat = await fs.stat(filename);
			if (!stat.isFile() || stat.size !== entry.bytes)
				throw new Error("Frontend size mismatch");
			const bytes = await fs.readFile(filename);
			if (
				bytes.length !== entry.bytes ||
				createHash("sha256").update(bytes).digest("hex") !== entry.sha256
			)
				throw new Error("Frontend digest mismatch");
			// Compress the sealed code once at startup, never on the request path.
			const compressed = /\.(?:js|css)$/u.test(name)
				? gzipSync(bytes)
				: undefined;
			assets.set(`/${name}`, {
				bytes,
				type,
				gzip:
					compressed && compressed.length < bytes.length
						? compressed
						: undefined,
			});
		}
		if (!assets.has("/index.html")) throw new Error("Frontend index missing");
		return new MemosFrontend(assets);
	}
	asset(pathname: string): Asset | undefined {
		return this.assets.get(pathname);
	}
	index(): Asset {
		return this.assets.get("/index.html") as Asset;
	}
}
