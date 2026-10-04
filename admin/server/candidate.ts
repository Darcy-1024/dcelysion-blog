import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isConfiguration } from "../shared/configuration.js";
import type { Draft } from "../shared/contracts.js";
import type { PublishTarget } from "../shared/publishing.js";
import {
	configurationDependencies,
	configurationPath,
} from "./configuration.js";
import { controlledPath, DraftError, hash } from "./drafts.js";
import {
	bytesHash,
	command,
	pathName,
	safeFile,
	writeControlled,
} from "./executor.js";

import { distributionPath } from "./media-distribution.js";
export const contentPath = (draft: Draft) =>
	isConfiguration(draft.kind)
		? configurationPath(draft.kind, draft.path)
		: `src/content/${draft.kind}/${controlledPath(draft.path, draft.kind)}`;
const oid = (value: string) => {
	if (!/^[a-f0-9]{40}$/u.test(value)) throw new DraftError(409, "GIT_BASE");
	return value;
};
const git = (root: string, args: string[]) =>
	command(
		"git",
		[
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"protocol.file.allow=always",
			...args,
		],
		root,
	);
const refreshes = new Map<string, Promise<void>>();
export class CandidateExecutor {
	constructor(
		readonly repository: string,
		readonly remote: string,
		readonly branch: string,
		private cacheRoot?: string,
	) {
		if (
			!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/u.test(branch) ||
			branch.includes("..") ||
			branch.endsWith("/")
		)
			throw new Error("Invalid publication branch");
		if (!remote || remote.startsWith("-") || /[\r\n]/u.test(remote))
			throw new Error("Invalid publication remote");
	}
	async remoteHead() {
		const result = await git(this.repository, [
			"ls-remote",
			"--refs",
			this.remote,
			`refs/heads/${this.branch}`,
		]);
		const head = result.trim().split(/\s/u)[0];
		return oid(head);
	}
	async read(root: string, commit: string, path: string) {
		let sourceRoot = root;
		if (root === this.repository && this.cacheRoot) {
			const cache = this.cacheRoot;
			const previous = refreshes.get(cache) || Promise.resolve();
			const refresh = previous
				.catch(() => {})
				.then(async () => {
					await mkdir(cache, { recursive: true });
					await git(cache, ["init", "--bare"]);
					await git(cache, [
						"fetch",
						"--no-tags",
						this.remote,
						`refs/heads/${this.branch}:refs/heads/source`,
					]);
				});
			refreshes.set(cache, refresh);
			try {
				await refresh;
			} finally {
				if (refreshes.get(cache) === refresh) refreshes.delete(cache);
			}
			sourceRoot = cache;
		}
		try {
			await git(sourceRoot, ["cat-file", "-e", `${oid(commit)}^{commit}`]);
		} catch {
			throw new DraftError(409, "GIT_BASE");
		}
		try {
			return await git(sourceRoot, [
				"show",
				`${oid(commit)}:${pathName(path)}`,
			]);
		} catch {
			return null;
		}
	}
	async checkSource(draft: Draft, base: string, root = this.repository) {
		if (isConfiguration(draft.kind))
			for (const path of configurationDependencies[draft.kind]) {
				const dependency = await this.read(root, base, path);
				if (
					dependency === null ||
					hash(dependency) !== draft.baseDependencies?.[path]
				)
					throw new DraftError(409, "CONFIG_ADAPTER_MISSING");
			}
		const source = await this.read(root, base, contentPath(draft));
		if (
			draft.sourceId
				? source === null || hash(source) !== draft.baseHash
				: source !== null
		)
			throw new DraftError(409, "SOURCE_CONFLICT");
	}
	async prepare(
		directory: string,
		draft: Draft,
		expected: string,
		target: PublishTarget,
		allowUnchanged = false,
		distribution?: string,
	) {
		const repo = join(directory, "git");
		await mkdir(directory, { recursive: true });
		// No working-tree files, credentials, local config, or linked .git are copied.
		await command("git", [
			"-c",
			"core.hooksPath=/dev/null",
			"clone",
			"--no-local",
			"--no-checkout",
			"--",
			this.repository,
			repo,
		]);
		await git(repo, [
			"fetch",
			"--no-tags",
			this.remote,
			`refs/heads/${this.branch}`,
		]);
		if ((await git(repo, ["rev-parse", "FETCH_HEAD"])).trim() !== expected)
			throw new DraftError(409, "REMOTE_CONFLICT");
		await this.checkSource(draft, expected, repo);
		// Export selected tracked blobs; no checkout filters, hooks, submodules or symlinks.
		const listing = await git(repo, ["ls-tree", "-rz", oid(expected)]);
		const input = join(directory, "input");
		await mkdir(input, { recursive: true });
		for (const record of listing.split("\0").filter(Boolean)) {
			const match = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/su.exec(record);
			if (!match) continue;
			const name = match[3];
			if (
				/(?:^|\/)\.env(?:\.|$)/u.test(name) &&
				!name.endsWith("/.env.example") &&
				name !== ".env.example"
			)
				throw new DraftError(422, "PUBLISH_INVALID");
			if (
				!/^(?:src\/|public\/|scripts\/|workers\/sites-static\/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|astro\.config\.mjs$|tsconfig\.json$|tailwind\.config\.[cm]?[jt]s$|postcss\.config\.[cm]?[jt]s$)/u.test(
					name,
				)
			)
				continue;
			pathName(name);
			if (match[1] !== "100644" && match[1] !== "100755")
				throw new DraftError(400, "PATH");
			// Buffer mode is required for binary public assets.
			const { execFile } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const result = await promisify(execFile)(
				"git",
				["cat-file", "blob", match[2]],
				{
					cwd: repo,
					encoding: "buffer",
					maxBuffer: 64 * 1024 * 1024,
					windowsHide: true,
				},
			);
			await writeControlled(input, name, result.stdout);
		}
		await writeControlled(input, contentPath(draft), draft.source);
		// Bare index and explicit one-file staging; never git add -A.
		await git(repo, ["read-tree", expected]);
		const blob = (
			await command("git", ["hash-object", "-w", "--stdin"], repo, draft.source)
		).trim();
		await git(repo, [
			"update-index",
			"--add",
			"--cacheinfo",
			`100644,${oid(blob)},${contentPath(draft)}`,
		]);
		if (distribution !== undefined) {
			await writeControlled(input, distributionPath, distribution);
			const mediaBlob = (
				await command(
					"git",
					["hash-object", "-w", "--stdin"],
					repo,
					distribution,
				)
			).trim();
			await git(repo, [
				"update-index",
				"--add",
				"--cacheinfo",
				`100644,${oid(mediaBlob)},${distributionPath}`,
			]);
		}
		const changes = (
			await git(repo, ["diff", "--cached", "--name-only", expected])
		)
			.trim()
			.split("\n")
			.filter(Boolean);
		if (
			!(allowUnchanged && changes.length === 0) &&
			(changes.length === 0 ||
				changes.some(
					(path) =>
						path !== contentPath(draft) &&
						!(distribution !== undefined && path === distributionPath),
				))
		)
			throw new DraftError(409, "NO_CHANGES");
		const tree = (await git(repo, ["write-tree"])).trim();
		const commit = (
			await git(repo, [
				"-c",
				"user.name=DcElysion Admin",
				"-c",
				"user.email=admin@localhost",
				"commit-tree",
				oid(tree),
				"-p",
				expected,
				"-m",
				`content: publish ${draft.kind}/${draft.path} r${draft.revision}`,
			])
		).trim();
		await git(repo, ["update-ref", "refs/heads/admin-candidate", oid(commit)]);
		if (target.branch !== this.branch)
			throw new DraftError(409, "TARGET_CHANGED");
		return { commit: oid(commit), input, repo };
	}
	async diff(draft: Draft, base: string) {
		await this.checkSource(draft, base);
		return {
			path: contentPath(draft),
			before: await this.read(this.repository, base, contentPath(draft)),
			after: draft.source,
		};
	}
	async verifyCandidate(
		directory: string,
		commit: string,
		base: string,
		draft: Draft,
		distributionHash?: string,
	) {
		const repo = join(directory, "git");
		if ((await git(repo, ["rev-parse", `${oid(commit)}^`])).trim() !== base)
			throw new DraftError(409, "GIT_BASE");
		const names = (await git(repo, ["diff", "--name-only", base, commit]))
			.trim()
			.split("\n");
		if (
			names.some(
				(path) =>
					path !== contentPath(draft) &&
					!(distributionHash && path === distributionPath),
			) ||
			(await this.read(repo, commit, contentPath(draft))) !== draft.source
		)
			throw new DraftError(409, "GIT_BASE");
		if (distributionHash) {
			const source = await this.read(repo, commit, distributionPath);
			if (
				!source ||
				hash(source) !== distributionHash ||
				bytesHash(
					await readFile(
						await safeFile(join(directory, "input"), distributionPath),
					),
				) !== distributionHash
			)
				throw new DraftError(409, "GIT_BASE");
		}
		const file = await safeFile(join(directory, "input"), contentPath(draft));
		if (bytesHash(await readFile(file)) !== hash(draft.source))
			throw new DraftError(409, "GIT_BASE");
	}
	async push(directory: string, commit: string, base: string) {
		const head = await this.remoteHead();
		if (head === commit) return;
		if (head !== base) throw new DraftError(409, "REMOTE_CONFLICT");
		// Standard non-force push atomically refuses a concurrent non-fast-forward advance.
		await git(join(directory, "git"), [
			"push",
			"--porcelain",
			this.remote,
			`${oid(commit)}:refs/heads/${this.branch}`,
		]);
		if ((await this.remoteHead()) !== commit)
			throw new DraftError(409, "REMOTE_CONFLICT");
	}
}
