import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { digest } from "./content.mjs";

export async function noLinks(target) {
	const resolved = path.resolve(target);
	let current = path.parse(resolved).root;
	for (const part of resolved
		.slice(current.length)
		.split(path.sep)
		.filter(Boolean)) {
		current = path.join(current, part);
		try {
			if ((await fs.lstat(current)).isSymbolicLink())
				throw new Error("Symlink/junction refused");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	return resolved;
}

export async function bytesOrNull(target) {
	await noLinks(target);
	try {
		return await fs.readFile(target);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
export const hashOrNull = (value) => (value === null ? null : digest(value));

export async function atomicWrite(target, bytes) {
	await noLinks(target);
	await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
	const temp = `${target}.${randomUUID()}.tmp`;
	const file = await fs.open(temp, "wx", 0o600);
	try {
		await file.writeFile(bytes);
		await file.sync();
	} finally {
		await file.close();
	}
	try {
		await fs.rename(temp, target);
	} finally {
		await fs.rm(temp, { force: true });
	}
}

export function outputPath(root, relative) {
	if (
		!/^(?:[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}-memos-[a-f0-9]{16}\.md|images\/memos-image-[a-f0-9]{64}\.(?:avif|webp|gif))$/u.test(
			relative,
		)
	)
		throw new Error("Invalid managed path");
	return path.join(root, "src/content/dynamic", relative);
}

export class Store {
	constructor(config) {
		this.config = config;
		this.stateDir = path.resolve(config.stateDir);
		this.root = path.resolve(config.outputRoot);
		const relative = path.relative(this.root, this.stateDir);
		if (
			!relative.startsWith(`..${path.sep}`) &&
			relative !== ".." &&
			!path.isAbsolute(relative)
		)
			throw new Error("Private state must be outside output repository");
		this.binding = {
			instanceId: config.instanceId,
			baseUrl: config.baseUrl,
			creator: config.creator,
			root: this.root,
			timezone: config.timezone,
		};
		this.stateFile = path.join(this.stateDir, "state.json");
		this.journalFile = path.join(this.stateDir, "journal.json");
	}
	async lock(recoverLock = false) {
		await noLinks(this.stateDir);
		await noLinks(this.root);
		await fs.mkdir(this.stateDir, { recursive: true, mode: 0o700 });
		if (
			process.platform !== "win32" &&
			(await fs.stat(this.stateDir)).mode & 0o077
		)
			throw new Error("State directory requires mode 0700");
		await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
		const acquired = [];
		try {
			for (const lockPath of [
				path.join(this.stateDir, "lock.json"),
				path.join(this.root, ".memos-sync.lock.json"),
			]) {
				await noLinks(lockPath);
				if (recoverLock) {
					const old = await bytesOrNull(lockPath);
					if (old) {
						const lock = JSON.parse(old);
						if (
							lock.host !== hostname() ||
							!Number.isSafeInteger(lock.pid) ||
							lock.pid < 1
						)
							throw new Error("Cannot verify stale lock owner");
						try {
							process.kill(lock.pid, 0);
							throw new Error("Lock owner still alive");
						} catch (error) {
							if (error.code !== "ESRCH") throw error;
						}
						await fs.unlink(lockPath);
					}
				}
				const file = await fs.open(lockPath, "wx", 0o600);
				await file.writeFile(
					JSON.stringify({ pid: process.pid, host: hostname() }),
				);
				await file.close();
				acquired.push(lockPath);
			}
		} catch (error) {
			for (const lockPath of acquired.reverse()) await fs.unlink(lockPath);
			throw error;
		}
		return async () => {
			for (const lockPath of acquired.reverse()) await fs.unlink(lockPath);
		};
	}
	async load() {
		const bytes = await bytesOrNull(this.stateFile);
		const state = bytes
			? JSON.parse(bytes)
			: {
					schema: 1,
					generation: 0,
					binding: this.binding,
					entries: {},
					files: {},
				};
		if (
			state.schema !== 1 ||
			!Number.isSafeInteger(state.generation) ||
			JSON.stringify(state.binding) !== JSON.stringify(this.binding) ||
			!state.entries ||
			!state.files
		)
			throw new Error("State binding/schema mismatch");
		for (const name of Object.keys(state.files)) outputPath(this.root, name);
		for (const sha of Object.values(state.files))
			if (!/^[a-f0-9]{64}$/u.test(sha))
				throw new Error("Invalid state file digest");
		for (const [name, entry] of Object.entries(state.entries)) {
			if (
				!/^memos\/[a-zA-Z0-9_-]+$/u.test(name) ||
				typeof entry.active !== "boolean" ||
				entry.path !== `${entry.slug}.md` ||
				!Number.isFinite(Date.parse(entry.firstPublished))
			)
				throw new Error("Invalid state identity");
			outputPath(this.root, entry.path);
		}
		return state;
	}
	async recover(dryRun) {
		const bytes = await bytesOrNull(this.journalFile);
		if (!bytes) return;
		if (dryRun)
			throw new Error(
				"Pending transaction: run apply to recover before dry-run",
			);
		const journal = JSON.parse(bytes);
		if (JSON.stringify(journal.binding) !== JSON.stringify(this.binding))
			throw new Error("Journal binding mismatch");
		const state = await this.load();
		if (state.generation !== journal.nextGeneration) {
			if (state.generation !== journal.nextGeneration - 1)
				throw new Error("Journal generation mismatch");
			// Roll BACK interrupted output, then fetch fresh source. Never replay stale public content.
			for (const op of [...journal.operations].reverse()) {
				const target = outputPath(this.root, op.path);
				const actual = await bytesOrNull(target);
				if (hashOrNull(actual) === op.beforeHash) continue;
				if (hashOrNull(actual) !== op.afterHash)
					throw new Error("Recovery conflict; manual intervention required");
				if (op.before === null) await fs.unlink(target);
				else await atomicWrite(target, Buffer.from(op.before, "base64"));
			}
		}
		await fs.unlink(this.journalFile);
	}
	async commit(state, desired, { inject = () => {} } = {}) {
		const operations = [];
		for (const name of new Set([
			...Object.keys(state.files),
			...desired.keys(),
		])) {
			const target = outputPath(this.root, name);
			const actual = await bytesOrNull(target);
			const beforeHash = hashOrNull(actual);
			const expected = state.files[name] ?? null;
			if (beforeHash !== expected) throw new Error("Output ownership conflict");
			const after = desired.get(name) ?? null;
			const afterHash = hashOrNull(after);
			if (beforeHash !== afterHash)
				operations.push({
					path: name,
					before: actual?.toString("base64") ?? null,
					beforeHash,
					afterHash,
				});
		}
		const next = {
			...state,
			generation: state.generation + 1,
			files: Object.fromEntries(
				[...desired].map(([name, bytes]) => [name, digest(bytes)]),
			),
		};
		await atomicWrite(
			this.journalFile,
			JSON.stringify({
				binding: this.binding,
				nextGeneration: next.generation,
				operations,
			}),
		);
		inject("journal");
		for (const op of operations) {
			const target = outputPath(this.root, op.path);
			if (hashOrNull(await bytesOrNull(target)) !== op.beforeHash)
				throw new Error("Concurrent output modification");
			if (op.afterHash === null) await fs.unlink(target);
			else await atomicWrite(target, desired.get(op.path));
			inject(op.path);
		}
		inject("before-state");
		await atomicWrite(this.stateFile, JSON.stringify(next, null, 2));
		inject("after-state");
		await fs.unlink(this.journalFile);
		return next;
	}
}
