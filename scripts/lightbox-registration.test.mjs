import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

test("manager supplies SVG plugin in initial carousel options for every instance", async () => {
	const source = await fs.readFile(
		"src/components/features/FancyboxManager.astro",
		"utf8",
	);
	const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
	const { code } = await transform(script.replace(/^\s*import .*;\s*$/gm, ""), {
		loader: "ts",
		format: "esm",
	});
	let requests = 0;
	let cleared = 0;
	const attached = [];
	const document = {
		querySelector: () => null,
		addEventListener() {},
	};
	const options = new Function(
		"document",
		"zh_CN",
		"mediaCarousel",
		"mediaLazyload",
		"createLightboxSvgCache",
		"fetchMedia",
		"isSvgSrc",
		"location",
		"HTMLImageElement",
		`${code}\nreturn getCommonOptions();`,
	)(
		document,
		{},
		() => ({ Lazyload: false }),
		(resolve) => ({
			init: (carousel) => attached.push({ carousel, resolve }),
			destroy() {},
		}),
		() => ({
			get: async () => {
				requests++;
				return "blob:svg";
			},
			clear: () => cleared++,
		}),
		() => {},
		(src) => src.endsWith(".svg"),
		{ href: "http://localhost/" },
		class {},
	);
	assert.equal(requests, 0);
	// Fancybox passes these options into Carousel, which rebuilds its options
	// during init. The resolver must therefore be present here, not patched later.
	const first = options.Carousel.plugins.MediaLazyload();
	const second = options.Carousel.plugins.MediaLazyload();
	const carouselA = {};
	first.init(carouselA);
	second.init({});
	assert.equal(attached.length, 2);
	assert.equal(attached[0].resolve("photo.png", {}, {}), undefined);
	assert.equal(await attached[0].resolve("test.svg", {}, {}), "blob:svg");
	assert.equal(requests, 1);
	options.on.close({ getCarousel: () => carouselA });
	assert.equal(cleared, 1);
	second.destroy();
	assert.equal(cleared, 2);
});
