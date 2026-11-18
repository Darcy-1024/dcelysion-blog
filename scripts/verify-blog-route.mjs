import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	makeProbe,
	origins,
	probeBytes,
	probePath,
	sha256,
	versionPath,
} from "./blog-route-contract.mjs";

async function boundedBody(response, limit) {
	const chunks = [];
	let bytes = 0;
	const reader = response.body?.getReader();
	if (!reader) throw new Error("EMPTY_BODY");
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			bytes += next.value.length;
			if (bytes > limit) throw new Error("BODY_LIMIT");
			chunks.push(Buffer.from(next.value));
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	return Buffer.concat(chunks);
}

async function inspect(origin, pathname, homepageOrigin, limit, fetchImpl) {
	const response = await fetchImpl(new URL(pathname, origin), {
		method: "GET",
		headers: { Origin: homepageOrigin },
		credentials: "omit",
		redirect: "error",
		cache: "no-store",
		signal: AbortSignal.timeout(10_000),
	});
	const headers = Object.fromEntries(
		[
			"content-type",
			"content-length",
			"content-encoding",
			"cache-control",
			"access-control-allow-origin",
			"access-control-expose-headers",
			"etag",
			"x-content-type-options",
		].map((name) => [name, response.headers.get(name)]),
	);
	if (response.status !== 200) {
		await response.body?.cancel();
		return { status: response.status, headers, valid: false, reason: "STATUS" };
	}
	const body = await boundedBody(response, limit);
	const cors = headers["access-control-allow-origin"];
	const corsValid = cors === "*" || cors === homepageOrigin;
	if (pathname === probePath) {
		return {
			status: response.status,
			headers,
			bytes: body.length,
			sha256: sha256(body),
			valid:
				corsValid &&
				body.length === probeBytes &&
				sha256(body) === sha256(makeProbe()) &&
				headers["content-type"]?.split(";")[0].trim() ===
					"application/octet-stream" &&
				(!headers["content-encoding"] ||
					headers["content-encoding"] === "identity") &&
				headers["cache-control"]?.includes("no-store") &&
				headers["cache-control"]?.includes("no-transform") &&
				headers["x-content-type-options"] === "nosniff",
		};
	}
	const version = JSON.parse(body.toString("utf8"));
	return {
		status: response.status,
		headers,
		version,
		valid:
			corsValid &&
			headers["content-type"]?.startsWith("application/json") &&
			version.schema === 1 &&
			typeof version.releaseId === "string" &&
			/^[a-f0-9]{64}$/.test(version.publicTreeSha256 ?? "") &&
			version.probe?.sha256 === sha256(makeProbe()),
	};
}

// Node confirms headers and bytes, not the browser's enforcement of CORS/CSP.
export async function verifyBlogRoutes({ fetchImpl = fetch } = {}) {
	return Promise.all(
		Object.entries(origins).map(async ([source, origin]) => ({
			source,
			origin,
			checks: await Promise.all(
				["https://dcelysion.cn", "https://home.dcelysion.cn"].map(
					async (homepageOrigin) => ({
						homepageOrigin,
						results: await Promise.all(
							[probePath, versionPath].map(async (pathname) => {
								try {
									return {
										pathname,
										...(await inspect(
											origin,
											pathname,
											homepageOrigin,
											pathname === probePath ? probeBytes : 8192,
											fetchImpl,
										)),
									};
								} catch (error) {
									return {
										pathname,
										valid: false,
										error: error.cause?.code ?? error.code ?? error.message,
									};
								}
							}),
						),
					}),
				),
			),
		})),
	);
}

// Shared production releases are attested by the GitHub Actions packager.
// This proves observed public metadata/probes, not page behavior or backend health.
export async function verifyBlogRelease(expectedRevision, options = {}) {
	if (
		typeof expectedRevision !== "string" ||
		!/^[a-fA-F0-9]{40}$/.test(expectedRevision)
	) {
		throw new Error("Full expected commit SHA required");
	}
	const revision = expectedRevision.toLowerCase();
	const routes = await verifyBlogRoutes(options);
	const errors = [];
	const trees = new Set();
	for (const route of routes) {
		for (const check of route.checks) {
			for (const result of check.results) {
				const context = `${route.source} ${check.homepageOrigin} ${result.pathname}`;
				if (!result.valid) errors.push(`${context}: invalid or unavailable`);
				if (result.pathname !== versionPath) continue;
				const version = result.version;
				if (
					version?.sourceRevision !== revision ||
					version?.releaseId !== `blog-${revision}` ||
					version?.deploymentEligible !== true ||
					version?.buildProvenance !== "github-actions" ||
					version?.probe?.path !== probePath ||
					version?.probe?.bytes !== probeBytes
				) {
					errors.push(`${context}: expected release contract mismatch`);
				}
				if (
					!result.headers?.["cache-control"]?.includes("no-store") ||
					!result.headers?.["cache-control"]?.includes("no-transform") ||
					result.headers?.["x-content-type-options"] !== "nosniff"
				) {
					errors.push(`${context}: version header contract mismatch`);
				}
				trees.add(version?.publicTreeSha256);
			}
		}
	}
	if (trees.size !== 1)
		errors.push("Public tree digests differ across observations");
	return {
		expectedRevision: revision,
		passed: errors.length === 0,
		errors,
		routes,
	};
}

export async function runCli(
	args,
	{ stdout = console.log, stderr = console.error, ...options } = {},
) {
	if (
		args.length !== 0 &&
		(args.length !== 2 ||
			args[0] !== "--expected-sha" ||
			!/^[a-fA-F0-9]{40}$/.test(args[1]))
	) {
		stderr(
			"Usage: node scripts/verify-blog-route.mjs [--expected-sha <full-SHA>]",
		);
		return 2;
	}
	try {
		const result = args.length
			? await verifyBlogRelease(args[1], options)
			: { routes: await verifyBlogRoutes(options) };
		stdout(
			JSON.stringify(
				{ checkedAt: new Date().toISOString(), ...result },
				null,
				2,
			),
		);
		return result.passed === false ? 1 : 0;
	} catch (error) {
		stderr(error.message);
		return 1;
	}
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	process.exitCode = await runCli(process.argv.slice(2));
}
