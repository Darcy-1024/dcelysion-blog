import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { MemosClient } from "./client.mjs";
import { fingerprint, publicMemo, semanticMemo } from "./content.mjs";
import { snapshot, synchronize, validateConfig } from "./index.mjs";
import {
	atomicWrite,
	bytesOrNull,
	hashOrNull,
	noLinks,
	outputPath,
} from "./store.mjs";

const executeFile = promisify(execFile);
const prefix = "src/content/dynamic/";
const split = (value) => value.split("\0").filter(Boolean);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function validatePublication(raw) {
	const config = validateConfig({ ...raw.sync });
	if (
		typeof raw.enabled !== "boolean" ||
		(!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/u.test(raw.remoteUrl) &&
			!path.isAbsolute(raw.remoteUrl ?? "")) ||
		!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/u.test(raw.branch ?? "") ||
		raw.branch.includes("..") ||
		!raw.authorName ||
		/[\r\n]/u.test(raw.authorName) ||
		!/^[^\s<>]+@[^\s<>]+$/u.test(raw.authorEmail ?? "") ||
		!Number.isInteger(raw.settleMs) ||
		raw.settleMs < 0 ||
		raw.settleMs > 60000
	)
		throw new Error("Invalid publication configuration");
	return { ...raw, sync: config };
}

// No shell, prompts, hooks, signing or credential-bearing error output.
export async function git(root, args) {
	try {
		const result = await executeFile(
			"git",
			[
				"-c",
				`core.hooksPath=${path.join(root, ".git", "memos-empty-hooks")}`,
				"-c",
				"commit.gpgsign=false",
				...args,
			],
			{
				cwd: root,
				timeout: 45000,
				maxBuffer: 8 * 1024 * 1024,
				env: {
					...process.env,
					GIT_TERMINAL_PROMPT: "0",
					GIT_OPTIONAL_LOCKS: "0",
				},
			},
		);
		return result.stdout.trimEnd();
	} catch {
		throw new Error(
			`Git ${args[0]} failed; inspect private checkout without logging credentials`,
		);
	}
}

async function dirty(root) {
	return [
		...new Set([
			...split(await git(root, ["diff", "--name-only", "-z", "HEAD", "--"])),
			...split(
				await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
			),
			// Ignored managed output must not turn a real pending publication into
			// a false no-op. git add will fail closed until the ignore is reviewed.
			...split(await git(root, ["ls-files", "--others", "-z", "--", prefix])),
		]),
	]
		.filter((name) => name !== ".memos-sync.lock.json")
		.sort();
}

function owned(state, names, root) {
	const known = new Set([
		...Object.keys(state.files),
		...Object.values(state.entries).map((entry) => entry.path),
	]);
	for (const name of names) {
		if (!name.startsWith(prefix) || !known.has(name.slice(prefix.length)))
			throw new Error("Unrelated checkout changes; publication stopped");
		outputPath(root, name.slice(prefix.length));
	}
}

export async function verifySource(client, config, state) {
	client.deadline = Date.now() + config.maxRunMs;
	const records = await snapshot(client, config.creator, state.entries);
	for (const [name, memo] of Object.entries(records)) {
		const entry = state.entries[name];
		if (publicMemo(memo, config.creator) && !entry)
			throw new Error("Source changed before publication");
		if (
			entry &&
			(entry.active !== publicMemo(memo, config.creator) ||
				entry.sourceDigest !== fingerprint(semanticMemo(memo)))
		)
			throw new Error("Source changed before publication");
	}
}

async function verifyFiles(root, state) {
	for (const [name, sha] of Object.entries(state.files)) {
		if (hashOrNull(await bytesOrNull(outputPath(root, name))) !== sha)
			throw new Error("Managed bytes changed after synchronization");
	}
	for (const entry of Object.values(state.entries)) {
		if (!entry.active && (await bytesOrNull(outputPath(root, entry.path))))
			throw new Error("Withdrawn content unexpectedly present");
	}
}

async function checkout(config) {
	const root = config.sync.outputRoot;
	await noLinks(path.join(root, ".git"));
	if (!(await fs.stat(path.join(root, ".git"))).isDirectory())
		throw new Error("Dedicated standalone clone required");
	if (
		path.resolve(await git(root, ["rev-parse", "--show-toplevel"])) !==
			path.resolve(root) ||
		(await git(root, ["config", "--local", "--get", "memos.publisher"])) !==
			"true" ||
		(await git(root, ["remote", "get-url", "origin"])) !== config.remoteUrl ||
		(await git(root, ["remote", "get-url", "--push", "origin"])) !==
			config.remoteUrl ||
		(await git(root, ["symbolic-ref", "--short", "HEAD"])) !== config.branch
	)
		throw new Error("Dedicated checkout/remote/branch binding mismatch");
	for (const name of [
		"MERGE_HEAD",
		"CHERRY_PICK_HEAD",
		"REVERT_HEAD",
		"rebase-merge",
		"rebase-apply",
	]) {
		if (
			await fs.lstat(path.join(root, ".git", name)).catch((error) => {
				if (error.code !== "ENOENT") throw error;
				return null;
			})
		)
			throw new Error("Unfinished Git operation");
	}
}

