import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { glob } from "glob";
import matter from "gray-matter";
import { marked } from "marked";
import { isValidGithubRepository } from "../src/utils/github-card-utils";

const OUTPUT_FILE = "src/constants/github-card-data.json";
const METADATA_FILE = "cache/build/github-card-meta.json";
export const GITHUB_CACHE_TTL_MS: number = 24 * 60 * 60 * 1000;
const CONTENT_GLOB = "src/content/**/*.{md,mdx}";
const GITHUB_DIRECTIVE_PATTERN =
	/::github\s*\{[^}]*\brepo\s*=\s*["']([^"']+)["'][^}]*\}/g;
const MAX_FETCH_ATTEMPTS = 2;
const RETRY_DELAY_MS = 750;
const TRANSIENT_NETWORK_CODES = new Set([
	"EAI_AGAIN",
	"ECONNRESET",
	"ENETUNREACH",
	"ENOTFOUND",
	"ETIMEDOUT",
	"UND_ERR_CONNECT_TIMEOUT",
]);

export interface GithubCardData {
	description: string | null;
	language: string | null;
	avatarUrl: string | null;
	license: string | null;
}

export type GithubCardCache = Record<string, GithubCardData>;
type GithubMetadata = Record<string, { fetchedAt: number; dataHash: string }>;

function dataHash(data: GithubCardData): string {
	return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

/** Ignore drafts and directives appearing inside Markdown examples. */
export function repositoriesInContent(content: string): string[] {
	const parsed = matter(content);
	if (parsed.data.draft === true) return [];
	const repositories = new Set<string>();
	marked.walkTokens(marked.lexer(parsed.content), (token) => {
		if (token.type !== "text") return;
		for (const match of token.raw.matchAll(GITHUB_DIRECTIVE_PATTERN)) {
			if (isValidGithubRepository(match[1])) repositories.add(match[1]);
		}
	});
	return [...repositories];
}

class GithubApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "GithubApiError";
	}
}

function isTransientError(error: unknown): boolean {
	if (error instanceof GithubApiError) {
		return error.status === 429 || error.status >= 500;
	}
	if (
		error instanceof Error &&
		(error.name === "AbortError" || error.name === "TimeoutError")
	) {
		return true;
	}

	let current: unknown = error;
	for (let depth = 0; depth < 4 && current; depth++) {
		if (typeof current !== "object") break;
		if (
			"code" in current &&
			typeof current.code === "string" &&
			TRANSIENT_NETWORK_CODES.has(current.code)
		) {
			return true;
		}
		current = "cause" in current ? current.cause : undefined;
	}
	return false;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readCache(): Promise<GithubCardCache> {
	try {
		return JSON.parse(await fs.readFile(OUTPUT_FILE, "utf-8"));
	} catch {
		return {};
	}
}

async function findRepositories(): Promise<Map<string, string>> {
	const repositories = new Map<string, string>();
	const contentFiles = await glob(CONTENT_GLOB);

	for (const file of contentFiles) {
		const content = await fs.readFile(file, "utf-8");
		for (const repo of repositoriesInContent(content)) {
			repositories.set(repo.toLowerCase(), repo);
		}
	}

	return repositories;
}

async function fetchRepositoryDataOnce(repo: string): Promise<GithubCardData> {
	const [owner, name] = repo.split("/");
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	const token = process.env.GITHUB_TOKEN?.trim();
	if (token) headers.Authorization = `Bearer ${token}`;

	const response = await fetch(
		`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
		{
			headers,
			signal: AbortSignal.timeout(5000),
		},
	);
	if (!response.ok) {
		throw new GithubApiError(
			`GitHub API returned ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
			response.status,
		);
	}

	const data = await response.json();
	return {
		description:
			typeof data.description === "string"
				? data.description.replace(/:[a-zA-Z0-9_]+:/g, "")
				: null,
		language: typeof data.language === "string" ? data.language : null,
		avatarUrl:
			typeof data.owner?.avatar_url === "string" ? data.owner.avatar_url : null,
		license:
			typeof data.license?.spdx_id === "string" ? data.license.spdx_id : null,
	};
}

