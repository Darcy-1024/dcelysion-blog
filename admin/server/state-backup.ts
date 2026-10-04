// Offline directory snapshots. Caller must stop ALL writers and flush/close databases first.
// PostgreSQL uses a verified pg_dump file, never a live data-directory copy.
import { createHash } from "node:crypto";
import {
	copyFile,
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

type Manifest = {
	version: 1;
	createdAt: string;
	metadata: Record<string, unknown>;
	directories: string[];
	files: Record<string, { sha256: string; size: number }>;
};
const digest = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const safeName = (name: string) =>
	Boolean(name) &&
	name !== "." &&
	name !== ".." &&
	!/[\\/:*?"<>|]/u.test(name) &&
	![...name].some((character) => character.charCodeAt(0) < 32) &&
	!/[ .]$/u.test(name) &&
	!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(name);
const safePath = (path: string) =>
	path.split("/").every(safeName) && !path.includes("\\");
const forbidden = (path: string) =>
	path
		.toLowerCase()
		.split("/")
		.some(
			(n) =>
				n === ".git" ||
				n === ".npmrc" ||
				n.startsWith(".env") ||
				/\.(pem|key)$/i.test(n),
		);
async function files(
	root: string,
	prefix = "",
	directories: string[] = [],
): Promise<string[]> {
	const result: string[] = [];
	for (const name of (await readdir(join(root, prefix))).sort()) {
		const path = prefix ? `${prefix}/${name}` : name;
		if (!safePath(path) || forbidden(path))
			throw new Error(`Unsafe/secret path refused: ${path}`);
		const stat = await lstat(join(root, path));
		if (
			stat.isSymbolicLink() ||
			(!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))
		)
			throw new Error(`Link/special file refused: ${path}`);
		if (stat.isDirectory()) {
			directories.push(path);
			result.push(...(await files(root, path, directories)));
		} else result.push(path);
	}
	return result;
}
async function newTarget(parent: string, target: string) {
	const actual = await realpath(parent);
	const dest = resolve(target);
	if (
		dirname(dest) !== actual ||
		!/^admin-recovery-[a-zA-Z0-9-]+$/.test(dest.split(sep).pop() || "")
	)
		throw new Error(
			"Target must be a new direct admin-recovery-* child of the approved parent",
		);
	await mkdir(dest, { mode: 0o700 }); // exclusive: even an empty existing destination is refused
	return dest;
}
export async function backupState(
	parent: string,
	target: string,
	components: Record<string, string>,
	metadata: Record<string, unknown>,
	stopped: boolean,
) {
	if (!stopped)
		throw new Error("Explicit stopped-writers acknowledgement required");
	const sources: Record<string, string[]> = {};
	const directories: string[] = [];
	for (const [name, root] of Object.entries(components)) {
		if (!safeName(name)) throw new Error("Invalid component");
		const actual = await realpath(root);
		if (
			!(await lstat(root)).isDirectory() ||
			(await lstat(root)).isSymbolicLink()
		)
			throw new Error("Real directory required");
		const dest = resolve(target);
		if (
			dest === actual ||
			dest.startsWith(actual + sep) ||
			actual.startsWith(dest + sep)
		)
			throw new Error("Overlapping snapshot root");
		const nested: string[] = [];
		sources[name] = await files(actual, "", nested);
		directories.push(name, ...nested.map((path) => `${name}/${path}`));
	}
	const dest = await newTarget(parent, target);
	const manifest: Manifest = {
		version: 1,
		createdAt: new Date().toISOString(),
		metadata,
		directories: directories.sort(),
		files: {},
	};
	for (const path of manifest.directories)
		await mkdir(join(dest, path), { recursive: true, mode: 0o700 });
	for (const [name, paths] of Object.entries(sources))
		for (const path of paths) {
			const key = `${name}/${path}`;
			const source = join(components[name], path);
			const bytes = await readFile(source);
			manifest.files[key] = { sha256: digest(bytes), size: bytes.length };
			await mkdir(dirname(join(dest, key)), { recursive: true, mode: 0o700 });
			await copyFile(source, join(dest, key));
			if (
				digest(await readFile(join(dest, key))) !== manifest.files[key].sha256
			)
				throw new Error("Snapshot changed during copy");
		}
	const json = JSON.stringify(manifest, null, 2);
	await writeFile(join(dest, "manifest.partial"), json, { mode: 0o600 });
	await rename(join(dest, "manifest.partial"), join(dest, "manifest.json"));
	await writeFile(join(dest, "COMPLETE"), digest(Buffer.from(json)), {
		mode: 0o600,
	});
	return manifest;
}
export async function restoreState(
	parent: string,
	target: string,
	snapshot: string,
) {
	const root = await realpath(snapshot);
	if ((await lstat(snapshot)).isSymbolicLink())
		throw new Error("Snapshot link refused");
	const json = await readFile(join(root, "manifest.json"), "utf8");
	if (
		digest(Buffer.from(json)) !==
		(await readFile(join(root, "COMPLETE"), "utf8"))
	)
		throw new Error("Manifest checksum mismatch");
	const manifest = JSON.parse(json) as Manifest;
	if (
		manifest.version !== 1 ||
		!manifest.files ||
		typeof manifest.files !== "object" ||
		!Array.isArray(manifest.directories)
	)
		throw new Error("Unsupported manifest");
	const dirs: string[] = [];
	const actual = await files(root, "", dirs);
	if (
		manifest.directories.some((path) => !safePath(path) || forbidden(path)) ||
		JSON.stringify(dirs.sort()) !==
			JSON.stringify([...manifest.directories].sort())
	)
		throw new Error("Snapshot directory inventory mismatch");
	const expected = [
		"manifest.json",
		"COMPLETE",
		...Object.keys(manifest.files),
	].sort();
	if (JSON.stringify(actual.sort()) !== JSON.stringify(expected))
		throw new Error("Snapshot file inventory mismatch");
	for (const [path, info] of Object.entries(manifest.files)) {
		if (!safePath(path) || forbidden(path))
			throw new Error("Unsafe snapshot path");
		const bytes = await readFile(join(root, path));
		if (bytes.length !== info.size || digest(bytes) !== info.sha256)
			throw new Error(`Checksum mismatch: ${path}`);
	}
	const dest = await newTarget(parent, target);
	for (const path of manifest.directories)
		await mkdir(join(dest, path), { recursive: true, mode: 0o700 });
	for (const path of Object.keys(manifest.files)) {
		await mkdir(dirname(join(dest, path)), { recursive: true, mode: 0o700 });
		await copyFile(join(root, path), join(dest, path));
	}
	await writeFile(
		join(dest, "RESTORE-REQUIRES-REVIEW.json"),
		JSON.stringify({
			snapshot: root,
			createdAt: manifest.createdAt,
			metadata: manifest.metadata,
			externalWrites: false,
		}),
		{ mode: 0o600 },
	);
	return manifest;
}
