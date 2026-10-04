import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { DraftError } from "../server/drafts.js";
import { MediaService } from "../server/media.js";
import { mediaMarker, mediaPositions } from "../shared/media.js";
import { mediaFixture } from "./media-fixture.js";
import { publication } from "./publish-fixture.js";

const hasCode = (code: string) => (error: unknown) =>
	error instanceof DraftError && error.code === code;
const image = () =>
	sharp({
		create: { width: 80, height: 60, channels: 3, background: "#5679bc" },
	})
		.png()
		.toBuffer();

test("统一媒体：私有双副本、失败重试、固定依赖门禁、公开与引用保留、持久恢复", async () => {
	const f = await mediaFixture();
	let dbClosed = false;
	let closedMedia = false;
	try {
		const bytes = await image();
		const id = randomUUID();
		f.objects.failNext = true;
		const uploaded = await f.media.upload(
			7,
			id,
			"代表图片.png",
			bytes.length,
			Readable.from([bytes]),
			"article",
		);
		assert.equal(
			uploaded.original.sha256,
			createHash("sha256").update(bytes).digest("hex"),
		);
		assert.ok(uploaded.preview);
		assert.equal(uploaded.width, 80);
		await f.media.idle();
		assert.equal((await f.media.get(7, id)).privateCopy, "failed");
		assert.deepEqual(await readdir(f.mediaConfig.publicRoot), []);
		const source = `${publication}[![原文，🙂](${mediaMarker(id, "preview")})](${mediaMarker(id)})\n`;
		const draft = (
			await f.drafts.create(7, {
				requestId: randomUUID(),
				kind: "posts",
				path: "managed.md",
				source,
			})
		).draft;
		const originalSource = await readFile(
			join(f.root, "src/content/posts/example.mdx"),
			"utf8",
		);
		const diff = await f.jobs.diff(7, {
			draftId: draft.id,
			revision: 1,
			targetId: f.target.id,
		});
		assert.ok(!diff.after.includes("/__managed-media/"));
		assert.equal(diff.mediaPlan?.dependencies.length, 2);
		const input = {
			requestId: randomUUID(),
			draftId: draft.id,
			revision: 1,
			targetId: f.target.id,
			kind: "publish",
			base: diff.base,
			confirm: f.target.fingerprint,
			mediaConfirm: diff.mediaConfirm,
		};
		const task = await f.jobs.create(7, input);
		await f.jobs.idle();
		assert.equal((await f.jobs.get(7, task.id)).error, "MEDIA_NOT_READY");
		assert.equal(f.builder.count, 0);
		await f.media.retry(7, id);
		await f.media.idle();
		assert.equal((await f.media.get(7, id)).privateCopy, "ready");
		const repeated = await f.media.upload(
			7,
			id,
			"代表图片.png",
			bytes.length,
			Readable.from([bytes]),
			"article",
		);
		assert.equal(repeated.id, id);
		await assert.rejects(
			() =>
				f.media.upload(
					7,
					id,
					"代表图片.png",
					bytes.length,
					Readable.from([Buffer.alloc(bytes.length)]),
					"article",
				),
			hasCode("REQUEST_REUSE"),
		);
		await f.drafts.save(7, draft.id, {
			requestId: randomUUID(),
			revision: 1,
			source: `${source}\n后续私有编辑`,
		});
		await f.media.deleted(7, id, true);
		assert.equal((await f.media.list(7, false, "all")).items.length, 0);
		const refs = await f.media.references(7, id);
		assert.ok(refs.refs.some((r) => r.kind === "draft"));
		assert.ok(refs.refs.some((r) => r.kind === "job"));
		assert.ok(refs.refs.some((r) => r.kind === "draft_revision"));
		assert.equal(refs.physicalCleanupAllowed, false);
		await f.jobs.retry(7, task.id);
		await f.jobs.idle();
		const job = await f.jobs.get(7, task.id);
		assert.equal(job.status, "succeeded");
		assert.equal(job.snapshot.source, source);
		assert.equal(job.effects.pushed, true);
		assert.equal((await f.media.get(7, id)).publicCopy, "ready");
		assert.equal(
			await readFile(join(f.root, "src/content/posts/example.mdx"), "utf8"),
			originalSource,
		);
		await f.media.deleted(7, id, false);
		assert.equal((await f.media.get(7, id)).deleted, false);
		const plan = await f.media.plan(7, source);
		await f.media.ensure(7, plan, true);
		const object = uploaded.original;
		await writeFile(
			join(f.objects.root, "private", object.key),
			Buffer.alloc(object.size),
		);
		await assert.rejects(
			() => f.media.ensure(7, plan, true),
			hasCode("MEDIA_INTEGRITY"),
		);
		await writeFile(join(f.objects.root, "private", object.key), bytes);
		await f.media.retry(7, id);
		await f.media.idle();
		const metadata = join(
			f.objects.root,
			"private",
			`${object.key}.metadata.json`,
		);
		await writeFile(
			metadata,
			JSON.stringify({ mime: object.mime, size: object.size + 1 }),
		);
		await assert.rejects(
			() => f.media.ensure(7, plan, true),
			hasCode("MEDIA_INTEGRITY"),
		);
		await writeFile(
			metadata,
			JSON.stringify({ mime: object.mime, size: object.size }),
		);
		// Reopening verifies durable queue recovery, not a mock in-memory queue.
		await f.media.close();
		closedMedia = true;
		await f.db.query(
			'UPDATE dc_admin.media SET document=document || \'{"local":"uploading","privateCopy":"running"}\'::jsonb WHERE id=$1',
			[id],
		);
		const resumed = f.newMedia();
		resumed.kick();
		await resumed.idle();
		assert.equal((await resumed.get(7, id)).privateCopy, "ready");
		await resumed.close();
		await f.jobs.close();
		await f.db.close();
		dbClosed = true;
		const persisted = new PGlite(join(f.root, "private-db"));
		try {
			assert.equal(
				(
					await persisted.query<{ count: number }>(
						"SELECT count(*)::int AS count FROM dc_admin.media",
					)
				).rows[0].count,
				1,
			);
			assert.ok(
				(
					await persisted.query(
						"SELECT * FROM dc_admin.media_refs WHERE kind='job'",
					)
				).rows.length > 0,
			);
		} finally {
			await persisted.close();
		}
	} finally {
		if (!closedMedia) await f.media.close();
		await f.jobs.close();
		if (!dbClosed) await f.db.close();
	}
});

