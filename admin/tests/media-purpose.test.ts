import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import sharp from "sharp";
import { DraftError } from "../server/drafts.js";
import { MediaService } from "../server/media.js";
import { mediaMarker } from "../shared/media.js";
import { mediaFixture } from "./media-fixture.js";

test("用途路由：私有暂存、派生预览、固定目标及旧记录兼容", async () => {
	const f = await mediaFixture();
	try {
		assert.throws(
			() =>
				new MediaService(
					{
						...f.mediaConfig,
						destinations: {
							gallery: {
								...f.mediaConfig.destinations?.gallery,
								purpose: "gallery",
								version: 1,
								bucket: "test-gallery",
								prefix: "library",
								publicBase: "https://gallery.example.invalid/library",
								tencentRoot: join(f.privateRoot, "outside-public"),
							},
						},
					},
					f.objects,
					"",
					f.adapter,
				),
			/inside publicRoot/,
		);
		await f.db.exec(
			await readFile(
				new URL("../server/migrations/007_media_purpose.sql", import.meta.url),
				"utf8",
			),
		);
		const bytes = await sharp({
			create: { width: 4, height: 4, channels: 3, background: "red" },
		})
			.png()
			.toBuffer();
		await assert.rejects(
			() =>
				f.media.upload(
					7,
					randomUUID(),
					"missing.png",
					bytes.length,
					Readable.from([bytes]),
				),
			(e: unknown) => e instanceof DraftError && e.code === "MEDIA_PURPOSE",
		);
		const media = [];
		for (const purpose of ["gallery", "wallpaper"] as const) {
			const record = await f.media.upload(
				7,
				randomUUID(),
				`${purpose}.png`,
				bytes.length,
				Readable.from([bytes]),
				purpose,
			);
			media.push(record);
			await f.media.idle();
			assert.equal((await f.media.get(7, record.id)).privateCopy, "ready");
			assert.equal(record.publicCopy, "absent");
			assert.ok(record.preview);
		}
		assert.deepEqual(await readdir(f.mediaConfig.publicRoot), []);
		await assert.rejects(() => readdir(join(f.objects.root, "public")), {
			code: "ENOENT",
		});
		const plan = await f.media.plan(
			7,
			media
				.map(
					(record) =>
						`![a](${mediaMarker(record.id)})\n![b](${mediaMarker(record.id, "preview")})`,
				)
				.join("\n"),
		);
		assert.equal(plan.dependencies.length, 4);
		for (const record of media) {
			const deps = plan.dependencies.filter((d) => d.id === record.id);
			assert.ok(deps.every((d) => d.destination?.purpose === record.purpose));
			assert.ok(
				deps.every((d) => d.destination?.bucket === `test-${record.purpose}`),
			);
		}
		const gallery = f.mediaConfig.destinations?.gallery;
		assert.ok(gallery);
		gallery.bucket = "changed-gallery";
		// PostgreSQL jsonb reorders keys; identity must not depend on insertion order.
		for (const dependency of plan.dependencies)
			if (dependency.destination)
				dependency.destination = Object.fromEntries(
					Object.entries(dependency.destination).reverse(),
				) as typeof dependency.destination;
		await f.media.ensure(7, plan, true);
		for (const record of media) {
			assert.equal((await f.media.get(7, record.id)).publicCopy, "ready");
			assert.deepEqual(
				await readFile(
					join(
						f.objects.root,
						"public",
						`test-${record.purpose}`,
						record.original.key,
					),
				),
				bytes,
			);
		}
		const legacy = media[0];
		await f.db.query(
			"UPDATE dc_admin.media SET document=document-'purpose'-'version'-'destination' WHERE id=$1",
			[legacy.id],
		);
		const old = await f.media.plan(7, `![a](${mediaMarker(legacy.id)})`);
		assert.equal(old.dependencies[0].destination, undefined);
		assert.equal(
			old.dependencies[0].url,
			`${f.mediaConfig.publicBase}/${legacy.original.key}`,
		);
		await f.media.ensure(7, old, false);
		await assert.rejects(
			() =>
				f.media.upload(
					7,
					legacy.id,
					legacy.name,
					bytes.length,
					Readable.from([bytes]),
					"music",
				),
			(e: unknown) => e instanceof DraftError && e.code === "REQUEST_REUSE",
		);
	} finally {
		await f.media.close();
		await f.jobs.close();
		await f.db.close();
	}
});
