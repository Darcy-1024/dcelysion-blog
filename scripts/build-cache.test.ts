import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import {
	GITHUB_CACHE_TTL_MS,
	refreshRepositories,
	repositoriesInContent,
} from "./generate-github-card-data";
import { generateLqips } from "./generate-lqips";

test("GitHub discovery excludes drafts, code examples, comments and invalid repos", () => {
	const live = '::github{repo="Owner/Live"}';
	assert.deepEqual(repositoriesInContent(`---\ndraft: true\n---\n${live}`), []);
	const markdown = [
		"---",
		"draft: false",
		"---",
		live,
		'`::github{repo="Owner/Inline"}`',
		"```md",
		'::github{repo="Owner/Fenced"}',
		"```",
		"~~~md",
		'::github{repo="Owner/Tilde"}',
		"~~~",
		'    ::github{repo="Owner/Indented"}',
		'<!-- ::github{repo="Owner/Comment"} -->',
		'::github{repo="invalid"}',
	].join("\n\n");
	assert.deepEqual(repositoriesInContent(markdown), ["Owner/Live"]);
});

test("GitHub TTL skips fresh entries, refreshes expired/forced and retries failures", async () => {
	const repositories = new Map([["owner/repo", "Owner/Repo"]]);
	const data = {
		description: "Example",
		language: null,
		avatarUrl: null,
		license: null,
	};
	let calls = 0;
	const fetchData = async () => {
		calls++;
		return data;
	};
	const initial = await refreshRepositories(
		repositories,
		{},
		{},
		{ now: 100, fetchData },
	);
	assert.equal(calls, 1);
	await refreshRepositories(repositories, initial.cache, initial.metadata, {
		now: 101,
		fetchData,
	});
	assert.equal(calls, 1);
	await refreshRepositories(repositories, initial.cache, initial.metadata, {
		now: 101,
		fetchData,
		force: true,
	});
	assert.equal(calls, 2);
	await refreshRepositories(repositories, initial.cache, initial.metadata, {
		now: 100 + GITHUB_CACHE_TTL_MS,
		fetchData,
	});
	assert.equal(calls, 3);
	const failed = await refreshRepositories(
		repositories,
		initial.cache,
		initial.metadata,
		{
			now: 100 + GITHUB_CACHE_TTL_MS,
			fetchData: async () => {
				throw new Error("simulated offline");
			},
		},
	);
	assert.deepEqual(failed.cache, initial.cache);
	assert.deepEqual(failed.metadata, initial.metadata);
	await refreshRepositories(repositories, failed.cache, failed.metadata, {
		now: 101 + GITHUB_CACHE_TTL_MS,
		fetchData,
	});
	assert.equal(calls, 4);
	const changed = {
		"owner/repo": { ...data, description: "changed tracked data" },
	};
	await refreshRepositories(repositories, changed, initial.metadata, {
		now: 101,
		fetchData,
	});
	assert.equal(calls, 5);
	const empty = await refreshRepositories(
		new Map(),
		initial.cache,
		initial.metadata,
		{ fetchData },
	);
	assert.deepEqual(empty.cache, {});
	assert.deepEqual(empty.metadata, {});
});

test("LQIP invalidates same-path replacement, retries failures and removes deleted files", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "blog-lqip-test-"));
	try {
		await fs.mkdir(path.join(root, "public"));
		const imagePath = path.join(root, "public/cover.png");
		const writeColor = async (background: string) => {
			await sharp({ create: { width: 2, height: 2, channels: 3, background } })
				.png()
				.toFile(imagePath);
		};
		const outputPath = path.join(root, "src/constants/lqips.json");
		const readOutput = async () =>
			JSON.parse(await fs.readFile(outputPath, "utf-8"));
		await writeColor("red");
		assert.equal((await generateLqips({ root })).processed, 1);
		assert.deepEqual(await readOutput(), {
			"public:cover.png": "ff0000ff0000ff0000",
		});
		assert.equal((await generateLqips({ root })).processed, 0);
		await writeColor("blue");
		assert.equal((await generateLqips({ root })).processed, 1);
		assert.deepEqual(await readOutput(), {
			"public:cover.png": "0000ff0000ff0000ff",
		});
		await writeColor("green");
		assert.equal(
			(await generateLqips({ root, transform: async () => null })).processed,
			0,
		);
		assert.deepEqual(await readOutput(), {
			"public:cover.png": "0000ff0000ff0000ff",
		});
		assert.deepEqual(
			JSON.parse(
				await fs.readFile(
					path.join(root, "cache/build/lqip-meta.json"),
					"utf-8",
				),
			),
			{},
		);
		assert.equal((await generateLqips({ root })).processed, 1);
		assert.deepEqual(await readOutput(), {
			"public:cover.png": "008000008000008000",
		});
		await fs.unlink(imagePath);
		assert.deepEqual(await generateLqips({ root }), { processed: 0, total: 0 });
		assert.deepEqual(await readOutput(), {});
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
