import assert from "node:assert/strict";
import test from "node:test";
import { observe } from "./observe.mjs";

const commit = "a".repeat(40);
const tree = "b".repeat(64);
const version = () => ({
	schema: 1,
	sourceRevision: commit,
	deploymentEligible: true,
	buildProvenance: "github-actions",
	releaseId: `blog-${commit}`,
	publicTreeSha256: tree,
});
const release = () => ({
	tag_name: `blog-${commit}`,
	published_at: "2026-10-19T00:00:00Z",
	assets: [
		{ name: "blog-public.tar.gz", size: 1 },
		{ name: "blog-public.tar.gz.sha256", size: 1 },
	],
});

test("observation separates build and paired deployment from content acceptance", async () => {
	const result = await observe(commit, {
		readJson: async (url) =>
			url.includes("api.github.com") ? release() : version(),
	});
	assert.equal(result.build, "release-assets-present");
	assert.equal(result.deployment, "paired-version-observed");
	assert.equal(result.content, "not-checked");
});
test("same SHA with different tree, wrong provenance or unavailable site never proves paired deployment", async () => {
	for (const change of [
		{ publicTreeSha256: "c".repeat(64) },
		{ buildProvenance: "unverified" },
		{ sourceRevision: "d".repeat(40) },
	]) {
		const result = await observe(commit, {
			readJson: async (url) => {
				if (url.includes("api.github.com")) return release();
				return url.includes("blog-eo")
					? { ...version(), ...change }
					: version();
			},
		});
		assert.equal(result.deployment, "unverified");
	}
	const failed = await observe(commit, {
		readJson: async () => {
			throw new Error("offline");
		},
	});
	assert.equal(failed.build, "unverified");
	assert.equal(failed.deployment, "unverified");
	await assert.rejects(observe("HEAD"), /Full commit/u);
});
