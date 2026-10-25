import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import http from "node:http";
import { hostname } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { parse as parseYaml } from "yaml";
import { digest } from "./content.mjs";
import { errorReason } from "./errors.mjs";
import { Store } from "./store.mjs";

test("unchanged source bytes reuse verified AVIF while same-size changed bytes are encoded", async (t) => {
	const f = await fixture(t);
	const photo = (background) =>
		sharp({ create: { width: 20, height: 20, channels: 3, background } })
			.png({ compressionLevel: 0 })
			.toBuffer();
	const first = await photo("red");
	const changed = await photo("blue");
	assert.equal(first.length, changed.length);
	await f.image(f.records[0], "pic", first);
	await f.run();
	const before = (await f.state()).entries["memos/one"];
	const encoder = sharp.prototype.avif;
	let encodes = 0;
	sharp.prototype.avif = function (...args) {
		encodes++;
		return encoder.apply(this, args);
	};
	try {
		f.requests.length = 0;
		assert.deepEqual((await f.run()).files, []);
		assert.equal(encodes, 0);
		assert(f.requests.some((r) => r.path === "/file/attachments/pic"));
		assert.deepEqual(
			(await f.state()).entries["memos/one"].attachments,
			before.attachments,
		);
		f.binary.set("pic", changed);
		await f.run();
		assert.equal(encodes, 1);
		const after = (await f.state()).entries["memos/one"];
		assert.notEqual(
			after.attachments.pic.sha256,
			before.attachments.pic.sha256,
		);
		assert.equal(after.slug, before.slug);
		assert.equal(after.firstPublished, before.firstPublished);
	} finally {
		sharp.prototype.avif = encoder;
	}
});

test("safe failure categories do not expose arbitrary error content", () => {
	assert.equal(errorReason(new Error("Run deadline exceeded")), "run-deadline");
	assert.equal(
		errorReason(new Error("secret-token=https://private.example/body")),
		"unknown",
	);
});

test("output root lock also excludes a different private state directory", async (t) => {
	const f = await fixture(t);
	const release = await new Store(f.config).lock();
	try {
		const otherConfig = { ...f.config, stateDir: `${f.config.stateDir}-other` };
		await assert.rejects(
			synchronize(otherConfig, { dryRun: true, token: "fixture-token" }),
			{ code: "EEXIST" },
		);
		assert.deepEqual(await fs.readdir(otherConfig.stateDir), []);
	} finally {
		await release();
	}
});

test("stale lock recovery never steals a live process lock", async (t) => {
	const f = await fixture(t);
	await fs.mkdir(f.config.stateDir, { recursive: true, mode: 0o700 });
	await fs.writeFile(
		path.join(f.config.stateDir, "lock.json"),
		JSON.stringify({ pid: process.pid, host: hostname() }),
	);
	await assert.rejects(f.run({ recoverLock: true }), /Lock owner still alive/u);
	await fs.unlink(path.join(f.config.stateDir, "lock.json"));
});

test("total attachment bytes are bounded across a candidate batch", async (t) => {
	const f = await fixture(t);
	const bytes = await png();
	await f.image(f.records[0], "pic", bytes);
	f.config.maxTotalAttachmentBytes = bytes.length - 1;
	await assert.rejects(f.run(), /Run attachment byte limit/u);
	assert.deepEqual(await f.outputs(), []);
});

test("List/Get computed fields and omitted defaults do not cause false version conflicts", async (t) => {
	const f = await fixture(t);
	f.handler = (url, send) => {
		if (url.pathname === "/api/v1/memos/one") {
			const detail = {
				...f.records[0],
				pinned: false,
				parent: "",
				snippet: "computed detail",
				reactions: [{ reactionType: "like" }],
			};
			send(detail);
			return true;
		}
	};
	assert.equal((await f.run()).changes.length, 1);
});