async function fetchRepositoryData(repo: string): Promise<GithubCardData> {
	for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
		try {
			return await fetchRepositoryDataOnce(repo);
		} catch (error) {
			if (attempt === MAX_FETCH_ATTEMPTS || !isTransientError(error)) {
				throw error;
			}
			console.log(
				`[GITHUB-CARD] Temporary refresh failure for ${repo}; retrying once in ${RETRY_DELAY_MS}ms.`,
			);
			await wait(RETRY_DELAY_MS);
		}
	}
	throw new Error(`GitHub card refresh exhausted retries for ${repo}`);
}

export async function refreshRepositories(
	repositories: Map<string, string>,
	existingCache: GithubCardCache,
	metadata: GithubMetadata,
	{
		now = Date.now(),
		force = false,
		fetchData = fetchRepositoryData,
	}: {
		now?: number;
		force?: boolean;
		fetchData?: (repo: string) => Promise<GithubCardData>;
	} = {},
): Promise<{
	cache: GithubCardCache;
	metadata: GithubMetadata;
	updated: number;
}> {
	const nextCache: GithubCardCache = {};
	const nextMetadata: GithubMetadata = {};
	let updated = 0;

	for (const [cacheKey, repo] of repositories) {
		const previous = existingCache[cacheKey];
		const meta = metadata[cacheKey];
		if (
			previous &&
			meta &&
			!force &&
			meta.dataHash === dataHash(previous) &&
			meta.fetchedAt <= now &&
			now - meta.fetchedAt < GITHUB_CACHE_TTL_MS
		) {
			nextCache[cacheKey] = previous;
			nextMetadata[cacheKey] = meta;
			continue;
		}
		try {
			nextCache[cacheKey] = await fetchData(repo);
			nextMetadata[cacheKey] = {
				fetchedAt: now,
				dataHash: dataHash(nextCache[cacheKey]),
			};
			updated++;
		} catch (error) {
			if (existingCache[cacheKey]) {
				nextCache[cacheKey] = existingCache[cacheKey];
				if (meta) nextMetadata[cacheKey] = meta;
				console.warn(
					`[GITHUB-CARD] Failed to refresh ${repo}; keeping cached data.`,
					error,
				);
			} else {
				console.warn(
					`[GITHUB-CARD] Failed to load ${repo}; the card will use its fallback state.`,
					error,
				);
			}
		}
	}
	return { cache: nextCache, metadata: nextMetadata, updated };
}

async function main() {
	const existingCache = await readCache();
	let metadata: GithubMetadata = {};
	try {
		metadata = JSON.parse(await fs.readFile(METADATA_FILE, "utf-8"));
	} catch {
		/* Missing metadata triggers a refresh. */
	}
	const result = await refreshRepositories(
		await findRepositories(),
		existingCache,
		metadata,
		{
			force: process.argv.includes("--refresh"),
		},
	);

	const sortedCache = Object.fromEntries(
		Object.entries(result.cache).sort(([a], [b]) => a.localeCompare(b)),
	);
	await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
	await fs.writeFile(
		OUTPUT_FILE,
		`${JSON.stringify(sortedCache, null, "\t")}\n`,
	);
	await fs.mkdir(path.dirname(METADATA_FILE), { recursive: true });
	await fs.writeFile(METADATA_FILE, JSON.stringify(result.metadata, null, 2));
	console.log(
		`[GITHUB-CARD] Cached ${Object.keys(sortedCache).length} repositories (${result.updated} refreshed).`,
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
	main().catch((error) => {
		console.error("[GITHUB-CARD] Generation failed:", error);
		process.exitCode = 1;
	});
}
