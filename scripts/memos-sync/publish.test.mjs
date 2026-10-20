import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { git, publish, validatePublication } from "./publish.mjs";
import { Store } from "./store.mjs";

const memo = () => ({
	name: "memos/one",
	creator: "users/author",
	state: "NORMAL",
	visibility: "PUBLIC",
	content: "发布适配合成内容🙂",
	createTime: "2026-01-01T00:00:00Z",
	updateTime: "2026-10-19T00:00:00Z",
	attachments: [],
});

async function fixture(t) {
	const temp = await fs.mkdtemp(
		path.join(process.cwd(), "cache/memos-publish-test-"),
	);
	t.after(async () => {
		assert.ok(path.resolve(temp).startsWith(path.resolve("cache") + path.sep));
		await fs.rm(temp, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
	});
	const remote = path.join(temp, "remote.git");
	const root = path.join(temp, "checkout");
	await fs.mkdir(remote);
	await git(remote, ["init", "--bare", "--initial-branch=master"]);
	await fs.mkdir(root);
	await git(root, ["init", "--initial-branch=master"]);
	await git(root, ["config", "user.name", "Fixture"]);
	await git(root, ["config", "user.email", "fixture@example.invalid"]);
	await git(root, ["config", "memos.publisher", "true"]);
	await fs.mkdir(path.join(root, "src/content/dynamic"), { recursive: true });
	await fs.writeFile(
		path.join(root, "src/content/dynamic/history.md"),
		"---\npublished: 2020-01-01T00:00:00Z\n---\n历史正文",
	);
	await git(root, ["add", "--", "src/content/dynamic/history.md"]);
	await git(root, ["commit", "-m", "chore: fixture baseline"]);
	await git(root, ["remote", "add", "origin", remote]);
	await git(root, ["push", "origin", "HEAD:refs/heads/master"]);
	const config = {
		enabled: true,
		remoteUrl: remote,
		branch: "master",
		authorName: "Memos Fixture",
		authorEmail: "memos@example.invalid",
		settleMs: 0,
		withdrawalPolicy: "eventual-current-site-operator-accepted",
		sync: {
			instanceId: "publish-fixture",
			baseUrl: "http://127.0.0.1:5231",
			creator: "users/author",
			timezone: "Asia/Shanghai",
			outputRoot: root,
			stateDir: path.join(temp, "private"),
			publish: false,
		},
	};
	const f = { config, root, remote, records: [memo()] };
	f.client = {
		base: new URL(config.sync.baseUrl),
		json: async (url) => {
			if (f.offline) throw new Error("Synthetic API unavailable");
			return url.includes("profile")
				? { version: "0.31.0" }
				: { user: { name: "users/author" } };
		},
		pages: async (url, _field, query) =>
			url.endsWith("attachments")
				? []
				: structuredClone(f.records.filter((m) => m.state === query.state)),
		memo: async (name) =>
			structuredClone(f.records.find((m) => m.name === name) ?? null),
	};
	f.run = (options = {}) =>
		publish(config, { execute: true, client: f.client, ...options });
	f.head = () => git(root, ["rev-parse", "HEAD"]);
	f.remoteHead = () => git(remote, ["rev-parse", "refs/heads/master"]);
	f.state = async () =>
		JSON.parse(
			await fs.readFile(path.join(config.sync.stateDir, "state.json"), "utf8"),
		);
	f.baseline = await f.head();
	return f;
}

test("default disabled returns before touching missing checkout/network", async () => {
	const config = {
		enabled: false,
		remoteUrl: "https://github.com/owner/repo.git",
		branch: "master",
		authorName: "Bot",
		authorEmail: "bot@example.invalid",
		settleMs: 0,
		sync: {
			instanceId: "none",
			creator: "users/author",
			timezone: "Asia/Shanghai",
			publish: false,
			outputRoot: path.resolve("cache/nonexistent-output"),
			stateDir: path.resolve("cache/nonexistent-private"),
		},
	};
	assert.equal((await publish(config, { execute: true })).status, "disabled");
	assert.equal(
		(await publish({ ...config, enabled: true })).status,
		"disabled",
	);
	await assert.rejects(
		publish({ ...config, enabled: true }, { execute: true }),
		/policy/u,
	);
	assert.throws(
		() => validatePublication({ ...config, branch: "--evil" }),
		/Invalid/u,
	);
	assert.equal(
		validatePublication({
			...config,
			remoteUrl: "git@github.com:owner/repo.git",
		}).remoteUrl,
		"git@github.com:owner/repo.git",
	);
	assert.throws(
		() =>
			validatePublication({
				...config,
				remoteUrl: "git@other.example:owner/repo.git",
			}),
		/Invalid/u,
	);
});

test("local bare remote gets only named managed files, stable edit/withdraw identity, no-op makes no commit", async (t) => {
	const f = await fixture(t);
	const first = await f.run();
	assert.equal(first.status, "pushed-awaiting-build");
	assert.equal(first.deployment, "unverified");
	assert.equal(first.commit, await f.remoteHead());
	assert.match(
		await git(f.root, ["log", "-1", "--format=%s"]),
		/^chore\(dynamic\):/u,
	);
	const state = await f.state();
	assert.equal(state.entries["memos/one"].lastPublishedVersion, null);
	const slug = state.entries["memos/one"].slug;
	assert.equal((await f.run()).status, "no-git-change");
	assert.equal(await f.head(), first.commit);
	f.records[0].content = "编辑后仍保留评论身份！";
	await f.run();
	assert.equal((await f.state()).entries["memos/one"].slug, slug);
	f.records[0].visibility = "PRIVATE";
	await f.run();
	assert.equal((await f.state()).entries["memos/one"].active, false);
	await assert.rejects(
		fs.access(path.join(f.root, "src/content/dynamic", `${slug}.md`)),
	);
	assert.equal(
		await fs.readFile(
			path.join(f.root, "src/content/dynamic/history.md"),
			"utf8",
		),
		"---\npublished: 2020-01-01T00:00:00Z\n---\n历史正文",
	);
	assert.equal(await git(f.root, ["status", "--porcelain"]), "");
});

test("unrelated dirty and staged files stop without pushing", async (t) => {
	const f = await fixture(t);
	await fs.writeFile(path.join(f.root, "unrelated.txt"), "preserve");
	await assert.rejects(f.run(), /Unrelated/u);
	assert.equal(await f.remoteHead(), f.baseline);
	assert.equal(
		await fs.readFile(path.join(f.root, "unrelated.txt"), "utf8"),
		"preserve",
	);
	await git(f.root, ["add", "--", "unrelated.txt"]);
	await assert.rejects(f.run({ resume: true }), /Pre-existing staged/u);
	assert.equal(await f.remoteHead(), f.baseline);
});

test("source change during debounce stops; resume coalesces to latest public version", async (t) => {
	const f = await fixture(t);
	const retry = await f.run({
		inject: async (point) => {
			if (point === "after-sync") f.records[0].content = "最新正文";
		},
	});
	assert.equal(retry.status, "source-changed-retry");
	assert.equal(await f.remoteHead(), f.baseline);
	await f.run();
	const entry = (await f.state()).entries["memos/one"];
	assert.match(
		await fs.readFile(
			path.join(f.root, "src/content/dynamic", entry.path),
			"utf8",
		),
		/最新正文/u,
	);
});

test("withdrawal after local sync never pushes stale candidate, resumed batch is no-op", async (t) => {
	const f = await fixture(t);
	const retry = await f.run({
		inject: async (point) => {
			if (point === "after-sync") f.records[0].visibility = "PRIVATE";
		},
	});
	assert.equal(retry.status, "source-changed-retry");
	assert.equal((await f.run()).status, "no-git-change");
	assert.equal(await f.remoteHead(), f.baseline);
});

test("crash after commit resumes the same SHA, never creates duplicate commit", async (t) => {
	const f = await fixture(t);
	await assert.rejects(
		f.run({
			inject: async (point) => {
				if (point === "after-commit") throw new Error("Synthetic crash");
			},
		}),
		/Synthetic crash/u,
	);
	const candidate = await f.head();
	assert.notEqual(candidate, f.baseline);
	assert.equal(await f.remoteHead(), f.baseline);
	const receipt = await f.run({ resume: true });
	assert.equal(receipt.commit, candidate);
	assert.equal(await f.remoteHead(), candidate);
	assert.equal(await git(f.root, ["rev-list", "--count", "HEAD"]), "2");
});

test("prepared journal resumes by unstaging its named files and rereading current withdrawal", async (t) => {
	const f = await fixture(t);
	await assert.rejects(
		f.run({
			inject: async (point) => {
				if (point === "before-commit")
					throw new Error("Synthetic precommit crash");
			},
		}),
	);
	f.records[0].visibility = "PRIVATE";
	assert.equal((await f.run({ resume: true })).status, "no-git-change");
	assert.equal(await f.remoteHead(), f.baseline);
	assert.equal(await git(f.root, ["diff", "--cached", "--name-only"]), "");
});

test("withdrawn source blocks an old committed task from being replayed", async (t) => {
	const f = await fixture(t);
	await assert.rejects(
		f.run({
			inject: async (point) => {
				if (point === "after-commit") {
					f.records[0].visibility = "PRIVATE";
					throw new Error("Synthetic crash");
				}
			},
		}),
	);
	await assert.rejects(f.run({ resume: true }), /Source changed/u);
	assert.equal(await f.remoteHead(), f.baseline);
});

test("ambiguous push outcome recovers by observing remote SHA", async (t) => {
	const f = await fixture(t);
	await assert.rejects(
		f.run({
			inject: async (point) => {
				if (point === "before-push") {
					await git(f.root, ["push", "origin", "HEAD:refs/heads/master"]);
					throw new Error("Synthetic lost acknowledgement");
				}
			},
		}),
	);
	const candidate = await f.remoteHead();
	assert.equal((await f.run({ resume: true })).commit, candidate);
	assert.equal(await git(f.root, ["rev-list", "--count", "HEAD"]), "2");
});

test("remote fast-forward is accepted when clean; divergence stops with pending candidate intact", async (t) => {
	const f = await fixture(t);
	const other = path.join(path.dirname(f.root), "other");
	await fs.mkdir(other);
	await git(other, ["clone", f.remote, "."]);
	await git(other, ["config", "user.name", "Other"]);
	await git(other, ["config", "user.email", "other@example.invalid"]);
	const advance = async (name) => {
		await fs.writeFile(path.join(other, name), name);
		await git(other, ["add", "--", name]);
		await git(other, ["commit", "-m", "chore: independent remote update"]);
		await git(other, ["push", "origin", "HEAD:refs/heads/master"]);
	};
	await advance("before.txt");
	await f.run();
	assert.equal(
		await fs.readFile(path.join(f.root, "before.txt"), "utf8"),
		"before.txt",
	);
	await git(other, ["pull", "--ff-only"]);
	f.records[0].content = "another edit";
	await assert.rejects(
		f.run({
			inject: async (point) => {
				if (point === "after-commit") await advance("raced.txt");
			},
		}),
		/Remote advanced/u,
	);
	assert.notEqual(await f.head(), await f.remoteHead());
	await assert.rejects(f.run({ resume: true }), /Remote advanced/u);
});

test("a remotely included candidate recovers even after another writer advances remote", async (t) => {
	const f = await fixture(t);
	await assert.rejects(
		f.run({
			inject: async (point) => {
				if (point !== "before-push") return;
				await git(f.root, ["push", "origin", "HEAD:refs/heads/master"]);
				const other = path.join(path.dirname(f.root), "other");
				await fs.mkdir(other);
				await git(other, ["clone", f.remote, "."]);
				await git(other, ["config", "user.name", "Other"]);
				await git(other, ["config", "user.email", "other@example.invalid"]);
				await fs.writeFile(path.join(other, "remote.txt"), "remote update");
				await git(other, ["add", "--", "remote.txt"]);
				await git(other, ["commit", "-m", "chore: advance after push"]);
				await git(other, ["push", "origin", "HEAD:refs/heads/master"]);
				throw new Error("Synthetic lost acknowledgement");
			},
		}),
	);
	const candidate = await f.head();
	const receipt = await f.run({ resume: true });
	assert.equal(receipt.commit, candidate);
	assert.equal(receipt.git, "remote-ancestry-confirmed");
	assert.equal(await f.head(), await f.remoteHead());
	assert.equal(
		await fs.readFile(path.join(f.root, "remote.txt"), "utf8"),
		"remote update",
	);
});

test("full-cycle lock excludes standalone sync and second publisher", async (t) => {
	const f = await fixture(t);
	await f.run({
		inject: async (point) => {
			if (point === "after-sync") {
				await assert.rejects(f.run(), { code: "EEXIST" });
				await assert.rejects(new Store(f.config.sync).lock(), {
					code: "EEXIST",
				});
			}
		},
	});
});

test("API failure persists halt without Git commit", async (t) => {
	const f = await fixture(t);
	f.offline = true;
	await assert.rejects(f.run(), /unavailable/u);
	f.offline = false;
	await assert.rejects(f.run(), /halted/u);
	assert.equal(await f.remoteHead(), f.baseline);
	await f.run({ resume: true });
});

test("modified managed bytes and wrong checkout marker are refused", async (t) => {
	const f = await fixture(t);
	await assert.rejects(
		f.run({
			inject: async (point) => {
				if (point === "after-sync") {
					const state = await f.state();
					await fs.writeFile(
						path.join(
							f.root,
							"src/content/dynamic",
							state.entries["memos/one"].path,
						),
						"manual edit",
					);
				}
			},
		}),
		/Managed bytes/u,
	);
	assert.equal(await f.remoteHead(), f.baseline);
	await git(f.root, ["config", "memos.publisher", "false"]);
	await assert.rejects(f.run({ resume: true }), /binding mismatch/u);
});
