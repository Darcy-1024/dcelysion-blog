import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CandidateExecutor } from "../server/candidate.js";
import { DraftError, DraftService } from "../server/drafts.js";
import { command, safeFile, tree } from "../server/executor.js";
import { JobService } from "../server/jobs.js";
import { publication, publicationFixture } from "./publish-fixture.js";

test("固定 revision 的成功链、白名单、并发幂等、持久化及整站回退", async () => {
	const f = await publicationFixture();
	let databaseClosed = false;
	try {
		const draft = (
			await f.drafts.create(7, {
				requestId: randomUUID(),
				kind: "posts",
				path: "one.mdx",
				source: publication,
			})
		).draft;
		await f.drafts.create(7, {
			requestId: randomUUID(),
			kind: "posts",
			path: "hidden.md",
			source: `${publication}其他私有草稿`,
		});
		const executor = new CandidateExecutor(f.root, f.target.remote, "master");
		const base = await executor.remoteHead();
		const input = {
			requestId: randomUUID(),
			draftId: draft.id,
			revision: 1,
			targetId: f.target.id,
			kind: "publish",
			base,
			confirm: f.target.fingerprint,
		};
		const tasks = await Promise.all([
			f.jobs.create(7, input),
			f.jobs.create(7, input),
		]);
		assert.equal(tasks[0].id, tasks[1].id);
		// Future edits cannot change a captured task.
		await f.drafts.save(7, draft.id, {
			requestId: randomUUID(),
			revision: 1,
			source: `${publication}后续编辑`,
		});
		await f.jobs.idle();
		const job = await f.jobs.get(7, input.requestId);
		assert.equal(job.status, "succeeded");
		assert.equal(job.snapshot.source, publication);
		assert.equal(job.effects.pushed, true);
		assert.equal(job.effects.installed, true);
		assert.equal(f.builder.count, 1);
		assert.equal(f.releases.count, 1);
		assert.equal(
			(
				await command(
					"git",
					["diff", "--name-only", base, job.effects.commit as string],
					join(f.jobs.directory(job.id), "git"),
				)
			).trim(),
			"src/content/posts/one.mdx",
		);
		assert.ok(
			!(
				await command(
					"git",
					["ls-tree", "-r", "--name-only", job.effects.commit as string],
					join(f.jobs.directory(job.id), "git"),
				)
			)
				.split("\n")
				.includes(".env"),
		);
		const files = await tree(join(f.jobs.directory(job.id), "input"));
		assert.ok(!files[".env"]);
		assert.ok(!files["src/content/posts/hidden.md"]);
		assert.ok(!files["src/content/posts/workspace-only.md"]);
		assert.equal(
			await readFile(
				join(f.jobs.directory(job.id), "input/src/content/posts/one.mdx"),
				"utf8",
			),
			publication,
		);
		assert.ok(
			!(
				await readFile(
					join(
						f.jobs.directory(job.id),
						"input/src/content/dynamic/2026-09-30-120000.md",
					),
					"utf8",
				)
			).includes("本机未提交改动"),
		);
		await assert.rejects(
			() => f.jobs.create(7, { ...input, kind: "preview" }),
			(error: unknown) =>
				error instanceof DraftError && error.code === "REQUEST_REUSE",
		);
		const second = (
			await f.drafts.create(7, {
				requestId: randomUUID(),
				kind: "posts",
				path: "two.md",
				source: `${publication}第二个`,
			})
		).draft;
		const plan = await f.jobs.diff(7, {
			draftId: second.id,
			revision: 1,
			targetId: f.target.id,
		});
		const secondJob = await f.jobs.create(7, {
			...input,
			requestId: randomUUID(),
			draftId: second.id,
			base: plan.base,
		});
		await f.jobs.idle();
		assert.equal((await f.jobs.get(7, secondJob.id)).status, "succeeded");
		const before = await executor.remoteHead();
		await f.jobs.rollback(7, {
			targetId: f.target.id,
			releaseId: job.effects.release,
			expected: await f.releases.current(),
			confirm: f.target.fingerprint,
		});
		assert.equal(await f.releases.current(), job.effects.release);
		assert.equal(await executor.remoteHead(), before);
		const resumed = f.newJobs();
		assert.equal(
			(await resumed.get(7, job.id)).effects.commit,
			job.effects.commit,
		);
		await resumed.close();
		await f.jobs.close();
		await f.db.close();
		databaseClosed = true;
		const persisted = new PGlite(join(f.root, "private-db"));
		try {
			const adapter = {
				query: (sql: string, values?: unknown[]) =>
					persisted.query<Record<string, unknown>>(sql, values),
			};
			const restored = new JobService(
				f.publicationConfig,
				new DraftService(f.root, "", adapter),
				f.builder,
				new Map([[f.target.id, f.releases]]),
				"",
				adapter,
			);
			assert.equal(
				(await restored.get(7, job.id)).effects.commit,
				job.effects.commit,
			);
			const builds = f.builder.count;
			restored.kick();
			await restored.idle();
			assert.equal(f.builder.count, builds);
			await restored.close();
		} finally {
			await persisted.close();
		}
	} finally {
		await f.jobs.close();
		if (!databaseClosed) await f.db.close();
	}
});