test("上传边界：格式/主动内容/长度/像素/文本；API授权、CSRF、Range与路径；私有预览不公开", async () => {
	const f = await mediaFixture(4327);
	const server = createServer((req, res) => {
		void f.api(req, res, new URL(req.url || "/", f.config.origin));
	});
	await new Promise<void>((accept, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", accept);
	});
	const address = server.address();
	assert.ok(address && typeof address === "object");
	f.config.origin = `http://127.0.0.1:${address.port}`;
	try {
		const bytes = await image();
		for (const [name, contents, code] of [
			["假.jpg", bytes, "MEDIA_TYPE"],
			["active.svg", Buffer.from('<svg onload="alert(1)"/>'), "MEDIA_TYPE"],
			["page.html", Buffer.from("<html>test</html>"), "MEDIA_TYPE"],
			["lyric.lrc", Buffer.from("<script>bad</script>"), "MEDIA_TYPE"],
			["bad.txt", Buffer.from([255, 254, 1]), "MEDIA_TYPE"],
		] as const)
			await assert.rejects(
				() =>
					f.media.upload(
						7,
						randomUUID(),
						name,
						contents.length,
						Readable.from([contents]),
						"article",
					),
				hasCode(code),
			);
		await assert.rejects(
			() =>
				f.media.upload(
					7,
					randomUUID(),
					"large.mp4",
					129 * 1024 * 1024,
					Readable.from([]),
					"article",
				),
			hasCode("MEDIA_SIZE"),
		);
		await assert.rejects(
			() =>
				f.media.upload(
					7,
					randomUUID(),
					"bad.png",
					bytes.length + 1,
					Readable.from([bytes]),
					"article",
				),
			hasCode("MEDIA_SIZE"),
		);
		const huge = await sharp({
			create: { width: 5000, height: 5000, channels: 3, background: "white" },
		})
			.png()
			.toBuffer();
		await assert.rejects(
			() =>
				f.media.upload(
					7,
					randomUUID(),
					"huge.png",
					huge.length,
					Readable.from([huge]),
					"article",
				),
			(e: unknown) =>
				e instanceof DraftError &&
				["MEDIA_PIXELS", "MEDIA_TYPE"].includes(e.code),
		);
		const text = Buffer.from("[00:12.00]歌词，🙂\n");
		await f.media.upload(
			7,
			randomUUID(),
			"lyrics.lrc",
			text.length,
			Readable.from([text]),
			"article",
		);
		const wav = Buffer.alloc(44 + 800);
		wav.write("RIFF");
		wav.writeUInt32LE(wav.length - 8, 4);
		wav.write("WAVEfmt ", 8);
		wav.writeUInt32LE(16, 16);
		wav.writeUInt16LE(1, 20);
		wav.writeUInt16LE(1, 22);
		wav.writeUInt32LE(8000, 24);
		wav.writeUInt32LE(16000, 28);
		wav.writeUInt16LE(2, 32);
		wav.writeUInt16LE(16, 34);
		wav.write("data", 36);
		wav.writeUInt32LE(800, 40);
		assert.equal(
			(
				await f.media.upload(
					7,
					randomUUID(),
					"tone.wav",
					wav.length,
					Readable.from([wav]),
					"article",
				)
			).kind,
			"audio",
		);
		const id = randomUUID();
		const media = await f.media.upload(
			7,
			id,
			"private.png",
			bytes.length,
			Readable.from([bytes]),
			"article",
		);
		await f.media.idle();
		let response = await fetch(`${f.config.origin}/api/library/${id}/preview`);
		assert.equal(response.status, 401);
		response = await fetch(`${f.config.origin}/api/login`, {
			method: "POST",
			headers: { origin: f.config.origin, "content-type": "application/json" },
			body: JSON.stringify({ identity: "preview", password: "preview" }),
		});
		const cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
		response = await fetch(`${f.config.origin}/api/library/${id}/trash`, {
			method: "POST",
			headers: { cookie, origin: "http://evil.invalid" },
		});
		assert.equal(response.status, 403);
		response = await fetch(`${f.config.origin}/api/library/${id}/original`, {
			headers: { cookie, range: "bytes=0-9" },
		});
		assert.equal(response.status, 206);
		assert.equal((await response.arrayBuffer()).byteLength, 10);
		assert.match(response.headers.get("cache-control") || "", /no-store/);
		assert.equal(response.headers.get("x-content-type-options"), "nosniff");
		assert.deepEqual(await readdir(f.mediaConfig.publicRoot), []);
		await assert.rejects(() => f.media.get(7, "../outside"), hasCode("INPUT"));
		assert.throws(
			() =>
				new MediaService(
					{
						...f.mediaConfig,
						publicRoot: join(f.mediaConfig.privateRoot, "public"),
					},
					f.objects,
					"",
					f.adapter,
				),
		);
		const source = `${publication}![保留](${mediaMarker(id)})\n\n\`![代码](${mediaMarker(id)})\`\n`;
		assert.equal(mediaPositions(source).length, 1);
		const draft = (
			await f.drafts.create(7, {
				requestId: randomUUID(),
				kind: "posts",
				path: "private-preview.md",
				source,
			})
		).draft;
		const diff = await f.jobs.diff(7, {
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
			base: diff.base,
			confirm: f.target.fingerprint,
			mediaConfirm: diff.mediaConfirm,
		};
		const task = await f.jobs.create(7, input);
		await f.jobs.idle();
		const finished = await f.jobs.get(7, task.id);
		assert.equal(finished.status, "succeeded", finished.error || "preview");
		assert.equal(
			(
				await readFile(
					join(
						f.jobs.directory(task.id),
						"artifact/__admin_media",
						media.original.key,
					),
				)
			).length,
			bytes.length,
		);
		assert.deepEqual(await readdir(f.mediaConfig.publicRoot), []);
		const privateDraft = (
			await f.drafts.create(7, {
				requestId: randomUUID(),
				kind: "posts",
				path: "draft-true.md",
				source: source.replace("draft: false", "draft: true"),
			})
		).draft;
		const privateDiff = await f.jobs.diff(7, {
			draftId: privateDraft.id,
			revision: 1,
			targetId: f.target.id,
		});
		await assert.rejects(
			() =>
				f.jobs.create(7, {
					...input,
					requestId: randomUUID(),
					draftId: privateDraft.id,
					kind: "publish",
					mediaConfirm: privateDiff.mediaConfirm,
				}),
			hasCode("MEDIA_PRIVATE_DRAFT"),
		);
	} finally {
		await new Promise<void>((r) => server.close(() => r()));
		await f.jobs.close();
		await f.media.close();
		await f.db.close();
	}
});
