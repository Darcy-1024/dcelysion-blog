/** biome-ignore-all lint/style/noNonNullAssertion: Fixtures construct and validate these domain arrays explicitly. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { galleryConfig } from "../../src/config/galleryConfig.js";
import { playlistFromManifest } from "../../src/config/manifest-adapters.js";
import { musicPlayerConfig } from "../../src/config/musicConfig.js";
import { siteConfig } from "../../src/config/siteConfig.js";
import {
	getAlbumCover,
	getGalleryPreviewAsset,
	scanAlbumPhotos,
} from "../../src/utils/gallery-utils.js";
import { CandidateExecutor } from "../server/candidate.js";
import { configurationMedia } from "../server/configuration.js";
import { command } from "../server/executor.js";
import {
	type ConfigurationKind,
	configurationPaths,
	parseConfiguration,
	serializeConfiguration,
} from "../shared/configuration.js";
import { mediaMarker } from "../shared/media.js";
import { configurationFixture, fixtureWav } from "./configuration-fixture.js";

test("trusted migration preserves playlist, album scan/urls/preview and supported settings", async () => {
	const temp = await mkdtemp(join(tmpdir(), "dc-admin-config-baseline-"));
	for (const name of ["musicConfig", "galleryConfig"])
		await writeFile(
			join(temp, `${name}.ts`),
			await command(
				"git",
				["show", `HEAD:src/config/${name}.ts`],
				process.cwd(),
			),
		);
	const oldMusic = (
		await import(pathToFileURL(join(temp, "musicConfig.ts")).href)
	).musicPlayerConfig;
	const oldGallery = (
		await import(pathToFileURL(join(temp, "galleryConfig.ts")).href)
	).galleryConfig;
	assert.deepEqual(musicPlayerConfig, oldMusic);
	assert.deepEqual(
		galleryConfig.albums.map(({ photos: _photos, ...album }) => album),
		oldGallery.albums,
	);
	for (const album of galleryConfig.albums) {
		const oldPhotos = scanAlbumPhotos(album.id, oldGallery);
		assert.deepEqual(scanAlbumPhotos(album.id, galleryConfig), oldPhotos);
		assert.equal(
			getAlbumCover(album, oldPhotos, galleryConfig),
			getAlbumCover(album, oldPhotos, oldGallery),
		);
		for (const src of oldPhotos)
			assert.deepEqual(
				getGalleryPreviewAsset(src, galleryConfig),
				getGalleryPreviewAsset(src, oldGallery),
			);
		const explicitEmpty = {
			...galleryConfig,
			albums: [{ ...album, photos: [] }],
		};
		assert.deepEqual(scanAlbumPhotos(album.id, explicitEmpty), []);
	}
	const settings = JSON.parse(
		await readFile(configurationPaths.settings, "utf8"),
	);
	assert.equal(siteConfig.title, settings.title);
	assert.equal(
		siteConfig.description,
		"God’s in his heaven，All’s right with the world",
	);
	assert.deepEqual(siteConfig.keywords, settings.keywords);
	assert.equal(siteConfig.navbar.title, settings.navbarTitle);
});

test("configuration revisions, role validation, fixed candidates and historical references in one isolated environment", async () => {
	const f = await configurationFixture(4338);
	const api = createServer((req, res) => {
		void f.api(req, res, new URL(req.url || "/", f.config.origin));
	});
	await new Promise<void>((accept) => api.listen(4338, "127.0.0.1", accept));
	try {
		const png = await sharp({
			create: { width: 64, height: 40, channels: 3, background: "#659ad4" },
		})
			.png()
			.toBuffer();
		const image = await f.media.upload(
			7,
			randomUUID(),
			"fixture.png",
			png.length,
			Readable.from(png),
			"gallery",
		);
		const wav = fixtureWav();
		const audio = await f.media.upload(
			7,
			randomUUID(),
			"fixture.wav",
			wav.length,
			Readable.from(wav),
			"music",
		);
		await f.media.idle();
		const created = {} as Record<
			ConfigurationKind,
			Awaited<ReturnType<typeof f.drafts.create>>
		>;
		for (const kind of ["music", "gallery", "settings"] as const)
			created[kind] = await f.drafts.create(7, {
				requestId: randomUUID(),
				kind,
				path: `${kind}.json`,
				fromSource: true,
			});
		const music = parseConfiguration("music", created.music.draft.source);
		music.tracks![0].name = "改名，标点！🙂";
		music.tracks![0].url = mediaMarker(audio.id);
		const musicCover = await f.media.upload(
			7,
			randomUUID(),
			"music-cover.png",
			png.length,
			Readable.from(png),
			"music",
		);
		await f.media.idle();
		music.tracks![0].cover = mediaMarker(musicCover.id);
		music.tracks!.reverse();
		const input = {
			requestId: randomUUID(),
			revision: 1,
			source: serializeConfiguration(music),
		};
		created.music = await f.drafts.save(7, created.music.draft.id, input);
		assert.equal(
			(await f.drafts.save(7, created.music.draft.id, input)).draft.revision,
			2,
		);
		assert.deepEqual(
			parseConfiguration(
				"music",
				(await f.drafts.get(created.music.draft.id, 7)).source,
			).tracks?.map((t) => t.id),
			["fixture-track-2", "fixture-track-1"],
		);
		await assert.rejects(
			f.drafts.save(7, created.music.draft.id, {
				...input,
				requestId: randomUUID(),
				revision: 1,
			}),
			{ code: "REVISION_CONFLICT" },
		);
		const invalid = structuredClone(music);
		invalid.tracks![0].url = mediaMarker(image.id);
		await assert.rejects(
			f.drafts.save(7, created.music.draft.id, {
				requestId: randomUUID(),
				revision: 2,
				source: serializeConfiguration(invalid),
			}),
			{ code: "MEDIA_ROLE" },
		);
		assert.throws(
			() =>
				parseConfiguration(
					"music",
					JSON.stringify({ ...music, endpoint: "https://bad.invalid" }),
					created.music.draft.baseSource!,
				),
			/未支持字段/u,
		);
		invalid.tracks![0].url = "javascript:alert(1)";
		assert.throws(
			() => parseConfiguration("music", JSON.stringify(invalid)),
			/URL/u,
		);
		const gallery = parseConfiguration("gallery", created.gallery.draft.source);
		gallery.albums![0].photos!.push({
			id: "new-image",
			original: mediaMarker(image.id),
			preview: mediaMarker(image.id, "preview"),
		});
		gallery.albums![0].photos!.reverse();
		gallery.albums![0].cover = mediaMarker(image.id);
		created.gallery = await f.drafts.save(7, created.gallery.draft.id, {
			requestId: randomUUID(),
			revision: 1,
			source: serializeConfiguration(gallery).replaceAll(
				"/__managed-media/",
				"\\u002f__managed-media\\u002f",
			),
		});
		assert.equal(
			parseConfiguration("gallery", created.gallery.draft.source).albums![0]
				.photos![0].id,
			"new-image",
		);
		const refs = await f.media.references(7, image.id);
		assert.ok(refs.refs.some((r) => r.kind === "configuration_gallery"));
		const settings = parseConfiguration(
			"settings",
			created.settings.draft.source,
		);
		settings.title = "本地新标题";
		created.settings = await f.drafts.save(7, created.settings.draft.id, {
			requestId: randomUUID(),
			revision: 1,
			source: serializeConfiguration(settings),
		});
		assert.deepEqual(
			parseConfiguration("settings", created.settings.draft.source).unknown,
			{ preserved: true },
		);
		const copied = await f.drafts.create(7, {
			requestId: randomUUID(),
			copyFrom: created.music.draft.id,
			source: created.music.draft.source,
		});
		assert.deepEqual(
			copied.draft.baseDependencies,
			created.music.draft.baseDependencies,
		);
		const executor = new CandidateExecutor(
			f.root,
			f.target.remote,
			f.target.branch,
		);
		for (const kind of ["music", "gallery", "settings"] as const) {
			const draft = created[kind].draft;
			const diff = await f.jobs.diff(7, {
				draftId: draft.id,
				revision: draft.revision,
				targetId: f.target.id,
			});
			assert.equal(diff.path, configurationPaths[kind]);
			const job = await f.jobs.create(7, {
				requestId: randomUUID(),
				draftId: draft.id,
				revision: draft.revision,
				targetId: f.target.id,
				kind: "publish",
				base: diff.base,
				confirm: f.target.fingerprint,
				mediaConfirm: diff.mediaConfirm,
			});
			await f.jobs.idle();
			const done = await f.jobs.get(7, job.id);
			assert.equal(done.status, "succeeded", done.error || "job failed");
			const candidate = await executor.read(
				`${f.jobs.directory(job.id)}/git`,
				done.effects.commit!,
				configurationPaths[kind],
			);
			assert.ok(candidate);
			assert.ok(
				!candidate.includes("/__managed-media/") &&
					!candidate.includes("/api/library/"),
			);
			const data = parseConfiguration(kind, candidate);
			if (kind === "music")
				assert.equal(
					playlistFromManifest({ tracks: data.tracks! })![1].name,
					"改名，标点！🙂",
				);
			assert.deepEqual(
				(
					await command(
						"git",
						["diff", "--name-only", diff.base, done.effects.commit!],
						join(f.jobs.directory(job.id), "git"),
					)
				)
					.trim()
					.split("\n"),
				[
					"src/config/manifests/media-distribution.json",
					configurationPaths[kind],
				].sort(),
			);
			assert.equal(done.snapshot.source, draft.source);
		}
		gallery.albums![0].photos = [];
		delete gallery.albums![0].cover;
		await f.drafts.save(7, created.gallery.draft.id, {
			requestId: randomUUID(),
			revision: 2,
			source: serializeConfiguration(gallery),
		});
		const after = await f.media.references(7, image.id);
		assert.ok(after.refs.some((r) => r.kind === "job"));
		assert.ok(after.refs.some((r) => r.kind === "draft_revision"));
		assert.ok(
			!after.refs.some(
				(r) =>
					r.kind === "configuration_gallery" &&
					String(r.ref_id).startsWith(created.gallery.draft.id),
			),
		);
		await f.media.deleted(7, image.id, true);
		const newMusic = structuredClone(f.baseline.music);
		newMusic.tracks[0].cover = mediaMarker(image.id);
		await assert.rejects(
			configurationMedia(
				7,
				{
					kind: "music",
					source: JSON.stringify(newMusic),
					baseSource: JSON.stringify(f.baseline.music),
				},
				f.media,
			),
			{ code: "MEDIA_ROLE" },
		);
		await f.media.deleted(7, image.id, false);
		await f.adapter.query(
			"UPDATE dc_admin.media SET document=jsonb_set(document,'{privateCopy}','\"failed\"') WHERE id=$1",
			[audio.id],
		);
		const plan = await configurationMedia(7, created.music.draft, f.media);
		assert.ok(plan);
		await assert.rejects(f.media.ensure(7, plan, true), {
			code: "MEDIA_NOT_READY",
		});
		const noSession = await fetch(`${f.config.origin}/api/drafts`, {
			method: "POST",
			headers: { origin: f.config.origin, "content-type": "application/json" },
			body: JSON.stringify({
				requestId: randomUUID(),
				kind: "settings",
				path: "settings.json",
				fromSource: true,
			}),
		});
		assert.equal(noSession.status, 401);
		const origin = await fetch(`${f.config.origin}/api/drafts`, {
			method: "POST",
			headers: {
				origin: "https://wrong.invalid",
				"content-type": "application/json",
			},
			body: "{}",
		});
		assert.equal(origin.status, 403);
		await writeFile(
			join(f.root, "src/config/siteConfig.ts"),
			"// changed adapter",
		);
		await assert.rejects(
			f.drafts.save(7, created.settings.draft.id, {
				requestId: randomUUID(),
				revision: 2,
				source: created.settings.draft.source,
			}),
			{ code: "SOURCE_CONFLICT" },
		);
	} finally {
		await new Promise<void>((accept) => api.close(() => accept()));
		await f.jobs.close();
		await f.media.close();
		await f.db.close();
	}
});