test("构建失败无副作用，push 后安装失败可恢复，中断核对避免重复推送安装", async () => {
	const f = await publicationFixture();
	try {
		const draft = (
			await f.drafts.create(7, {
				requestId: randomUUID(),
				kind: "posts",
				path: "failure.md",
				source: publication,
			})
		).draft;
		const executor = new CandidateExecutor(f.root, f.target.remote, "master");
		const base = await executor.remoteHead();
		const input = {
			requestId: randomUUID(),
			draftId: draft.id,
			revision: 1,
			targetId: f.target.id,
			kind: "publish",
			base,
			confirm: f.target.fingerprint,
		};
		f.builder.fail = true;
		await f.jobs.create(7, input);
		await f.jobs.idle();
		let job = await f.jobs.get(7, input.requestId);
		assert.equal(job.status, "failed");
		assert.equal(job.stage, "build");
		assert.equal(await executor.remoteHead(), base);
		assert.equal(await f.releases.current(), null);
		f.releases.fail = true;
		await f.jobs.retry(7, job.id);
		await f.jobs.idle();
		job = await f.jobs.get(7, job.id);
		assert.equal(job.status, "failed");
		assert.equal(job.stage, "install");
		assert.equal(job.effects.pushed, true);
		assert.equal(job.effects.installed, undefined);
		assert.equal(await executor.remoteHead(), job.effects.commit);
		// Represent API death after a successful external push but before its completion receipt.
		await f.adapter.query(
			"UPDATE dc_admin.jobs SET status='running',effects=effects-'pushed' WHERE id=$1",
			[job.id],
		);
		const resumed = f.newJobs();
		resumed.kick();
		await resumed.idle();
		job = await resumed.get(7, job.id);
		assert.equal(job.status, "succeeded");
		assert.equal(f.builder.count, 2);
		assert.equal(job.effects.pushed, true);
		assert.equal(job.effects.installed, true);
		const installed = f.releases.count;
		// Represent death after atomic current switch, before database receipt.
		await f.adapter.query(
			"UPDATE dc_admin.jobs SET status='running',effects=effects-'installed' WHERE id=$1",
			[job.id],
		);
		resumed.kick();
		await resumed.idle();
		assert.equal((await resumed.get(7, job.id)).status, "succeeded");
		assert.equal(f.releases.count, installed);
		await resumed.close();
	} finally {
		await f.jobs.close();
		await f.db.close();
	}
});