export async function publish(
	raw,
	{
		execute = false,
		token,
		client: suppliedClient,
		resume = false,
		recoverLock = false,
		inject = async () => {},
	} = {},
) {
	const config = validatePublication(raw);
	if (!config.enabled || !execute)
		return {
			status: "disabled",
			git: "disabled",
			build: "not-run",
			deployment: "disabled",
		};
	// Existing platform jobs have no latest-only deployment gate. Explicit acceptance
	// of eventual withdrawal is required; a Git guard cannot make deployment atomic.
	if (config.withdrawalPolicy !== "eventual-current-site-operator-accepted")
		throw new Error(
			"Deployment ordering/withdrawal policy has not been accepted",
		);
	const root = config.sync.outputRoot;
	const privatePath = (name) => path.join(config.sync.stateDir, name);
	const journalFile = privatePath("publication-journal.json");
	const receiptFile = privatePath("publication-receipt.json");
	const haltFile = privatePath("publication-halted.json");
	const client = suppliedClient ?? new MemosClient({ ...config.sync, token });
	let base;
	let latestReceipt;
	const write = (target, value) =>
		atomicWrite(target, JSON.stringify(value, null, 2));
	const fetchHead = async () => {
		await git(root, [
			"fetch",
			"--no-tags",
			"origin",
			`refs/heads/${config.branch}`,
		]);
		return git(root, ["rev-parse", "FETCH_HEAD"]);
	};
	async function finish(store, state, journal) {
		if (
			journal.binding !==
				fingerprint({
					...store.binding,
					remote: config.remoteUrl,
					branch: config.branch,
				}) ||
			journal.generation !== state.generation ||
			journal.stateDigest !== fingerprint(state)
		)
			throw new Error("Publication journal binding/state conflict");
		const sha = await git(root, ["rev-parse", "HEAD"]);
		await verifyFiles(root, state);
		if (sha === journal.base) {
			// Prepared journal, commit never completed: remove only our index entries,
			// retain working bytes, then let synchronize read the CURRENT source.
			owned(state, journal.names, root);
			if (
				(await git(root, ["write-tree"])) !== journal.tree ||
				JSON.stringify(await dirty(root)) !== JSON.stringify(journal.names)
			)
				throw new Error("Prepared index conflict; manual recovery required");
			await git(root, ["restore", "--staged", "--", ...journal.names]);
			await fs.unlink(journalFile);
			return;
		}
		if (
			(await git(root, ["rev-parse", "HEAD^"])) !== journal.base ||
			(await git(root, ["rev-parse", "HEAD^{tree}"])) !== journal.tree ||
			(await dirty(root)).length
		)
			throw new Error("Pending commit conflict; inspect dedicated checkout");
		const remote = await fetchHead();
		const alreadyPushed =
			remote === sha || (await git(root, ["merge-base", sha, remote])) === sha;
		if (!alreadyPushed) {
			if (remote !== journal.base)
				throw new Error("Remote advanced; no force/rebase/replay allowed");
			await verifySource(client, config.sync, state);
			await inject("before-push");
			// Normal push rejects a concurrently advanced branch. Ambiguous transport
			// outcomes are resolved on resume by fetch, never by making a second commit.
			await git(root, ["push", "origin", `HEAD:refs/heads/${config.branch}`]);
			const observed = await fetchHead();
			if ((await git(root, ["merge-base", sha, observed])) !== sha)
				throw new Error("Push result not confirmed in remote ancestry");
		}
		latestReceipt = {
			schema: 1,
			status: "pushed-awaiting-build",
			generation: state.generation,
			commit: sha,
			git:
				remote !== sha && alreadyPushed
					? "remote-ancestry-confirmed"
					: "remote-head-confirmed",
			build: "pending",
			deployment: "unverified",
			observedAt: new Date().toISOString(),
		};
		await write(receiptFile, latestReceipt);
		await fs.unlink(journalFile);
	}
	// Both locks are held through Git, debounce, final source check and receipt.
	return synchronize(config.sync, {
		dryRun: false,
		token,
		client,
		recoverLock,
		prepare: async (store) => {
			await checkout(config);
			if (await bytesOrNull(haltFile)) {
				if (!resume)
					throw new Error(
						"Publication halted; inspect cause then use --resume",
					);
				await fs.unlink(haltFile);
			}
			try {
				const state = await store.load();
				const pending = await bytesOrNull(journalFile);
				if (pending) await finish(store, state, JSON.parse(pending));
				if (await git(root, ["diff", "--cached", "--name-only"]))
					throw new Error(
						"Pre-existing staged changes; manual recovery required",
					);
				const changes = await dirty(root);
				owned(state, changes, root);
				base = await git(root, ["rev-parse", "HEAD"]);
				const remote = await fetchHead();
				if (remote !== base) {
					if (changes.length)
						throw new Error("Remote advanced while local changes pending");
					await git(root, ["merge", "--ff-only", remote]);
					base = await git(root, ["rev-parse", "HEAD"]);
					if (base !== remote)
						throw new Error("Unrecorded local commits refused");
				}
			} catch (error) {
				await write(haltFile, {
					status: "halted",
					at: new Date().toISOString(),
				});
				throw error;
			}
		},
		complete: async ({ store, state, receipt }) => {
			try {
				await inject("after-sync");
				const names = await dirty(root);
				owned(state, names, root);
				if (!names.length)
					return (
						latestReceipt ?? {
							status: "no-git-change",
							localSync: receipt.status,
							git: "unchanged",
							build: "not-requested",
							deployment: "unverified",
						}
					);
				await pause(config.settleMs);
				await verifySource(client, config.sync, state);
				await verifyFiles(root, state);
				if (
					(await fetchHead()) !== base ||
					(await git(root, ["rev-parse", "HEAD"])) !== base
				)
					throw new Error("Remote/local head changed before commit");
				await git(root, ["add", "--", ...names]);
				const staged = split(
					await git(root, ["diff", "--cached", "--name-only", "-z"]),
				).sort();
				if (JSON.stringify(staged) !== JSON.stringify(names))
					throw new Error("Staged file set differs from managed candidate");
				const tree = await git(root, ["write-tree"]);
				const journal = {
					binding: fingerprint({
						...store.binding,
						remote: config.remoteUrl,
						branch: config.branch,
					}),
					generation: state.generation,
					stateDigest: fingerprint(state),
					base,
					tree,
					names,
				};
				await write(journalFile, journal);
				await inject("before-commit");
				await git(root, [
					"-c",
					`user.name=${config.authorName}`,
					"-c",
					`user.email=${config.authorEmail}`,
					"commit",
					"-m",
					"chore(dynamic): sync public Memos updates",
				]);
				await inject("after-commit");
				await finish(store, state, journal);
				return latestReceipt;
			} catch (error) {
				await write(haltFile, {
					status: "halted",
					at: new Date().toISOString(),
				});
				throw error;
			}
		},
		failed: async () => {
			// Called inside both locks, including source/download/apply failures.
			await write(haltFile, { status: "halted", at: new Date().toISOString() });
		},
	});
}

