import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	fontCodepoints,
	splitCodepoints,
	subsetFace,
	unicodeRange,
} from "./font-subsets";

test("MiSans retains every mapped character once, including future user text", async () => {
	const bytes = await readFile(
		new URL("../public/assets/fonts/MiSansVF.ttf", import.meta.url),
	);
	const points = fontCodepoints(bytes);
	assert.ok(points.length > 20000);
	const groups = splitCodepoints(points, "布克东方未晞");
	assert.deepEqual(
		groups.flat().sort((a, b) => a - b),
		points,
	);
	assert.equal(new Set(groups.flat()).size, points.length);
	for (const char of "莱龘") {
		const cp = char.codePointAt(0);
		assert.ok(cp !== undefined);
		assert.ok(!groups[0].includes(cp));
		assert.equal(
			groups.slice(1).filter((group) => group.includes(cp)).length,
			1,
		);
	}
	assert.ok(groups.slice(1).every((group) => group.length <= 256));
});

test("font faces preserve Astro family, weight and metrics while restricting glyphs", () => {
	const face =
		'@font-face{font-family:"AstroHash";src:url("/original.ttf") format("truetype");font-weight:150 700;font-style:normal;font-display:swap;size-adjust:98%;unicode-range:U+0-FFFF}';
	const rewritten = subsetFace(face, "/shard.woff2", [32, 33, 0x83b1]);
	assert.ok(rewritten.includes('src:url("/shard.woff2") format("woff2")'));
	for (const descriptor of [
		'font-family:"AstroHash"',
		"font-weight:150 700",
		"font-style:normal",
		"font-display:swap",
		"size-adjust:98%",
	]) {
		assert.ok(rewritten.includes(descriptor));
	}
	assert.ok(rewritten.includes("unicode-range:U+20-21,U+83b1"));
	assert.equal((rewritten.match(/unicode-range/g) ?? []).length, 1);
	assert.ok(!rewritten.includes("original.ttf"));
	assert.equal(unicodeRange([65, 67, 68, 0x20000]), "U+41,U+43-44,U+20000");
});
