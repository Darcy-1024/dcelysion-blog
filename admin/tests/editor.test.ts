import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { EditorSession, textareaChange } from "../client/editor-session.js";
import { DraftService, hash } from "../server/drafts.js";
import { inside } from "../server/paths.js";
import { images, inspect, moveImage, patchField } from "../shared/editor.js";
import { contentIdentity } from "../shared/identity.js";
import { dynamic, fixture, sample } from "./fixture.js";

test("无损字段补丁与源码保存边界：BOM、CRLF、注释、未知嵌套、多行、MDX", () => {
	assert.equal(patchField(sample, "posts", "title", "原标题"), sample);
	const changed = patchField(sample, "posts", "title", "新标题，🙂");
	assert.equal(changed, sample.replace("title: 原标题", 'title: "新标题，🙂"'));
	assert.ok(changed.includes("description: |- # 说明\r\n  第一行\r\n  第二行"));
	assert.equal(
		patchField(sample, "posts", "draft", true),
		sample.replace("---\r\n\r\nimport", "draft: true\r\n---\r\n\r\nimport"),
	);
	for (const text of [
		"title: >- # c\n  foo\n",
		"title: &t foo\nother: *t\n",
		"title: [bad\n",
		"title: foo\ntitle: bar\n",
		'title: "multi\n line"\n',
	]) {
		const src = `---\n${text}published: 2026-09-30\n---\n\n保持正文`;
		assert.ok(!inspect(src, "posts").editable.includes("title"));
		assert.throws(() => patchField(src, "posts", "title", "new"));
	}
	assert.equal(textareaChange(sample, sample.replaceAll("\r\n", "\n")), sample);
	assert.equal(
		textareaChange(
			sample,
			sample.replaceAll("\r\n", "\n").replace("正文", "新正文"),
		),
		sample.replace("正文", "新正文"),
	);
	const loneCR = sample.replaceAll("\r\n", "\r");
	const timestamp = patchField(
		sample,
		"posts",
		"published",
		"2026-09-30T12:00:00+08:00",
	);
	assert.ok(timestamp.includes("published: 2026-09-30T12:00:00+08:00"));
	assert.equal(inspect(timestamp, "posts").errors.length, 0);
	assert.ok(
		inspect(sample.replace("2026-09-30", "2026-02-30"), "posts").errors.length,
	);
	assert.equal(
		textareaChange(
			loneCR,
			loneCR.replaceAll("\r", "\n").replace("正文", "新正文"),
		),
		loneCR.replace("正文", "新正文"),
	);
	assert.equal(
		inspect(
			"---\ntitle: foo\npublished: 2026-09-30\ntags: [a,b]\n---\n",
			"posts",
		).errors.length,
		0,
	);
});
test("动态仅交换完整图片引用，重复、alt、标题、空白与标识不变", () => {
	const result = moveImage(dynamic, 0, 2);
	const refs = images(dynamic).items;
	assert.equal(
		images(result)
			.items.map((item) => item.raw)
			.join("\n"),
		[refs[1].raw, refs[2].raw, refs[0].raw].join("\n"),
	);
	const withoutImages = (source: string) => {
		let value = source;
		for (const ref of [...images(source).items].reverse())
			value = value.slice(0, ref.start) + value.slice(ref.end);
		return value;
	};
	assert.equal(withoutImages(result), withoutImages(dynamic));
	assert.equal(
		images(`${dynamic}\n\x60\x60\x60\n![代码](x)\n\x60\x60\x60`).sortable,
		false,
	);
	assert.throws(() => moveImage(`${dynamic}\n<Component />`, 0, 1));
	for (const fence of ["`", "``"])
		assert.equal(
			images(`${fence}\n![代码](x)\n${fence}\n${dynamic}`).sortable,
			false,
		);
	const crlf = dynamic.replaceAll("\n", "\r\n");
	assert.equal(moveImage(crlf, 0, 2), result.replaceAll("\n", "\r\n"));
	assert.equal(
		contentIdentity("nested/Hello World/index.md", "").id,
		"nested/hello-world",
	);
	assert.equal(
		contentIdentity("file.md", "---\nslug: original-id\n---\n").id,
		"original-id",
	);
});
test("Windows 目录边界拒绝跨盘、同盘外部与 UNC", () => {
	if (process.platform !== "win32") return;
	assert.equal(inside("F:\\repo", "F:\\repo\\src\\content"), true);
	assert.equal(inside("F:\\repo", "F:\\outside"), false);
	assert.equal(inside("F:\\repo", "G:\\outside"), false);
	assert.equal(inside("F:\\repo", "\\\\server\\share\\file"), false);
});
test("隔离持久化、CAS、幂等、来源变化/删除、路径碰撞与非法 YAML 保留", async () => {
	const f = await fixture();
	try {
		const id = randomUUID();
		const created = await f.drafts.create(7, {
			requestId: id,
			kind: "posts",
			path: "example.mdx",
			fromSource: true,
		});
		assert.equal(created.draft.source, sample);
		assert.equal(created.draft.baseHash, hash(sample));
		assert.equal(created.draft.path, "example.mdx");
		const roundTrip = await f.drafts.create(7, {
			requestId: randomUUID(),
			kind: "posts",
			path: "example.mdx",
			fromSource: true,
		});
		assert.equal(
			(
				await f.drafts.save(7, roundTrip.draft.id, {
					requestId: randomUUID(),
					revision: 1,
					source: sample,
				})
			).draft.source,
			sample,
		);
		const a = { requestId: randomUUID(), revision: 1, source: `${sample}\nA` };
		const b = { requestId: randomUUID(), revision: 1, source: `${sample}\nB` };
		const race = await Promise.allSettled([
			f.drafts.save(7, id, a),
			f.drafts.save(7, id, b),
		]);
		assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
		const accepted = race[0].status === "fulfilled" ? a : b;
		const first = await f.drafts.save(7, id, accepted);
		assert.equal(first.draft.revision, 2);
		const invalid = "---\ntitle: [未写完\n---\n保留，🙂  \n";
		const saved = await f.drafts.save(7, id, {
			requestId: randomUUID(),
			revision: 2,
			source: invalid,
		});
		assert.equal(saved.draft.revision, 3);
		for (const source of ["a\0b", "a\ud800b", "a\udc00b"])
			await assert.rejects(
				() =>
					f.drafts.save(7, id, {
						requestId: randomUUID(),
						revision: 3,
						source,
					}),
				{ code: "INPUT" },
			);
		assert.ok(saved.metadata.errors.length);
		const replay = await f.drafts.save(7, id, accepted);
		assert.equal(replay.draft.revision, 2);
		assert.equal((await f.drafts.get(id, 7)).source, invalid);
		await assert.rejects(
			() => f.drafts.save(7, id, { ...accepted, source: "different" }),
			{ code: "REQUEST_REUSE" },
		);
		await assert.rejects(() => f.drafts.get(id, 8), { code: "NOT_FOUND" });
		const restart = new DraftService(f.root, "", f.adapter);
		assert.equal((await restart.get(id, 7)).source, invalid);
		await writeFile(
			join(f.root, "src/content/posts/example.mdx"),
			`${sample}源改动`,
		);
		await assert.rejects(
			() =>
				f.drafts.save(7, id, {
					requestId: randomUUID(),
					revision: 3,
					source: "本地输入",
				}),
			{ code: "SOURCE_CONFLICT" },
		);
		const copy = await f.drafts.create(7, {
			requestId: randomUUID(),
			copyFrom: id,
			source: "本地输入",
		});
		assert.equal(copy.draft.baseHash, created.draft.baseHash);
		assert.equal(copy.draft.sourceId, "example.mdx");
		assert.equal(copy.draft.baseSource, sample);
		assert.equal(copy.draft.snapshot, true);
		await f.drafts.save(7, copy.draft.id, {
			requestId: randomUUID(),
			revision: 1,
			source: "副本继续保存",
		});
		await rm(join(f.root, "src/content/posts/example.mdx"));
		assert.equal(
			(await f.drafts.detail(await f.drafts.get(id, 7))).sourceState.reason,
			"deleted",
		);
		const newInput = { requestId: randomUUID(), kind: "posts", path: "new.md" };
		const newDraft = await f.drafts.create(7, newInput);
		await assert.rejects(
			() =>
				f.drafts.create(7, {
					requestId: randomUUID(),
					kind: "posts",
					path: "different.md",
					source:
						"---\ntitle: different\npublished: 2026-09-30\nslug: new\n---\n",
				}),
			{ code: "PATH_COLLISION" },
		);
		await writeFile(
			join(f.root, "src/content/posts/custom.md"),
			"---\ntitle: custom\npublished: 2026-09-30\nslug: occupied\n---\n",
		);
		await assert.rejects(
			() =>
				f.drafts.create(7, {
					requestId: randomUUID(),
					kind: "posts",
					path: "occupied.md",
				}),
			{ code: "PATH_COLLISION" },
		);
		const fixed = await f.drafts.create(7, {
			requestId: randomUUID(),
			kind: "posts",
			path: "custom.md",
			fromSource: true,
		});
		const modifiedSlug = await f.drafts.save(7, fixed.draft.id, {
			requestId: randomUUID(),
			revision: 1,
			source: fixed.draft.source.replace("slug: occupied", "slug: changed"),
		});
		assert.equal(modifiedSlug.draft.contentId, "occupied");
		assert.ok(
			modifiedSlug.metadata.errors.some((error) =>
				error.includes("固定内容标识"),
			),
		);
		assert.equal(
			(await f.drafts.create(7, newInput)).draft.id,
			newDraft.draft.id,
		);
		await assert.rejects(
			() =>
				f.drafts.create(7, {
					...newInput,
					requestId: randomUUID(),
					path: "new.mdx",
				}),
			{ code: "PATH_COLLISION" },
		);
		await writeFile(join(f.root, "src/content/posts/new.mdx"), sample);
		await assert.rejects(
			() =>
				f.drafts.save(7, newDraft.draft.id, {
					requestId: randomUUID(),
					revision: 1,
					source: sample,
				}),
			{ code: "SOURCE_CONFLICT" },
		);
		for (const path of [
			"../escape.md",
			"C:/secret.md",
			"/abs.md",
			"posts\\a.md",
			"a/../b.md",
			"CON.md",
			"a.md ",
			"a%2fb.md",
		])
			await assert.rejects(
				() =>
					f.drafts.create(7, { requestId: randomUUID(), kind: "posts", path }),
				{ code: "PATH" },
			);
		const outside = join(f.root, "outside-content");
		await mkdir(outside);
		await writeFile(join(outside, "secret.md"), sample);
		await symlink(
			outside,
			join(f.root, "src/content/posts/escape"),
			"junction",
		);
		await assert.rejects(
			() => f.drafts.readSource("posts", "escape/secret.md"),
			{ code: "PATH" },
		);
		await assert.rejects(
			() =>
				f.drafts.create(7, {
					requestId: randomUUID(),
					kind: "posts",
					path: "escape/new.md",
				}),
			{ code: "PATH" },
		);
		await rm(join(f.root, "src/content/posts/escape"));
		const d = await f.drafts.create(7, {
			requestId: randomUUID(),
			kind: "dynamic",
			path: "2026-09-30-120000.md",
			fromSource: true,
		});
		const reordered = await f.drafts.save(7, d.draft.id, {
			requestId: randomUUID(),
			revision: 1,
			source: moveImage(d.draft.source, 0, 1),
		});
		assert.equal(reordered.draft.path, d.draft.path);
		assert.equal(reordered.draft.sourceId, d.draft.sourceId);
		assert.equal(
			await readFile(
				join(f.root, "src/content/dynamic/2026-09-30-120000.md"),
				"utf8",
			),
			dynamic,
		);
	} finally {
		await f.db.close();
		await rm(f.root, { recursive: true, force: true });
	}
});
test("PGlite 关闭/重开后的私有草稿仍在磁盘，公开输入不变", async () => {
	const f = await fixture();
	const root = f.root;
	const input = {
		requestId: randomUUID(),
		kind: "posts",
		path: "restart.md",
		source: "私有正文🙂",
	};
	const draft = await f.drafts.create(7, input);
	await f.db.close();
	const reopened = await fixture(4324, root);
	try {
		assert.equal(
			(await reopened.drafts.get(draft.draft.id, 7)).source,
			input.source,
		);
		assert.equal(
			await readFile(join(root, "src/content/posts/example.mdx"), "utf8"),
			sample,
		);
	} finally {
		await reopened.db.close();
		await rm(root, { recursive: true, force: true });
	}
});
test("真实 API 路由 + 模拟身份：未授权、Origin、会话撤销、保存与 no-store", async () => {
	const f = await fixture();
	const server = createServer((req, res) => {
		void f.api(req, res, new URL(req.url || "/", f.config.origin)).catch(() => {
			res.writeHead(500);
			res.end();
		});
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const origin = `http://127.0.0.1:${address.port}`;
	const get = (path: string, cookie = "") =>
		fetch(origin + path, { headers: { cookie } });
	const post = (
		path: string,
		body: unknown,
		cookie = "",
		source = f.config.origin,
	) =>
		fetch(origin + path, {
			method: "POST",
			headers: { "content-type": "application/json", origin: source, cookie },
			body: JSON.stringify(body),
		});
	try {
		assert.equal((await get("/api/drafts?kind=posts")).status, 401);
		assert.equal(
			(await post("/api/drafts", {}, "", "https://evil.invalid")).status,
			403,
		);
		const login = await post("/api/login", {
			identity: "preview",
			password: "preview",
		});
		assert.equal(login.status, 200);
		const cookie = login.headers.get("set-cookie")?.split(";")[0] || "";
		const created = await post(
			"/api/drafts",
			{ requestId: randomUUID(), kind: "posts", path: "api.md" },
			cookie,
		);
		assert.equal(created.status, 200);
		assert.equal(created.headers.get("cache-control"), "no-store");
		const id = (await created.json()).data.draft.id;
		assert.equal(
			(
				await post(
					`/api/drafts/${id}/save`,
					{ requestId: randomUUID(), revision: 1, source: "非法 [ YAML🙂" },
					cookie,
				)
			).status,
			200,
		);
		assert.equal((await get(`/api/drafts/${id}`, cookie)).status, 200);
		assert.equal((await post("/api/drafts", [], cookie)).status, 400);
		assert.equal(
			(
				await post(
					`/api/drafts/${id}/save`,
					{ requestId: randomUUID(), revision: 2, source: "a".repeat(524289) },
					cookie,
				)
			).status,
			400,
		);
		await f.db.exec(
			"UPDATE wl_users SET auth_version=auth_version+1 WHERE id=7",
		);
		assert.equal((await get(`/api/drafts/${id}`, cookie)).status, 401);
		assert.equal(
			(await post(`/api/drafts/${id}/save`, {}, cookie)).status,
			401,
		);
	} finally {
		await new Promise<void>((done) => server.close(() => done()));
		await f.db.close();
		await rm(f.root, { recursive: true, force: true });
	}
});
test("自动保存序列：在途新输入、失败幂等重试、冲突暂停、销毁后忽略响应", async () => {
	const detail = {
		draft: { id: randomUUID(), source: "old", revision: 1, snapshot: false },
		sourceState: { changed: false },
		metadata: {},
	} as ConstructorParameters<typeof EditorSession>[0];
	let resolve!: (
		value: Awaited<ReturnType<ConstructorParameters<typeof EditorSession>[1]>>,
	) => void;
	const sent: unknown[] = [];
	const session = new EditorSession(
		detail,
		(input) => {
			sent.push(input);
			return new Promise((done) => (resolve = done));
		},
		() => {},
	);
	session.edit("first");
	const first = session.save();
	session.edit("later");
	await session.save();
	assert.equal(sent.length, 1);
	resolve({
		ok: true,
		data: {
			...detail,
			draft: { ...detail.draft, source: "first", revision: 2 },
		},
	});
	await first;
	assert.equal(session.source, "later");
	assert.equal(session.state, "dirty");
	assert.equal(session.revision, 2);
	const second = session.save();
	resolve({ ok: false, error: { code: "DRAFT_STORE" } });
	await second;
	const pending = session.pending;
	const retry = session.save();
	assert.equal(sent[1], sent[2]);
	assert.equal(session.pending, pending);
	resolve({
		ok: false,
		error: {
			code: "REVISION_CONFLICT",
			details: { reason: "revision", saved: detail },
		},
	});
	await retry;
	await session.save();
	assert.equal(session.state, "conflict");
	assert.equal(sent.length, 3);
	assert.equal(session.source, "later");
	const other = new EditorSession(
		detail,
		() => new Promise((done) => (resolve = done)),
		() => {},
	);
	other.edit("new");
	const inflight = other.save();
	other.dispose();
	resolve({ ok: true, data: detail });
	await inflight;
	assert.equal(other.source, "new");
	assert.equal(other.savedSource, "old");
	const repairedRequests: { requestId: string; source: string }[] = [];
	const repaired = new EditorSession(
		detail,
		async (input) => {
			repairedRequests.push(input);
			return repairedRequests.length === 1
				? { ok: false, error: { code: "INPUT" } }
				: {
						ok: true,
						data: {
							...detail,
							draft: { ...detail.draft, source: input.source, revision: 2 },
						},
					};
		},
		() => {},
	);
	repaired.edit("bad\0input");
	await repaired.save();
	assert.equal(repaired.pending, null);
	repaired.edit("valid🙂");
	await repaired.save();
	assert.equal(repairedRequests[1].source, "valid🙂");
	assert.notEqual(repairedRequests[1].requestId, repairedRequests[0].requestId);
	assert.equal(repaired.state, "saved");
});
