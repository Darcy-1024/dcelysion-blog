import assert from "node:assert/strict";
import test from "node:test";
import {
	defaultMediaPolicy,
	type MediaDistribution,
	parsePublicMediaManifest,
} from "../../src/utils/media-contract.js";
import { MediaRouter } from "../../src/utils/media-routing.js";

const revision = "a".repeat(40);
function manifest(): MediaDistribution {
	const r2 = "https://gallery.dcelysion.cn/example/image.avif";
	return {
		version: 1,
		snapshot: "test",
		entries: [
			{
				id: "image",
				variant: "original",
				key: "example/image.avif",
				sha256: "b".repeat(64),
				size: 42,
				mime: "image/avif",
				defaultUrl: r2,
				sources: {
					r2,
					tencent:
						"https://media-tx.dcelysion.cn/media/objects/verified/image.avif",
				},
				aliases: [{ url: "/_astro/image.avif", revision }],
			},
		],
	};
}
test("remote public manifest rejects private fields, unapproved hosts and ambiguous aliases", () => {
	assert.equal(parsePublicMediaManifest(manifest()).entries.length, 1);
	for (const change of [
		(e: Record<string, unknown>) => {
			e.localKey = "/private/original";
		},
		(e: Record<string, unknown>) => {
			e.size = Number.MAX_SAFE_INTEGER + 1;
		},
		(e: Record<string, unknown>) => {
			e.sources = {
				r2: "https://evil.invalid/x",
				tencent: "https://media-tx.dcelysion.cn/media/objects/x",
			};
		},
		(e: Record<string, unknown>) => {
			e.aliases = [{ url: "//evil.invalid/x", revision }];
		},
	]) {
		const value = manifest();
		change(value.entries[0] as unknown as Record<string, unknown>);
		assert.throws(() => parsePublicMediaManifest(value));
	}
	const ambiguous = manifest();
	ambiguous.entries.push({ ...ambiguous.entries[0], sha256: "c".repeat(64) });
	assert.throws(() => parsePublicMediaManifest(ambiguous));
	const endpoints = {
		...manifest(),
		capacityUrl: "https://evil.invalid",
		probe: { id: "bad", variant: "original" },
	};
	assert.equal(parsePublicMediaManifest(endpoints).capacityUrl, undefined);
	assert.equal(parsePublicMediaManifest(endpoints).probe, undefined);
});
test("version-bound local aliases fall back once to R2 and updates preserve existing attempts", () => {
	const value = manifest();
	const router = new MediaRouter(
		value,
		{ ...defaultMediaPolicy, enabled: true },
		undefined,
		fetch,
		revision,
	);
	const started = router.startedAttempt("/_astro/image.avif");
	assert.equal(started.backup(), value.entries[0].sources.r2);
	assert.equal(started.backup(), undefined);
	const oldAttempt = router.attempt(value.entries[0].defaultUrl);
	const originalEntry = oldAttempt.entry;
	router.updateEntries([]);
	assert.equal(router.entry(value.entries[0]?.defaultUrl || ""), undefined);
	assert.equal(oldAttempt.entry, originalEntry);
	const other = new MediaRouter(
		manifest(),
		{ ...defaultMediaPolicy, enabled: true },
		undefined,
		fetch,
		"d".repeat(40),
	);
	assert.equal(other.entry("/_astro/image.avif"), undefined);
});
