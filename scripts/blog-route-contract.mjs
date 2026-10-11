import { createHash } from "node:crypto";

export const origins = Object.freeze({
	cloudflare: "https://blog.dcelysion.cn",
	edgeone: "https://blog-eo.dcelysion.cn",
});
export const probePath = "/__route/probe-v1.bin";
export const versionPath = "/__route/version.json";
export const probeBytes = 32 * 1024;
export const sha256 = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");

// Public, deterministic high-entropy sample. Never use private media as a probe.
export function makeProbe() {
	const blocks = [];
	for (let counter = 0; counter < probeBytes / 32; counter++) {
		blocks.push(
			createHash("sha256")
				.update(`dcelysion.blog-route.probe-v1:${counter}`)
				.digest(),
		);
	}
	return Buffer.concat(blocks);
}

export function routeHeaders() {
	return [
		{
			path: probePath,
			headers: {
				"Content-Type": "application/octet-stream",
				"Cache-Control": "no-store, no-transform",
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Expose-Headers":
					"Content-Length, Content-Encoding, ETag",
				"X-Content-Type-Options": "nosniff",
			},
		},
		{
			path: versionPath,
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store, no-transform",
				"Access-Control-Allow-Origin": "*",
				"X-Content-Type-Options": "nosniff",
			},
		},
	];
}

export function cloudflareHeaders() {
	return `${routeHeaders()
		.map(
			({ path, headers }) =>
				`${path}\n${Object.entries(headers)
					.map(([key, value]) => `  ${key}: ${value}`)
					.join("\n")}`,
		)
		.join("\n\n")}\n`;
}

export function edgeoneConfig() {
	return {
		outputDirectory: "./assets",
		headers: routeHeaders().map(({ path, headers }) => ({
			source: path,
			headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
		})),
	};
}
