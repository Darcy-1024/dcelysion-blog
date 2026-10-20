import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { MemosClient } from "./client.mjs";
import {
	convertMemo,
	digest,
	fingerprint,
	publicationTime,
	publicMemo,
	semanticMemo,
	validateMemo,
} from "./content.mjs";
import {
	atomicWrite,
	bytesOrNull,
	hashOrNull,
	noLinks,
	outputPath,
	Store,
} from "./store.mjs";

export function validateConfig(config) {
	if (
		!config ||
		!/^[a-zA-Z0-9_-]{1,100}$/u.test(config.instanceId) ||
		!/^users\/[a-zA-Z0-9_-]+$/u.test(config.creator) ||
		!path.isAbsolute(config.stateDir ?? "") ||
		!path.isAbsolute(config.outputRoot ?? "") ||
		config.publish !== false
	)
		throw new Error("Invalid config; publish must be false and paths absolute");
	new Intl.DateTimeFormat("en", { timeZone: config.timezone });
	for (const [key, fallback, max] of [
		["timeoutMs", 15000, 60000],
		["maxRunMs", 300000, 3600000],
		["maxPages", 100, 1000],
		["maxItems", 10000, 100000],
		["maxAttachmentBytes", 20 * 1024 * 1024, 50 * 1024 * 1024],
		["maxTotalAttachmentBytes", 128 * 1024 * 1024, 512 * 1024 * 1024],
	]) {
		config[key] ??= fallback;
		if (
			!Number.isSafeInteger(config[key]) ||
			config[key] < 1 ||
			config[key] > max
		)
			throw new Error(`Invalid limit: ${key}`);
	}
	return config;
}

async function proof(client, creator) {
	const profile = await client.json("/api/v1/instance/profile");
	if (profile.version !== "0.31.0")
		throw new Error("Instance version differs from pinned 0.31.0 contract");
	const me = await client.json("/api/v1/auth/me");
	if (me.user?.name !== creator)
		throw new Error("PAT must belong to the configured author");
}

export async function snapshot(client, creator, known) {
	await proof(client, creator);
	const records = {};
	for (const state of ["NORMAL", "ARCHIVED"]) {
		const memos = await client.pages("/api/v1/memos", "memos", {
			state,
			filter: `creator == "${creator}"`,
			orderBy: "update_time asc",
		});
		for (const memo of memos) {
			validateMemo(memo);
			if (memo.creator !== creator) continue;
			if (memo.state !== state || Object.hasOwn(records, memo.name))
				throw new Error("Duplicate/inconsistent memo list");
			records[memo.name] = memo;
		}
	}
	// Re-read exported candidates and all historical identities. Missing IDs need author-authorized details.
	for (const name of new Set([
		...Object.keys(known),
		...Object.keys(records).filter((name) =>
			publicMemo(records[name], creator),
		),
	])) {
		const memo = await client.memo(name);
		if (memo) {
			validateMemo(memo);
			if (memo.name !== name || memo.creator !== creator)
				throw new Error("Detail identity mismatch");
			if (
				records[name] &&
				fingerprint(semanticMemo(records[name])) !==
					fingerprint(semanticMemo(memo))
			)
				throw new Error("Source changed during list/detail read");
			if (publicMemo(memo, creator)) {
				const attachments = await client.pages(
					`/api/v1/${name}/attachments`,
					"attachments",
				);
				if (fingerprint(attachments) !== fingerprint(memo.attachments ?? []))
					throw new Error("Attachment list mismatch");
			}
		}
		records[name] = memo;
	}
	await proof(client, creator);
	return Object.fromEntries(
		Object.entries(records).sort(([a], [b]) => a.localeCompare(b)),
	);
}

