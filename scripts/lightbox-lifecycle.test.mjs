import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createLightboxSvgCache, isSvgSrc } from "../src/utils/lightbox-svg.ts";

// Exercise the actual plugin with only the media routing adapter replaced.
const compiled = await build({
	entryPoints: ["src/utils/media-lightbox.ts"],
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
	plugins: [
		{
			name: "media-adapter",
			setup(builder) {
				builder.onResolve({ filter: /^\.\/media-client$/ }, () => ({
					path: "adapter",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents: `
export function assignMedia(element, src, srcset) { element.src = src; element.srcset = srcset; }
export function backupMedia() { return false; }
`,
				}));
			},
		},
	],
});
const { mediaLazyload } = await import(
	`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function fixture(resolveImage) {
	const handlers = new Map();
	const carousel = {
		on: (event, handler) => handlers.set(event, handler),
		off: (event) => handlers.delete(event),
		showLoading() {},
		hideLoading() {},
	};
	const plugin = mediaLazyload(resolveImage);
	plugin.init(carousel);
	const attach = (src) => {
		const image = { dataset: { lazySrc: src }, addEventListener() {} };
		const clone = {};
		const slide = {
			el: {
				contains: (element) => element === image,
				querySelectorAll: (selector) =>
					selector.includes("is-clone") ? [clone] : [image],
			},
		};
		handlers.get("attachSlideEl")(carousel, slide);
		return { image, clone, slide };
	};
	return { plugin, attach, handlers };
}

test("ordinary images load synchronously while an SVG resolver is pending", async () => {
	const request = deferred();
	const context = fixture((src) =>
		src.endsWith(".svg") ? request.promise : undefined,
	);
	const svg = context.attach("slow.svg");
	const jpg = context.attach("photo.jpg");
	assert.equal(jpg.image.src, "photo.jpg");
	assert.equal(svg.image.src, undefined);
	assert.equal(svg.image.dataset.lazySrc, undefined);
	request.resolve("blob:fixed");
	await request.promise;
	assert.equal(svg.image.src, "blob:fixed");
	assert.equal(svg.clone.src, "blob:fixed");
});

test("SVG failure falls back to the original URL on both Panzoom images", async () => {
	const request = deferred();
	const { attach } = fixture(() => request.promise);
	const { image, clone } = attach("failure.svg");
	request.reject(new Error("CORS failure"));
	await request.promise.catch(() => {});
	assert.equal(image.src, "failure.svg");
	assert.equal(clone.src, "failure.svg");
});

test("close/navigation destroys the handler and ignores late image results", async () => {
	const request = deferred();
	const { attach, plugin, handlers } = fixture(() => request.promise);
	const { image, clone } = attach("late.svg");
	plugin.destroy();
	request.resolve("blob:late");
	await request.promise;
	assert.equal(handlers.size, 0);
	assert.equal(image.src, undefined);
	assert.equal(clone.src, undefined);
});

test("cache is demand-driven, deduplicates requests, and invalidates late responses", async () => {
	const request = deferred();
	let calls = 0;
	let reads = 0;
	const cache = createLightboxSvgCache(() => {
		calls++;
		return request.promise;
	});
	assert.equal(calls, 0);
	const first = cache.get("slow.svg", 1600, 900);
	assert.equal(cache.get("slow.svg", 1600, 900), first);
	assert.equal(calls, 1);
	cache.clear();
	request.resolve({
		ok: true,
		text: () => {
			reads++;
			return "";
		},
	});
	assert.equal(await first, null);
	assert.equal(reads, 0);
});

test("cache invalidation also covers a response body still being read", async () => {
	const body = deferred();
	const cache = createLightboxSvgCache(async () => ({
		ok: true,
		text: () => body.promise,
	}));
	const result = cache.get("slow-body.svg", 1600, 900);
	await Promise.resolve();
	cache.clear();
	body.resolve("<svg/>");
	assert.equal(await result, null);
});

test("dimension repair uses viewBox and cached blobs are revoked on close", async () => {
	// Parser/serializer are browser APIs; use an XML element seam here and cover
	// actual parsing plus Panzoom rendering in the local browser fixture.
	const previousParser = globalThis.DOMParser;
	const previousSerializer = globalThis.XMLSerializer;
	const attributes = new Map([["viewBox", "0 0 640 480"]]);
	const svg = {
		localName: "svg",
		namespaceURI: "http://www.w3.org/2000/svg",
		getAttribute: (key) => attributes.get(key) || null,
		setAttribute: (key, value) => attributes.set(key, value),
	};
	globalThis.DOMParser = class {
		parseFromString() {
			return { documentElement: svg, querySelector: () => null };
		}
	};
	globalThis.XMLSerializer = class {
		serializeToString() {
			return JSON.stringify(Object.fromEntries(attributes));
		}
	};
	const cache = createLightboxSvgCache(async () => new Response("svg fixture"));
	try {
		const url = await cache.get("sized.svg", 1600, 900);
		assert.ok(url?.startsWith("blob:"));
		assert.equal(attributes.get("width"), "640");
		assert.equal(attributes.get("height"), "480");
		assert.equal(await cache.get("sized.svg", 1, 1), url);
		assert.equal(
			(await fetch(url)).headers.get("content-type"),
			"image/svg+xml",
		);
		cache.clear();
		await assert.rejects(fetch(url));
	} finally {
		cache.clear();
		if (previousParser === undefined) delete globalThis.DOMParser;
		else globalThis.DOMParser = previousParser;
		if (previousSerializer === undefined) delete globalThis.XMLSerializer;
		else globalThis.XMLSerializer = previousSerializer;
	}
});

test("SVG detection handles relative URLs, extensions and format queries", () => {
	const base = "https://example.test/post/";
	assert.ok(isSvgSrc("../image.SVG?version=1", base));
	assert.ok(isSvgSrc("/image?f=SVG", base));
	assert.equal(isSvgSrc("/photo.jpg", base), false);
	assert.equal(isSvgSrc("", base), false);
});
