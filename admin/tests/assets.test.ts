import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fontCodepoints, splitCodepoints, unicodeRange } from "../build/assets.js";

test("MiSans partitions retain all source characters, including future user text", async () => {
	const font = await readFile(new URL("../../public/assets/fonts/MiSansVF.ttf", import.meta.url));
	const points = fontCodepoints(font);
	assert.ok(points.length > 20000);
	for (const character of "MiSans后台评论龘") assert.ok(points.includes(character.codePointAt(0)!));
	const groups = splitCodepoints(points, "后台评论");
	assert.deepEqual(groups.flat().sort((a, b) => a - b), points);
	assert.equal(new Set(groups.flat()).size, points.length);
	assert.ok(groups[0].includes("评".codePointAt(0)!));
	assert.ok(!groups[0].includes("龘".codePointAt(0)!));
	assert.ok(groups.slice(1).some((group) => group.includes("龘".codePointAt(0)!)));
	assert.ok(groups.slice(1).every((group) => group.length <= 256));
});

test("CSS Unicode ranges preserve gaps and supplementary characters", () => {
	assert.equal(unicodeRange([32, 33, 34, 65, 67, 68, 0x20000]), "U+20-22,U+41,U+43-44,U+20000");
});
