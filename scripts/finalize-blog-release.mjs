import { execFileSync } from "node:child_process";
import { cp, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { packagePublicBlog } from "./package-public-blog.mjs";

// Called only after the complete build succeeds. Local builds remain unchanged.
const platform =
	process.argv[2] ??
	(process.env.WORKERS_CI === "1"
		? "cloudflare"
		: process.env.GITHUB_ACTIONS === "true"
			? "github"
			: null);
if (!platform) {
	console.log("Cloud release packaging skipped for local build.");
} else {
	const provenance = {
		cloudflare: "cloudflare-build",
		edgeone: "edgeone-build",
		github: "github-actions",
	}[platform];
	if (!provenance) throw new Error("UNKNOWN_BUILD_PLATFORM");
	const revision = execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();
	const declaredRevision =
		process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA;
	if (declaredRevision && declaredRevision !== revision)
		throw new Error("BUILD_REVISION_MISMATCH");
	const releaseId = `blog-${revision}`;
	const cache = path.resolve("cache");
	await mkdir(cache, { recursive: true });
	const output = path.join(cache, `public-${revision}`);
	const manifest = await packagePublicBlog({
		input: "dist",
		output,
		releaseId,
		sourceRevision: revision,
		buildProvenance: provenance,
	});
	// Preserve the original build. dist now contains only reviewed public files.
	await rename("dist", path.join(cache, `raw-${revision}`));
	await cp(path.join(output, "cloudflare", "assets"), "dist", {
		recursive: true,
	});
	console.log(
		JSON.stringify({
			releaseId,
			sourceRevision: revision,
			publicTreeSha256: manifest.publicTreeSha256,
			files: manifest.files.length,
		}),
	);
}