async function main() {
	const args = process.argv.slice(2);
	if (args.includes("--help")) {
		console.log(
			"node scripts/memos-sync/publish.mjs --config <private.json> [--execute] [--resume] [--recover-lock]\nDisabled unless config.enabled and --execute. Uses only an explicitly marked dedicated clone.",
		);
		return;
	}
	if (
		!args.includes("--config") ||
		args.some(
			(arg, i) =>
				!["--config", "--execute", "--resume", "--recover-lock"].includes(
					arg,
				) && args[i - 1] !== "--config",
		)
	)
		throw new Error("Invalid arguments; see --help");
	const config = validatePublication(
		JSON.parse(await fs.readFile(args[args.indexOf("--config") + 1], "utf8")),
	);
	let token;
	if (config.enabled && args.includes("--execute")) {
		await noLinks(config.sync.tokenFile);
		if (
			process.platform !== "win32" &&
			(await fs.stat(config.sync.tokenFile)).mode & 0o077
		)
			throw new Error("PAT file requires mode 0600");
		token = (await fs.readFile(config.sync.tokenFile, "utf8")).trim();
	}
	console.log(
		JSON.stringify(
			await publish(config, {
				execute: args.includes("--execute"),
				resume: args.includes("--resume"),
				recoverLock: args.includes("--recover-lock"),
				token,
			}),
			null,
			2,
		),
	);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	main().catch(() => {
		console.error(
			JSON.stringify({
				status: "failed",
				action: "inspect-private-state",
				deployment: "unverified",
			}),
		);
		process.exitCode = 1;
	});
