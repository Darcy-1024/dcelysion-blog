// One offline PGlite drill; not a PostgreSQL pg_dump/restore test.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
	cp,
	mkdir,
	mkdtemp,
	open,
	readFile,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { DraftService } from "../server/drafts.js";
import { command } from "../server/executor.js";
import { JobService } from "../server/jobs.js";
import { MediaService } from "../server/media.js";
import { MediaBudget } from "../server/media-budget.js";
import { LocalReleases } from "../server/releases.js";
import { backupState, restoreState } from "../server/state-backup.js";
import { MockObjects } from "./media-fixture.js";
import { FixtureBuild } from "./publish-fixture.js";

const e = JSON.parse(
	await readFile(resolve("cache/stage9-evidence/environment.json"), "utf8"),
);
const before = JSON.parse(
	await readFile(resolve("cache/stage9-evidence/after-rollback.json"), "utf8"),
);
// Server has been cleanly stopped through the authenticated fixture endpoint.
const db = new PGlite(join(e.root, "private-db"));
console.log("drill: opening stopped source database");
const draft = before.drafts.items.find(
	(d: { path: string }) => d.path === "stage9-main.md",
);
assert.ok(draft);
const originalJob = before.jobs.find(
	(j: { kind: string; draftId: string }) =>
		j.kind === "publish" && j.draftId === draft.id,
);
assert.equal(originalJob.status, "succeeded");
const marker = randomUUID();
await db.query(
	"INSERT INTO dc_admin.jobs(id,owner_id,request_hash,draft_id,revision,snapshot,target,kind,status,stage) VALUES ($1,7,'restore-drill',$2,3,$3,$4,'publish','queued','snapshot')",
	[
		marker,
		draft.id,
		JSON.stringify(originalJob.snapshot),
		JSON.stringify(originalJob.target),
	],
);
const expectedDraft = (
	await db.query("SELECT source,revision FROM dc_admin.drafts WHERE id=$1", [
		draft.id,
	])
).rows[0];
const expectedRefs = (
	await db.query("SELECT count(*)::int AS count FROM dc_admin.media_refs")
).rows[0];
await db.close();
console.log("drill: source flushed and closed");
const parent = await mkdtemp(join(tmpdir(), "dc-admin-stage9-drill-"));
const preparation = join(parent, "prepared");
await mkdir(preparation);
await cp(join(e.root, "src"), join(preparation, "src"), { recursive: true });
await cp(join(e.root, "package.json"), join(preparation, "package.json"));
await command(
	"git",
	["bundle", "create", join(preparation, "repository.bundle"), "--all"],
	e.root,
);
// Budget journals intentionally have small pre-backup use. Restore must NOT refund it.
await writeFile(
	join(e.mediaConfig.privateRoot, "sync-budget.jsonl"),
	`${JSON.stringify({ month: new Date().toISOString().slice(0, 7), bytes: 100 })}\n`,
);
const edge = join(parent, "edge");
await mkdir(edge);
await writeFile(
	join(edge, "edge.jsonl"),
	`${JSON.stringify({ month: new Date().toISOString().slice(0, 7), bytes: 100 })}\n`,
);
const snapshot = join(parent, "admin-recovery-backup");
const executor = join(parent, "executor-prepared");
await cp(e.publicationConfig.stateRoot, executor, {
	recursive: true,
	filter: (path) =>
		!["git", "source.git", "worker.lock"].includes(
			path.split(/[\\/]/).pop() || "",
		),
});
const components = {
	database: join(e.root, "private-db"),
	content: preparation,
	executor,
	media: e.mediaConfig.privateRoot,
	public: e.mediaConfig.publicRoot,
	site: join(e.privateRoot, "site"),
	objects: e.objectRoot,
	remote: e.target.remote,
	edge,
};
await backupState(
	parent,
	snapshot,
	components,
	{
		fixture: true,
		gitHead: await command("git", ["rev-parse", "HEAD"], e.root),
		release: before.current,
	},
	true,
);
console.log("drill: snapshot complete");
const restored = join(parent, "admin-recovery-restored");
await restoreState(parent, restored, snapshot);
console.log("drill: restore checksum complete");
await assert.rejects(() => restoreState(parent, restored, snapshot));
await assert.rejects(() =>
	restoreState(parent, join(parent, "..", "admin-recovery-outside"), snapshot),
);
const bad = join(parent, "tampered");
await cp(snapshot, bad, { recursive: true });
await writeFile(join(bad, "edge/edge.jsonl"), "bad");
await assert.rejects(() =>
	restoreState(parent, join(parent, "admin-recovery-tampered"), bad),
);
const restoredRoot = await mkdtemp(join(tmpdir(), "dc-admin-stage2-"));
await cp(join(restored, "content/src"), join(restoredRoot, "src"), {
	recursive: true,
});
await cp(
	join(restored, "content/package.json"),
	join(restoredRoot, "package.json"),
);
await cp(join(restored, "database"), join(restoredRoot, "private-db"), {
	recursive: true,
});
await command("git", ["init", "-b", "master"], restoredRoot);
await command(
	"git",
	["fetch", join(restored, "content/repository.bundle"), "master"],
	restoredRoot,
);
await command("git", ["reset", "--mixed", "FETCH_HEAD"], restoredRoot);
const restoredDb = new PGlite(join(restoredRoot, "private-db"));
console.log("drill: opening restored database");
await restoredDb.exec(
	await readFile(
		resolve("deploy/tencent/admin-restore-quarantine.sql"),
		"utf8",
	),
);
console.log("drill: restored database quarantine complete");
assert.deepEqual(
	(
		await restoredDb.query(
			"SELECT source,revision FROM dc_admin.drafts WHERE id=$1",
			[draft.id],
		)
	).rows[0],
	expectedDraft,
);
assert.deepEqual(
	(
		await restoredDb.query(
			"SELECT count(*)::int AS count FROM dc_admin.media_refs",
		)
	).rows[0],
	expectedRefs,
);
assert.equal(
	(
		await restoredDb.query<{ count: number }>(
			"SELECT count(*)::int AS count FROM dc_admin.sessions WHERE revoked_at IS NULL",
		)
	).rows[0].count,
	0,
);
assert.equal(
	(
		await restoredDb.query<{ status: string }>(
			"SELECT status FROM dc_admin.jobs WHERE id=$1",
			[marker],
		)
	).rows[0].status,
	"failed",
);
const month = new Date().toISOString().slice(0, 7);
for (const [journal, limit] of [
	[join(restored, "media/sync-budget.jsonl"), 80_000_000_000],
	[join(restored, "edge/edge.jsonl"), 250_000_000_000],
] as const) {
	await writeFile(`${journal}.restored-evidence`, await readFile(journal));
	const budgetFile = await open(journal, "w", 0o600);
	try {
		await budgetFile.writeFile(`${JSON.stringify({ month, bytes: limit })}\n`);
		await budgetFile.sync();
	} finally {
		await budgetFile.close();
	}
	const budget = new MediaBudget(journal, limit);
	assert.equal(await budget.available(), false);
	await assert.rejects(() => budget.reserve(1));
}
const adapter = {
	query: (sql: string, values?: unknown[]) =>
		restoredDb.query<Record<string, unknown>>(sql, values),
};
const drafts = new DraftService(restoredRoot, "", adapter);
const objects = new MockObjects(join(restored, "objects"));
const mediaConfig = {
	...e.mediaConfig,
	repository: restoredRoot,
	privateRoot: join(restored, "media"),
	publicRoot: join(restored, "public"),
};
const media = new MediaService(mediaConfig, objects, "", adapter);
drafts.managedMedia = media;
const publicationConfig = {
	...e.publicationConfig,
	repository: restoredRoot,
	stateRoot: join(restored, "executor"),
	targets: [],
};
const builder = new FixtureBuild();
const jobs = new JobService(
	publicationConfig,
	drafts,
	builder,
	new Map(),
	"",
	adapter,
	media,
);
media.kick();
jobs.kick();
await media.idle();
await jobs.idle();
assert.equal(builder.count, 0);
assert.deepEqual(
	(await jobs.get(7, originalJob.id)).effects,
	originalJob.effects,
);
await objects.verify("private", before.media.items[0].original);
await objects.verify("public", before.media.items[0].original);
const release = new LocalReleases(join(restored, "site"));
assert.equal(await release.current(), before.current);
await release.list();
await jobs.close();
await media.close();
await restoredDb.close();
const restart = new PGlite(join(restoredRoot, "private-db"));
console.log("drill: restarting restored database");
assert.deepEqual(
	(
		await restart.query(
			"SELECT source,revision FROM dc_admin.drafts WHERE id=$1",
			[draft.id],
		)
	).rows[0],
	expectedDraft,
);
await restart.close();
const metadata = {
	...e,
	root: restoredRoot,
	privateRoot: restored,
	objectRoot: join(restored, "objects"),
	mediaConfig,
	publicationConfig,
	target: { ...e.target, remote: join(restored, "remote") },
};
// Restored tasks remain readable, while configured targets are disabled; no external credentials.
await writeFile(
	join(restored, "environment.json"),
	JSON.stringify(metadata, null, 2),
);
await writeFile(
	resolve("cache/stage9-evidence/recovery.json"),
	JSON.stringify(
		{
			passed: true,
			mode: "stopped PGlite directory snapshot",
			snapshot,
			restored,
			restoredRoot,
			draftId: draft.id,
			jobId: originalJob.id,
			refs: expectedRefs,
			files: Object.keys(
				JSON.parse(await readFile(join(snapshot, "manifest.json"), "utf8"))
					.files,
			).length,
			sessionRevoked: true,
			queuedQuarantined: true,
			budgetDenied: true,
			completedJobReplayed: false,
			restartReadable: true,
			refused: ["existing target", "outside parent", "tampered bytes"],
		},
		null,
		2,
	),
);
console.log(
	`Recovery drill passed; quarantined restored environment: ${restored}`,
);