test("来源/远端变化拒绝覆盖，新增 API 权限、CSRF、预览与路径边界", async () => {
	const f = await publicationFixture();
	const server = createServer(
		(req, res) =>
			void f.api(req, res, new URL(req.url || "/", f.config.origin)),
	);
	await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
	const port = (server.address() as { port: number }).port;
	const origin = `http://127.0.0.1:${port}`;
	try {
		const draft = (
			await f.drafts.create(7, {
				requestId: randomUUID(),
				kind: "posts",
				path: "example.mdx",
				fromSource: true,
			})
		).draft;
		const plan = await f.jobs.diff(7, {
			draftId: draft.id,
			revision: 1,
			targetId: f.target.id,
		});
		const input = {
			requestId: randomUUID(),
			draftId: draft.id,
			revision: 1,
			targetId: f.target.id,
			kind: "preview",
			base: plan.base,
		};
		await f.jobs.create(7, input);
		await f.jobs.idle();
		const job = await f.jobs.get(7, input.requestId);
		assert.equal(job.status, "succeeded");
		assert.equal(await f.releases.current(), null);
		for (const path of [
			"/api/jobs",
			`/api/jobs/${job.id}`,
			`/api/previews/${job.id}/index.html`,
			`/api/previews/${job.id}/_astro/fixture.css`,
			"/api/releases?targetId=isolated",
		])
			assert.equal((await fetch(origin + path)).status, 401);
		const session = await f.auth.login("preview", "preview", "");
		assert.ok(session);
		const headers = { cookie: `dc_admin_local=${session.token}` };
		for (const path of [
			"/api/jobs",
			"/api/releases/rollback",
			`/api/jobs/${job.id}/retry`,
		])
			assert.equal(
				(
					await fetch(origin + path, {
						method: "POST",
						headers: { ...headers, "content-type": "application/json" },
						body: "{}",
					})
				).status,
				403,
			);
		const preview = await fetch(`${origin}/api/previews/${job.id}/index.html`, {
			headers,
		});
		assert.equal(preview.status, 200);
		const csp = preview.headers.get("content-security-policy") || "";
		assert.ok(csp.includes("sandbox;"));
		assert.ok(csp.includes("script-src 'none'"));
		assert.ok(csp.includes("connect-src 'none'"));
		assert.equal(preview.headers.get("cache-control"), "no-store, private");
		assert.ok(
			(await preview.text()).includes(
				`/api/previews/${job.id}/_astro/fixture.css`,
			),
		);
		assert.equal(
			(
				await fetch(`${origin}/api/previews/${job.id}/_astro/fixture.css`, {
					headers,
				})
			).status,
			200,
		);
		assert.equal(
			(
				await fetch(`${origin}/api/previews/${job.id}/%2e%2e%2fpackage.json`, {
					headers,
				})
			).status,
			400,
		);
		await symlink(
			f.privateRoot,
			join(f.jobs.directory(job.id), "artifact/escape"),
			process.platform === "win32" ? "junction" : "dir",
		);
		await assert.rejects(() =>
			safeFile(
				join(f.jobs.directory(job.id), "artifact"),
				"escape/remote.git/config",
			),
		);
		await assert.rejects(() =>
			safeFile(
				join(f.jobs.directory(job.id), "artifact/escape"),
				"remote.git/config",
			),
		);
		const existing = (
			await f.drafts.create(7, {
				requestId: randomUUID(),
				kind: "posts",
				path: "example.mdx",
				fromSource: true,
			})
		).draft;
		await writeFile(
			join(f.root, "src/content/posts/example.mdx"),
			`${publication}来源已变`,
		);
		await assert.rejects(() =>
			f.jobs.diff(7, {
				draftId: existing.id,
				revision: 1,
				targetId: f.target.id,
			}),
		);
		const next = (
			await f.drafts.create(7, {
				requestId: randomUUID(),
				kind: "posts",
				path: "remote-conflict.md",
				source: publication,
			})
		).draft;
		const before = await f.jobs.diff(7, {
			draftId: next.id,
			revision: 1,
			targetId: f.target.id,
		});
		await f.git(["commit", "--allow-empty", "-m", "test: remote advanced"]);
		await f.git(["push", f.target.remote, "HEAD:refs/heads/master"]);
		await assert.rejects(
			() =>
				f.jobs.create(7, {
					...input,
					requestId: randomUUID(),
					draftId: next.id,
					base: before.base,
					kind: "publish",
					confirm: f.target.fingerprint,
				}),
			(error: unknown) =>
				error instanceof DraftError && error.code === "REMOTE_CONFLICT",
		);
		await assert.rejects(() => f.releases.rollback("../outside", null));
		assert.ok((await lstat(join(f.root, ".env"))).isFile());
	} finally {
		server.closeAllConnections();
		await new Promise<void>((accept) => server.close(() => accept()));
		await f.jobs.close();
		await f.db.close();
	}
});
