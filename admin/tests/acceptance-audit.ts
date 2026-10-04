import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { command } from "../server/executor.js";

const e = JSON.parse(
	await readFile(resolve("cache/stage9-evidence/environment.json"), "utf8"),
);
const stage = process.argv[2];
const evidence = await (await fetch(`${e.origin}/__fixture/evidence`)).json();
const draft = evidence.drafts.items.find(
	(d: { path: string }) => d.path === "stage9-main.md",
);
const job = evidence.jobs.find(
	(j: { kind: string; draftId: string }) =>
		j.kind === "publish" && j.draftId === draft.id,
);
assert.equal(job.status, "succeeded");
assert.equal(job.effects.pushed, true);
assert.equal(job.effects.installed, true);
const candidate = await command("git", [
	"--git-dir",
	e.target.remote,
	"diff-tree",
	"--no-commit-id",
	"--name-only",
	"-r",
	job.effects.commit,
]);
assert.equal(
	candidate.trim(),
	"src/config/manifests/media-distribution.json\nsrc/content/posts/stage9-main.md",
);
const remote = await command("git", [
	"--git-dir",
	e.target.remote,
	"rev-parse",
	"master",
]);
assert.equal(remote.trim(), job.effects.commit);
const file = await fetch(
	`${e.publicOrigin}/library/${evidence.media.items[0].original.key}`,
);
assert.equal(file.status, 200);
assert.equal(
	createHash("sha256")
		.update(Buffer.from(await file.arrayBuffer()))
		.digest("hex"),
	evidence.media.items[0].original.sha256,
);
const response = await fetch(`${e.publicOrigin}/posts/stage9-main/`);
if (stage === "published") {
	assert.equal(response.status, 200);
	assert.match(await response.text(), /跨模块验收，保留标点！🙂/);
	assert.equal(evidence.current, job.effects.release);
} else {
	assert.equal(response.status, 404);
	assert.notEqual(evidence.current, job.effects.release);
}
const preview = evidence.jobs.find(
	(j: { kind: string; draftId: string }) =>
		j.kind === "preview" && j.draftId === draft.id,
);
assert.equal(
	(
		await fetch(
			`${e.origin}/api/previews/${preview.id}/posts/stage9-main/index.html`,
		)
	).status,
	401,
);
assert.equal((await fetch(`${e.origin}/api/drafts/${draft.id}`)).status, 401);
const login = await fetch(`${e.origin}/api/login`, {
	method: "POST",
	headers: { origin: e.origin, "content-type": "application/json" },
	body: JSON.stringify({
		identity: "preview",
		password: "preview",
		code: "123456",
	}),
});
assert.equal(login.status, 200);
const loginCookie = login.headers.get("set-cookie");
assert.ok(loginCookie);
const cookie = loginCookie.split(";")[0];
const privatePreview = await fetch(
	`${e.origin}/api/previews/${preview.id}/posts/stage9-main/index.html`,
	{ headers: { cookie } },
);
assert.equal(privatePreview.status, 200);
assert.match(
	privatePreview.headers.get("content-security-policy") || "",
	/sandbox/,
);
for (const path of [
	"/api/drafts?kind=music",
	"/api/drafts?kind=gallery",
	"/api/drafts?kind=settings",
	"/api/manage/comments",
	"/api/manage/users",
	"/api/analytics?range=today",
	"/api/overview/host",
]) {
	const data = await fetch(e.origin + path, { headers: { cookie } });
	assert.equal(data.status, 200, path);
}
evidence.assertions = {
	candidate: candidate.trim(),
	remote: remote.trim(),
	publicImageHash: true,
	privateUnauthenticated: 401,
	previewAuthenticated: 200,
	rollback: stage !== "published",
	sampleDependencies: true,
};
await writeFile(
	resolve(
		`cache/stage9-evidence/after-${stage === "published" ? "publish" : "rollback"}.json`,
	),
	JSON.stringify(evidence, null, 2),
);
if (stage !== "published") {
	const stopped = await fetch(`${e.origin}/__fixture/stop`, {
		method: "POST",
		headers: { cookie, origin: e.origin },
	});
	assert.equal(stopped.status, 200);
	console.log(await stopped.text());
}
console.log(`${stage} HTTP/Git/media assertions passed`);