async function identities(root) {
	const result = new Map();
	const dir = path.join(root, "src/content/dynamic");
	await noLinks(dir);
	async function walk(parent, prefix = "") {
		for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
			if (entry.isSymbolicLink()) throw new Error("Content symlink refused");
			const relative = prefix + entry.name;
			if (entry.isDirectory()) {
				if (entry.name !== "images")
					await walk(path.join(parent, entry.name), `${relative}/`);
				continue;
			}
			if (!entry.name.endsWith(".md")) continue;
			const source = await fs.readFile(path.join(parent, entry.name), "utf8");
			const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
			const metadata = match ? parseYaml(match[1]) : {};
			const id = metadata?.slug || relative.slice(0, -3);
			if (result.has(id))
				throw new Error("Existing duplicate dynamic identity");
			result.set(id, relative);
		}
	}
	try {
		await fs.access(dir);
	} catch (error) {
		if (error.code === "ENOENT") return result;
		throw error;
	}
	await walk(dir);
	return result;
}

export async function synchronize(
	rawConfig,
	{
		dryRun = true,
		token,
		client: suppliedClient,
		now = new Date(),
		recoverLock = false,
		inject,
		prepare,
		complete,
		failed,
	} = {},
) {
	const config = validateConfig({ ...rawConfig });
	const store = new Store(config);
	const unlock = await store.lock(recoverLock);
	try {
		await store.recover(dryRun);
		if (prepare) await prepare(store);
		const state = await store.load();
		const client = suppliedClient ?? new MemosClient({ ...config, token });
		client.deadline = Date.now() + config.maxRunMs;
		client.attachmentBytes = 0;
		const first = await snapshot(client, config.creator, state.entries);
		const next = structuredClone(state);
		const desired = new Map();
		const originals = new Map();
		// Keep historical exported image assets. Garbage collection requires a separate decision.
		for (const name of Object.keys(state.files).filter((name) =>
			name.startsWith("images/"),
		)) {
			const data = await bytesOrNull(outputPath(store.root, name));
			if (hashOrNull(data) !== state.files[name])
				throw new Error("Managed image conflict");
			desired.set(name, data);
		}
		const occupied = await identities(store.root);
		const changes = [];
		for (const [name, memo] of Object.entries(first)) {
			const old = state.entries[name];
			if (!publicMemo(memo, config.creator)) {
				if (old) {
					next.entries[name] = {
						...old,
						active: false,
						sourceDigest: fingerprint(semanticMemo(memo)),
						attachments: {},
					};
					if (old.active)
						changes.push({
							id: old.slug,
							action: "withdraw",
							reason: memo ? "not-public-main-memo" : "author-confirmed-404",
						});
				}
				continue;
			}
			const firstPublished = old?.firstPublished ?? now.toISOString();
			const published =
				old?.published ??
				publicationTime(new Date(firstPublished), config.timezone);
			// Always suffix with stable instance+ID hash, including same-second collisions.
			const slug =
				old?.slug ??
				`${published.replace(" ", "-").replaceAll(":", "")}-memos-${digest(`${config.instanceId}:${name}`).slice(0, 16)}`;
			const filename = `${slug}.md`;
			if (occupied.has(slug) && occupied.get(slug) !== old?.path)
				throw new Error("Dynamic slug collision");
			const converted = await convertMemo(memo, client, config);
			if (memo.pinned !== undefined && typeof memo.pinned !== "boolean")
				throw new Error("Invalid pinned field");
			if (
				memo.location?.placeholder !== undefined &&
				typeof memo.location.placeholder !== "string"
			)
				throw new Error("Invalid location field");
			const extra = `${memo.pinned ? "pinned: true\n" : ""}${memo.location?.placeholder ? `location: ${JSON.stringify(memo.location.placeholder)}\n` : ""}`;
			// YAML parses an unzoned timestamp as UTC; preserve the actual first-publication instant.
			const bytes = Buffer.from(
				`---\npublished: ${firstPublished}\n${extra}---\n\n${converted.body}`,
			);
			desired.set(filename, bytes);
			for (const [target, data] of converted.files) desired.set(target, data);
			for (const [sha, data] of converted.originals) originals.set(sha, data);
			next.entries[name] = {
				path: filename,
				slug,
				firstPublished,
				published,
				sourceDigest: fingerprint(semanticMemo(memo)),
				active: true,
				attachments: converted.attachments,
				lastSyncedGeneration: state.generation + 1,
				lastPublishedVersion: old?.lastPublishedVersion ?? null,
			};
			if (state.files[filename] !== digest(bytes))
				changes.push({
					id: slug,
					action: old?.active ? "update" : "create",
					beforeSha256: state.files[filename] ?? null,
					afterSha256: digest(bytes),
					commentPath: `/dynamic/${slug}/`,
				});
		}
		// Do not apply a plan built against a changing API. This is a guard, not a source transaction.
		const second = await snapshot(client, config.creator, state.entries);
		const semanticSnapshot = (records) =>
			Object.fromEntries(
				Object.entries(records).map(([name, memo]) => [
					name,
					semanticMemo(memo),
				]),
			);
		if (
			fingerprint(semanticSnapshot(first)) !==
			fingerprint(semanticSnapshot(second))
		)
			throw new Error("Source changed; retry from a fresh snapshot");
		for (const name of new Set([
			...Object.keys(state.files),
			...desired.keys(),
		])) {
			const actual = await bytesOrNull(outputPath(store.root, name));
			if (hashOrNull(actual) !== (state.files[name] ?? null))
				throw new Error("Managed file conflict; no files applied");
		}
		const files = [];
		for (const name of new Set([
			...Object.keys(state.files),
			...desired.keys(),
		])) {
			const before = state.files[name] ?? null;
			const after = hashOrNull(desired.get(name) ?? null);
			if (before !== after)
				files.push({
					path: name,
					action:
						after === null ? "delete" : before === null ? "create" : "update",
					beforeSha256: before,
					afterSha256: after,
				});
		}
		const receipt = {
			schema: 1,
			mode: dryRun ? "dry-run" : "apply",
			status: dryRun ? "candidate" : "synced-local",
			generation: state.generation + (dryRun ? 0 : 1),
			changes,
			files,
			git: "disabled",
			build: "not-run",
			deployment: "disabled",
			sourceConsistency: "bounded-double-read-not-transactional",
		};
		if (!dryRun) {
			for (const [sha, data] of originals)
				await atomicWrite(path.join(store.stateDir, "originals", sha), data);
			await store.commit(next, desired, { inject });
			await atomicWrite(
				path.join(store.stateDir, "receipt.json"),
				JSON.stringify(receipt, null, 2),
			);
		}
		// The publisher runs inside BOTH locks; standalone CLI never supplies hooks.
		return complete && !dryRun
			? await complete({ store, state: await store.load(), receipt, client })
			: receipt;
	} catch (error) {
		if (failed) await failed(error);
		throw error;
	} finally {
		await unlock();
	}
}