test("static image EXIF orientation changes display axes without resizing the picture", async (t) => {
	const f = await fixture(t);
	const original = await sharp({
		create: { width: 30, height: 20, channels: 3, background: "blue" },
	})
		.jpeg()
		.withMetadata({ orientation: 6 })
		.toBuffer();
	await f.image(f.records[0], "rotated", original, "image/jpeg");
	await f.run();
	const image = (await f.state()).entries["memos/one"].attachments.rotated;
	const output = await sharp(
		await fs.readFile(
			path.join(f.config.outputRoot, "src/content/dynamic", image.path),
		),
	).metadata();
	assert.deepEqual([output.width, output.height], [20, 30]);
	assert.deepEqual(
		await fs.readFile(
			path.join(f.config.stateDir, "originals", image.originalSha256),
		),
		original,
	);
});

test("a malformed empty-array API list cannot masquerade as a complete empty snapshot", async (t) => {
	const f = await fixture(t);
	await f.run();
	const before = await f.state();
	f.records = [];
	f.handler = (url, send) => {
		if (url.pathname === "/api/v1/memos") {
			send([]);
			return true;
		}
	};
	await assert.rejects(f.run(), /Invalid list shape/u);
	assert.deepEqual(await f.state(), before);
	assert.equal((await f.outputs()).length, 1);
});

import { synchronize } from "./index.mjs";

const NOW = new Date("2026-10-18T01:02:03Z");
const memo = (id = "one", overrides = {}) => ({
	name: `memos/${id}`,
	creator: "users/author",
	state: "NORMAL",
	visibility: "PUBLIC",
	content: "原文，标点！🙂",
	createTime: "2020-01-01T00:00:00Z",
	updateTime: "2026-10-18T00:00:00Z",
	attachments: [],
	...overrides,
});

