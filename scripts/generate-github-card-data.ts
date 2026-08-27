import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { isValidGithubRepository } from "../src/utils/github-card-utils";

const OUTPUT_FILE = "src/constants/github-card-data.json";
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

interface GithubCardData {
	description: string | null;
	language: string | null;
	avatarUrl: string | null;
	license: string | null;
}

type GithubCardCache = Record<string, GithubCardData>;

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
		for (const match of content.matchAll(GITHUB_DIRECTIVE_PATTERN)) {
			const repo = match[1];
			if (isValidGithubRepository(repo)) {
				repositories.set(repo.toLowerCase(), repo);
			}
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

async function main() {
	const existingCache = await readCache();
	const repositories = await findRepositories();
	const nextCache: GithubCardCache = {};
	let updated = 0;

	for (const [cacheKey, repo] of repositories) {
		try {
			nextCache[cacheKey] = await fetchRepositoryData(repo);
			updated++;
		} catch (error) {
			if (existingCache[cacheKey]) {
				nextCache[cacheKey] = existingCache[cacheKey];
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

	const sortedCache = Object.fromEntries(
		Object.entries(nextCache).sort(([a], [b]) => a.localeCompare(b)),
	);
	await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
	await fs.writeFile(
		OUTPUT_FILE,
		`${JSON.stringify(sortedCache, null, "\t")}\n`,
	);
	console.log(
		`[GITHUB-CARD] Cached ${Object.keys(sortedCache).length} repositories (${updated} refreshed).`,
	);
}

main();
