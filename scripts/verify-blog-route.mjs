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

async function inspect(origin, pathname, homepageOrigin, limit) {
	const response = await fetch(new URL(pathname, origin), {
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
export async function verifyBlogRoutes() {
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

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	console.log(
		JSON.stringify(
			{ checkedAt: new Date().toISOString(), routes: await verifyBlogRoutes() },
			null,
			2,
		),
	);
}