async function main() {
	const args = process.argv.slice(2);
	if (args.includes("--help")) {
		console.log(
			"node scripts/memos-sync/index.mjs --config <private.json> [--apply] [--recover-lock]\nDefault: dry-run. No Git or deployment. PAT loaded from config.tokenFile.",
		);
		return;
	}
	if (
		args.some(
			(arg, i) =>
				!["--config", "--apply", "--recover-lock"].includes(arg) &&
				args[i - 1] !== "--config",
		) ||
		!args.includes("--config")
	)
		throw new Error("Invalid arguments; see --help");
	const config = JSON.parse(
		await fs.readFile(args[args.indexOf("--config") + 1], "utf8"),
	);
	await noLinks(config.tokenFile);
	const tokenStat = await fs.stat(config.tokenFile);
	if (process.platform !== "win32" && tokenStat.mode & 0o077)
		throw new Error("PAT file requires mode 0600");
	const token = (await fs.readFile(config.tokenFile, "utf8")).trim();
	const receipt = await synchronize(config, {
		dryRun: !args.includes("--apply"),
		token,
		recoverLock: args.includes("--recover-lock"),
	});
	console.log(JSON.stringify(receipt, null, 2));
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	main().catch((error) => {
		// Never print response bodies, source Markdown, URLs or credentials.
		console.error(
			JSON.stringify({
				status: "failed",
				error: error instanceof Error ? error.message : "Unknown failure",
				git: "disabled",
				deployment: "disabled",
			}),
		);
		process.exitCode = 1;
	});
