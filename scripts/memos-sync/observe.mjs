import path from "node:path";
import { fileURLToPath } from "node:url";
import { origins, versionPath } from "../blog-route-contract.mjs";

async function json(url) {
	const response = await fetch(url, {
		redirect: "error",
		signal: AbortSignal.timeout(15000),
		cache: "no-store",
	});
	if (!response.ok) throw new Error("Evidence unavailable");
	let bytes = 0;
	const parts = [];
	for await (const part of response.body) {
		bytes += part.length;
		if (bytes > 256 * 1024) throw new Error("Evidence too large");
		parts.push(part);
	}
	return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

export async function observe(commit, { readJson = json } = {}) {
	if (!/^[a-f0-9]{40}$/u.test(commit))
		throw new Error("Full commit SHA required");
	const releaseUrl = `https://api.github.com/repos/Darcy-1024/dcelysion-blog/releases/tags/blog-${commit}`;
	let build = "unverified";
	try {
		const release = await readJson(releaseUrl);
		if (
			release.tag_name === `blog-${commit}` &&
			!release.draft &&
			release.published_at &&
			["blog-public.tar.gz", "blog-public.tar.gz.sha256"].every((name) =>
				release.assets?.some((asset) => asset.name === name && asset.size > 0),
			)
		)
			build = "release-assets-present";
	} catch {
		/* A missing release is not a successful build. */
	}
	const sites = await Promise.all(
		Object.entries(origins).map(async ([platform, origin]) => {
			try {
				const version = await readJson(
					`${origin}${versionPath}?memos_receipt=${commit}-${Date.now()}`,
				);
				const matches =
					version.schema === 1 &&
					version.sourceRevision === commit &&
					version.deploymentEligible === true &&
					version.buildProvenance === "github-actions" &&
					version.releaseId === `blog-${commit}` &&
					/^[a-f0-9]{64}$/u.test(version.publicTreeSha256);
				return {
					platform,
					status: matches ? "version-matches" : "different-version",
					publicTreeSha256: matches ? version.publicTreeSha256 : null,
				};
			} catch {
				return { platform, status: "unavailable", publicTreeSha256: null };
			}
		}),
	);
	const paired =
		sites.every((site) => site.status === "version-matches") &&
		sites[0].publicTreeSha256 === sites[1].publicTreeSha256;
	return {
		commit,
		build,
		sites,
		deployment: paired ? "paired-version-observed" : "unverified",
		content: "not-checked",
		comments: "not-checked",
		media: "not-checked",
		observedAt: new Date().toISOString(),
	};
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const args = process.argv.slice(2);
	if (args.length !== 2 || args[0] !== "--commit") {
		console.error(
			"node scripts/memos-sync/observe.mjs --commit <full-SHA> (read-only, no PAT)",
		);
		process.exitCode = 1;
	} else
		observe(args[1])
			.then((receipt) => console.log(JSON.stringify(receipt, null, 2)))
			.catch(() => {
				process.exitCode = 1;
			});
}
