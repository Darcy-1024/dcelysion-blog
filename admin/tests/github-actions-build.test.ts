import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubActionsBuild } from "../server/github-actions-build.js";

const configuration = {
	repository: "owner/private-builder",
	token: "synthetic-test-token",
	workflowRevision: "a".repeat(40),
};
const jobId = "9f588913-5c1e-42fe-8040-d1bc90e079a9";
const json = (value: unknown) =>
	new Response(JSON.stringify(value), {
		status: 200,
		headers: { "content-type": "application/json" },
	});

test("cloud builder rejects ambiguous operator repositories and revisions", () => {
	for (const repository of [
		"https://github.com/owner/repo",
		"owner/repo/path",
		"../repo",
		"owner/.git",
	])
		assert.throws(
			() => new GitHubActionsBuild({ ...configuration, repository }),
		);
	assert.throws(
		() =>
			new GitHubActionsBuild({ ...configuration, workflowRevision: "main" }),
	);
	assert.throws(
		() =>
			new GitHubActionsBuild({ ...configuration, token: "token\ninjected" }),
	);
});

test("cloud build refuses public transport before any private input is packed or uploaded", async () => {
	const calls: string[] = [];
	const request = (async (url) => {
		calls.push(String(url));
		return json({
			private: false,
			full_name: configuration.repository,
			default_branch: "main",
		});
	}) as typeof fetch;
	const build = new GitHubActionsBuild(configuration, request);
	assert.equal(await build.available(), false);
	await assert.rejects(
		build.build("does-not-exist", jobId, {} as never, false),
		/MUST_BE_PRIVATE/u,
	);
	assert.deepEqual(calls, [
		"https://api.github.com/repos/owner/private-builder",
		"https://api.github.com/repos/owner/private-builder",
	]);
});

test("cloud build refuses a changed workflow revision before touching input", async () => {
	const request = (async (url) =>
		String(url).endsWith("/git/ref/heads/main")
			? json({ object: { sha: "b".repeat(40) } })
			: json({
					private: true,
					full_name: configuration.repository,
					default_branch: "main",
				})) as typeof fetch;
	const build = new GitHubActionsBuild(configuration, request);
	await assert.rejects(
		build.build("does-not-exist", jobId, {} as never, false),
		/WORKFLOW_CHANGED/u,
	);
});

test("cloud cancellation only targets this job and waits for completion", async () => {
	const cancelled: string[] = [];
	let completed = false;
	const request = (async (url, options) => {
		if (options?.method === "POST") {
			cancelled.push(String(url));
			completed = true;
			return new Response(null, { status: 204 });
		}
		return json({
			workflow_runs: [
				{
					id: 1,
					display_title: `build-${jobId}-attempt`,
					event: "workflow_dispatch",
					status: completed ? "completed" : "in_progress",
				},
				{
					id: 2,
					display_title: "build-other-job-attempt",
					event: "workflow_dispatch",
					status: "in_progress",
				},
			],
		});
	}) as typeof fetch;
	await new GitHubActionsBuild(configuration, request, async () => {}).stop(
		jobId,
	);
	assert.deepEqual(cancelled, [
		"https://api.github.com/repos/owner/private-builder/actions/runs/1/cancel",
	]);
});