async function fixture(t, records = [memo()]) {
	// Keep Windows sandbox file operations on the writable workspace volume.
	const temp = await fs.mkdtemp(path.join(process.cwd(), ".memos-sync-test-"));
	const f = {
		records,
		binary: new Map(),
		requests: [],
		handler: null,
		author: "users/author",
	};
	const server = http.createServer(async (request, response) => {
		try {
			const url = new URL(request.url, "http://localhost");
			f.requests.push({
				path: url.pathname,
				query: url.searchParams,
				auth: request.headers.authorization,
				method: request.method,
			});
			const send = (data, status = 200) => {
				response.writeHead(status, {
					"content-type": Buffer.isBuffer(data)
						? "application/octet-stream"
						: "application/json",
				});
				response.end(Buffer.isBuffer(data) ? data : JSON.stringify(data));
			};
			if (await f.handler?.(url, send, response)) return;
			if (url.pathname === "/api/v1/instance/profile")
				return send({ version: "0.31.0" });
			if (url.pathname === "/api/v1/auth/me")
				return send({ user: { name: f.author } });
			if (url.pathname === "/api/v1/memos")
				return send({
					memos: f.records.filter(
						(item) => item.state === url.searchParams.get("state"),
					),
				});
			const attachments = /^\/api\/v1\/(memos\/[^/]+)\/attachments$/u.exec(
				url.pathname,
			);
			if (attachments)
				return send({
					attachments:
						f.records.find((item) => item.name === attachments[1])
							?.attachments ?? [],
				});
			const detail = /^\/api\/v1\/(memos\/[^/]+)$/u.exec(url.pathname);
			if (detail) {
				const item = f.records.find((item) => item.name === detail[1]);
				return send(item ?? {}, item ? 200 : 404);
			}
			const uid = /^\/file\/attachments\/([^/]+)$/u.exec(url.pathname)?.[1];
			return send(f.binary.get(uid) ?? {}, f.binary.has(uid) ? 200 : 404);
		} catch (error) {
			response.writeHead(500);
			response.end(JSON.stringify({ error: error.message }));
		}
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(async () => {
		await new Promise((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		// Only this fixture's own mkdtemp directory is removed.
		assert(
			path
				.resolve(temp)
				.startsWith(
					`${path.resolve(process.cwd())}${path.sep}.memos-sync-test-`,
				),
		);
		await fs.rm(temp, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	});
	f.config = {
		instanceId: "fixture",
		creator: "users/author",
		baseUrl: `http://127.0.0.1:${server.address().port}`,
		outputRoot: path.join(temp, "output"),
		stateDir: path.join(temp, "private-state"),
		timezone: "Asia/Shanghai",
		publish: false,
	};
	f.run = (options = {}) =>
		synchronize(f.config, {
			dryRun: false,
			token: "fixture-token",
			now: NOW,
			...options,
		});
	f.state = async () =>
		JSON.parse(
			await fs.readFile(path.join(f.config.stateDir, "state.json"), "utf8"),
		);
	f.content = async (entry) =>
		fs.readFile(
			path.join(f.config.outputRoot, "src/content/dynamic", entry.path),
			"utf8",
		);
	f.outputs = async () => {
		const root = path.join(f.config.outputRoot, "src/content/dynamic");
		try {
			return (await fs.readdir(root, { recursive: true })).filter((name) =>
				/\.(md|avif|gif|webp)$/u.test(name),
			);
		} catch (error) {
			if (error.code === "ENOENT") return [];
			throw error;
		}
	};
	f.image = async (item, uid, bytes, type = "image/png") => {
		f.binary.set(uid, bytes);
		item.attachments.push({
			name: `attachments/${uid}`,
			memo: item.name,
			type,
			size: String(bytes.length),
		});
	};
	return f;
}

const png = () =>
	sharp({
		create: {
			width: 3,
			height: 2,
			channels: 4,
			background: { r: 20, g: 40, b: 60, alpha: 0.5 },
		},
	})
		.png()
		.toBuffer();

test("only public normal author main memos export; API requests use the pinned authenticated contract", async (t) => {
	const f = await fixture(t, [
		memo(),
		memo("private", { visibility: "PRIVATE" }),
		memo("protected", { visibility: "PROTECTED" }),
		memo("space", { visibility: "SPACE" }),
		memo("archived", { state: "ARCHIVED" }),
		memo("other", { creator: "users/other" }),
		memo("reply", { parent: "memos/parent" }),
		memo("comment", {
			relations: [{ type: "COMMENT", memo: { name: "memos/comment" } }],
		}),
	]);
	const receipt = await f.run();
	assert.equal(receipt.changes.length, 1);
	assert.deepEqual(Object.keys((await f.state()).entries), ["memos/one"]);
	assert(
		f.requests.every(
			(request) =>
				request.auth === "Bearer fixture-token" && request.method === "GET",
		),
	);
	const lists = f.requests.filter(
		(request) => request.path === "/api/v1/memos",
	);
	assert.deepEqual(
		new Set(lists.map((request) => request.query.get("state"))),
		new Set(["NORMAL", "ARCHIVED"]),
	);
	assert(
		lists.every(
			(request) =>
				request.query.get("filter") === 'creator == "users/author"' &&
				request.query.get("pageSize") === "100",
		),
	);
});

test("dry-run reports a candidate without writing content, state or original images", async (t) => {
	const f = await fixture(t);
	await f.image(f.records[0], "pic", await png());
	const receipt = await f.run({ dryRun: true });
	assert.equal(receipt.mode, "dry-run");
	assert.equal(receipt.status, "candidate");
	assert.deepEqual(await f.outputs(), []);
	assert.deepEqual(await fs.readdir(f.config.stateDir), []);
});

test("text, inline image positions and unused attachment order survive; hashes deduplicate originals and public assets", async (t) => {
	const item = memo("one", {
		content:
			"前！\n\n![乙](/file/attachments/b)\n\n中🙂\n\n![甲](/file/attachments/a)\n\n后。",
	});
	const f = await fixture(t, [item]);
	const bytes = await png();
	await f.image(item, "a", bytes);
	await f.image(item, "b", bytes);
	const third = await sharp({
		create: { width: 2, height: 2, channels: 3, background: "red" },
	})
		.png()
		.toBuffer();
	await f.image(item, "c", third);
	await f.run();
	const state = await f.state();
	const entry = state.entries[item.name];
	const body = await f.content(entry);
	assert(
		body.includes(
			`前！\n\n![乙](./${entry.attachments.b.path})\n\n中🙂\n\n![甲](./${entry.attachments.a.path})\n\n后。\n\n![图片](./${entry.attachments.c.path})`,
		),
	);
	assert.equal(entry.attachments.a.path, entry.attachments.b.path);
	assert.equal(
		(await f.outputs()).filter((name) => name.endsWith(".avif")).length,
		2,
	);
	assert.deepEqual(
		new Set(await fs.readdir(path.join(f.config.stateDir, "originals"))),
		new Set([digest(bytes), digest(third)]),
	);
	assert(!body.includes(f.config.baseUrl));
	assert.equal(
		(
			await sharp(
				await fs.readFile(
					path.join(
						f.config.outputRoot,
						"src/content/dynamic",
						entry.attachments.a.path,
					),
				),
			).metadata()
		).hasAlpha,
		true,
	);
});

test("animated GIF attachments retain their original bytes and animation", async (t) => {
	const f = await fixture(t);
	const bytes = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), {
		raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
	})
		.gif({ delay: [100, 100], loop: 0 })
		.toBuffer();
	await f.image(f.records[0], "animation", bytes, "image/gif");
	await f.run();
	const entry = (await f.state()).entries["memos/one"];
	assert(entry.attachments.animation.path.endsWith(".gif"));
	assert.deepEqual(
		await fs.readFile(
			path.join(
				f.config.outputRoot,
				"src/content/dynamic",
				entry.attachments.animation.path,
			),
		),
		bytes,
	);
});

test("unsafe links, HTML, external and reference images fail before any outputs", async (t) => {
	for (const content of [
		'<img src="x">',
		"[bad](javascript:alert(1))",
		"![bad](https://example.com/a.png)",
		"![reference][photo]\n\n[photo]: /file/attachments/pic",
		"```md\n![code](/file/attachments/pic)\n```",
		"[private](/file/attachments/pic)",
	]) {
		await t.test(content.slice(0, 35), async (subtest) => {
			const f = await fixture(subtest, [memo("one", { content })]);
			await f.image(f.records[0], "pic", await png());
			await assert.rejects(f.run());
			assert.deepEqual(await f.outputs(), []);
			await assert.rejects(f.state(), { code: "ENOENT" });
		});
	}
});

test("edits preserve fixed first-publication identity, time and comment URL; repeat sync is idempotent", async (t) => {
	const f = await fixture(t, [memo(), memo("two")]);
	await f.run();
	const before = (await f.state()).entries["memos/one"];
	assert.equal(before.published, "2026-10-18 09:02:03");
	assert.notEqual(before.slug, (await f.state()).entries["memos/two"].slug);
	f.records[0].content = "编辑后的原文！";
	f.records[0].createTime = "2010-01-01T00:00:00Z";
	f.records[0].updateTime = "2026-10-19T00:00:00Z";
	const changed = await f.run({ now: new Date("2027-01-01T00:00:00Z") });
	const after = (await f.state()).entries["memos/one"];
	for (const key of ["slug", "path", "published", "firstPublished"])
		assert.equal(after[key], before[key]);
	assert.equal(changed.changes[0].commentPath, `/dynamic/${before.slug}/`);
	const repeat = await f.run();
	assert.deepEqual(repeat.changes, []);
	assert.deepEqual(repeat.files, []);
});

test("private, archived and author-confirmed deleted memos withdraw; republication keeps the slug", async (t) => {
	for (const transition of ["PRIVATE", "ARCHIVED", "DELETE"]) {
		await t.test(transition, async (subtest) => {
			const f = await fixture(subtest);
			await f.run();
			const original = (await f.state()).entries["memos/one"];
			const item = f.records[0];
			if (transition === "DELETE") f.records = [];
			else if (transition === "ARCHIVED") item.state = "ARCHIVED";
			else item.visibility = "PRIVATE";
			const receipt = await f.run();
			assert.equal(receipt.changes[0].action, "withdraw");
			assert.deepEqual(await f.outputs(), []);
			assert.equal((await f.state()).entries[item.name].active, false);
			f.records = [{ ...item, state: "NORMAL", visibility: "PUBLIC" }];
			await f.run({ now: new Date("2027-01-01T00:00:00Z") });
			assert.equal((await f.state()).entries[item.name].slug, original.slug);
		});
	}
});

test("wrong PAT author and forbidden detail never withdraw existing outputs", async (t) => {
	const f = await fixture(t);
	await f.run();
	const entry = (await f.state()).entries["memos/one"];
	const before = await f.content(entry);
	f.author = "users/other";
	await assert.rejects(f.run(), /PAT must belong/u);
	f.author = "users/author";
	f.records = [];
	f.handler = async (url, send) => {
		if (url.pathname === "/api/v1/memos/one") {
			send({}, 403);
			return true;
		}
		return false;
	};
	await assert.rejects(f.run(), /HTTP 403/u);
	assert.equal(await f.content(entry), before);
	assert.equal((await f.state()).generation, 1);
});

test("failed second pages and cyclic page tokens apply nothing", async (t) => {
	for (const mode of ["failure", "cycle"]) {
		await t.test(mode, async (subtest) => {
			const f = await fixture(subtest);
			f.handler = async (url, send) => {
				if (
					url.pathname !== "/api/v1/memos" ||
					url.searchParams.get("state") !== "NORMAL"
				)
					return false;
				if (!url.searchParams.has("pageToken"))
					send({ memos: f.records, nextPageToken: "page-2" });
				else if (mode === "failure") send({}, 403);
				else send({ memos: [], nextPageToken: "page-2" });
				return true;
			};
			await assert.rejects(
				f.run(),
				mode === "failure" ? /HTTP 403/u : /Repeated page token/u,
			);
			assert.deepEqual(await f.outputs(), []);
			await assert.rejects(f.state(), { code: "ENOENT" });
		});
	}
});

test("attachment HTTP or validation failure produces no partial content or images", async (t) => {
	for (const mode of ["missing", "length", "type"]) {
		await t.test(mode, async (subtest) => {
			const f = await fixture(subtest);
			await f.image(f.records[0], "good", await png());
			await f.image(f.records[0], "bad", await png());
			if (mode === "missing") f.binary.delete("bad");
			if (mode === "length") f.records[0].attachments[1].size = "1";
			if (mode === "type") f.records[0].attachments[1].type = "image/webp";
			await assert.rejects(f.run());
			assert.deepEqual(await f.outputs(), []);
			assert.deepEqual(await fs.readdir(f.config.stateDir), []);
		});
	}
});

test("manual managed-file edits stop synchronization without overwriting the edit", async (t) => {
	const f = await fixture(t);
	await f.run();
	const entry = (await f.state()).entries["memos/one"];
	const target = path.join(
		f.config.outputRoot,
		"src/content/dynamic",
		entry.path,
	);
	await fs.writeFile(target, "manual user edit");
	f.records[0].content = "new source";
	await assert.rejects(f.run(), /Managed file conflict/u);
	assert.equal(await fs.readFile(target, "utf8"), "manual user edit");
	assert.equal((await f.state()).generation, 1);
});

test("source mutation between snapshots aborts the entire apply", async (t) => {
	const f = await fixture(t);
	let lists = 0;
	f.handler = async (url) => {
		if (
			url.pathname === "/api/v1/memos" &&
			url.searchParams.get("state") === "NORMAL" &&
			++lists === 2
		)
			f.records[0].content = "changed during sync";
		return false;
	};
	await assert.rejects(f.run(), /Source changed/u);
	assert.deepEqual(await f.outputs(), []);
	await assert.rejects(f.state(), { code: "ENOENT" });
});

test("interrupted apply rolls back and fetches fresh source; stale public candidate is never replayed", async (t) => {
	const f = await fixture(t);
	await f.run();
	const entry = (await f.state()).entries["memos/one"];
	const original = await f.content(entry);
	f.records[0].content = "interrupted candidate";
	await assert.rejects(
		f.run({
			inject: (phase) => {
				if (phase.endsWith(".md")) throw new Error("simulated crash");
			},
		}),
		/simulated crash/u,
	);
	assert((await f.content(entry)).includes("interrupted candidate"));
	await assert.rejects(f.run({ dryRun: true }), /Pending transaction/u);
	f.records[0].visibility = "PRIVATE";
	let observedRollback = false;
	f.handler = async (url) => {
		if (url.pathname === "/api/v1/instance/profile") {
			assert.equal(await f.content(entry), original);
			observedRollback = true;
		}
		return false;
	};
	await f.run();
	assert(observedRollback);
	assert.deepEqual(await f.outputs(), []);
	assert.equal((await f.state()).entries["memos/one"].active, false);
	await assert.rejects(fs.stat(path.join(f.config.stateDir, "journal.json")), {
		code: "ENOENT",
	});
});

test("concurrent syncs cannot acquire the same state lock", async (t) => {
	const f = await fixture(t);
	let release;
	let entered;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const started = new Promise((resolve) => {
		entered = resolve;
	});
	let held = false;
	f.handler = async (url) => {
		if (url.pathname === "/api/v1/instance/profile" && !held) {
			held = true;
			entered();
			await gate;
		}
		return false;
	};
	const first = f.run();
	await started;
	try {
		await assert.rejects(f.run(), { code: "EEXIST" });
	} finally {
		release();
	}
	await first;
	assert.equal((await f.state()).generation, 1);
});

test("frontmatter preserves the publication instant and maps pinned and location safely", async (t) => {
	const location = '广州："城中"\n下一行🙂';
	const f = await fixture(t, [
		memo("one", {
			pinned: true,
			location: { placeholder: location, latitude: 23.1, longitude: 113.2 },
		}),
	]);
	await f.run();
	const entry = (await f.state()).entries["memos/one"];
	const metadata = parseYaml(
		/^---\n([\s\S]*?)\n---/u.exec(await f.content(entry))[1],
	);
	assert.equal(new Date(metadata.published).getTime(), NOW.getTime());
	assert.equal(metadata.published, NOW.toISOString());
	assert.equal(metadata.pinned, true);
	assert.equal(metadata.location, location);
	assert.equal(entry.published, "2026-10-18 09:02:03");
	f.records[0].pinned = false;
	delete f.records[0].location;
	await f.run({ now: new Date("2027-01-01T00:00:00Z") });
	const edited = parseYaml(
		/^---\n([\s\S]*?)\n---/u.exec(await f.content(entry))[1],
	);
	assert.equal(new Date(edited.published).getTime(), NOW.getTime());
	assert(!Object.hasOwn(edited, "pinned"));
	assert(!Object.hasOwn(edited, "location"));
});

test("removed attachments and withdrawn memos retain historical managed image assets without garbage collection", async (t) => {
	const f = await fixture(t);
	await f.image(f.records[0], "pic", await png());
	await f.run();
	const original = (await f.state()).entries["memos/one"].attachments.pic;
	const imagePath = path.join(
		f.config.outputRoot,
		"src/content/dynamic",
		original.path,
	);
	const before = await fs.readFile(imagePath);
	f.records[0].attachments = [];
	const edited = await f.run();
	assert(!edited.files.some((file) => file.path === original.path));
	assert.equal((await f.state()).files[original.path], digest(before));
	f.records[0].visibility = "PRIVATE";
	const withdrawn = await f.run();
	assert.deepEqual(
		withdrawn.files.map((file) => file.action),
		["delete"],
	);
	assert.deepEqual(await fs.readFile(imagePath), before);
	assert.equal((await f.state()).files[original.path], digest(before));
	assert.deepEqual(
		await fs.readdir(path.join(f.config.stateDir, "originals")),
		[original.originalSha256],
	);
});

test("before-state and after-state crashes recover according to the persisted generation", async (t) => {
	for (const phase of ["before-state", "after-state"]) {
		await t.test(phase, async (subtest) => {
			const f = await fixture(subtest);
			await f.run();
			const entry = (await f.state()).entries["memos/one"];
			const oldContent = await f.content(entry);
			f.records[0].content = "candidate at crash";
			await assert.rejects(
				f.run({
					inject: (point) => {
						if (point === phase) throw new Error("injected crash");
					},
				}),
				/injected crash/u,
			);
			assert.equal(
				(await f.state()).generation,
				phase === "after-state" ? 2 : 1,
			);
			let checked = false;
			f.handler = async (url) => {
				if (url.pathname === "/api/v1/instance/profile" && !checked) {
					const body = await f.content(entry);
					if (phase === "before-state") assert.equal(body, oldContent);
					else assert(body.includes("candidate at crash"));
					checked = true;
				}
				return false;
			};
			f.records[0].content = "fresh source after restart";
			await f.run();
			assert(checked);
			assert((await f.content(entry)).includes("fresh source after restart"));
			assert.equal(
				(await f.state()).generation,
				phase === "after-state" ? 3 : 2,
			);
			await assert.rejects(
				fs.stat(path.join(f.config.stateDir, "journal.json")),
				{ code: "ENOENT" },
			);
		});
	}
});

test("successful multi-page memo and attachment lists consume every lowerCamelCase nextPageToken", async (t) => {
	const f = await fixture(t, [memo(), memo("two")]);
	await f.image(f.records[0], "a", await png());
	await f.image(f.records[0], "b", await png());
	f.handler = async (url, send) => {
		if (
			url.pathname === "/api/v1/memos" &&
			url.searchParams.get("state") === "NORMAL"
		) {
			if (url.searchParams.get("pageToken") === "memo-next")
				send({ memos: [f.records[1]] });
			else send({ memos: [f.records[0]], nextPageToken: "memo-next" });
			return true;
		}
		if (url.pathname === "/api/v1/memos/one/attachments") {
			if (url.searchParams.get("pageToken") === "attachment-next")
				send({ attachments: [f.records[0].attachments[1]] });
			else
				send({
					attachments: [f.records[0].attachments[0]],
					nextPageToken: "attachment-next",
				});
			return true;
		}
		return false;
	};
	await f.run();
	assert.deepEqual(Object.keys((await f.state()).entries), [
		"memos/one",
		"memos/two",
	]);
	assert.deepEqual(
		Object.keys((await f.state()).entries["memos/one"].attachments),
		["a", "b"],
	);
	assert.equal(
		f.requests.filter(
			(request) => request.query.get("pageToken") === "memo-next",
		).length,
		2,
	);
	assert.equal(
		f.requests.filter(
			(request) => request.query.get("pageToken") === "attachment-next",
		).length,
		2,
	);
});

test("attachment redirects are never followed and streamed oversized responses abort without outputs", async (t) => {
	for (const mode of ["redirect", "stream-limit"]) {
		await t.test(mode, async (subtest) => {
			const f = await fixture(subtest);
			f.config.maxAttachmentBytes = 100;
			f.records[0].attachments = [
				{
					name: "attachments/pic",
					memo: "memos/one",
					type: "image/png",
					size: "1",
				},
			];
			f.handler = async (url, _send, response) => {
				if (url.pathname !== "/file/attachments/pic") return false;
				if (mode === "redirect") {
					response.writeHead(302, {
						location: `${f.config.baseUrl}/must-not-follow`,
					});
					response.end();
				} else {
					response.writeHead(200, {
						"content-type": "application/octet-stream",
						"transfer-encoding": "chunked",
					});
					response.write(Buffer.alloc(80));
					response.end(Buffer.alloc(80));
				}
				return true;
			};
			await assert.rejects(
				f.run(),
				mode === "redirect" ? /HTTP 302/u : /Response too large/u,
			);
			assert(
				!f.requests.some((request) => request.path === "/must-not-follow"),
			);
			assert.deepEqual(await f.outputs(), []);
			await assert.rejects(f.state(), { code: "ENOENT" });
		});
	}
});

test("an existing dynamic slug blocks a new memo and configuration changes cannot reuse bound state", async (t) => {
	await t.test("slug collision", async (subtest) => {
		const f = await fixture(subtest);
		const candidate = await f.run({ dryRun: true });
		const dir = path.join(f.config.outputRoot, "src/content/dynamic");
		await fs.mkdir(dir, { recursive: true });
		const existing = `---\nslug: ${candidate.changes[0].id}\n---\n\nuser-owned article`;
		await fs.writeFile(path.join(dir, "user-owned.md"), existing);
		await assert.rejects(f.run(), /Dynamic slug collision/u);
		assert.equal(
			await fs.readFile(path.join(dir, "user-owned.md"), "utf8"),
			existing,
		);
		assert.deepEqual(await f.outputs(), ["user-owned.md"]);
	});
	await t.test("bound state", async (subtest) => {
		const f = await fixture(subtest);
		await f.run();
		const before = await f.state();
		const requestCount = f.requests.length;
		f.config.timezone = "UTC";
		await assert.rejects(f.run(), /State binding\/schema mismatch/u);
		assert.deepEqual(await f.state(), before);
		assert.equal(f.requests.length, requestCount);
	});
});
