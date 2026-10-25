import assert from "node:assert/strict";
import { test } from "node:test";
import {
	dynamicDetailPath,
	dynamicPermalink,
	findDynamicTarget,
} from "../src/utils/dynamic-share";

test("sharing removes transient state and round-trips exact Unicode IDs", () => {
	const id = "memos/中文 & ?#%";
	const url = new URL(
		dynamicPermalink(
			"https://example.com/base/dynamic/?page=4&search=x&year=2025#old",
			id,
		),
	);
	assert.equal(url.pathname, "/base/dynamic/");
	assert.deepEqual([...url.searchParams], [["entry", id]]);
	assert.equal(url.hash, "");
	assert.equal(findDynamicTarget([{ id: "other" }, { id }], url), 1);
});

test("exact IDs distinguish entries whose legacy anchors collide", () => {
	const entries = [{ id: "中文" }, { id: "动态" }];
	assert.equal(
		findDynamicTarget(
			entries,
			new URL(dynamicPermalink("https://example.com/dynamic/", "动态")),
		),
		1,
	);
});

test("legacy anchors still resolve across pages", () => {
	const entries = Array.from({ length: 25 }, (_, index) => ({
		id: `entry-${index}`,
	}));
	const target = findDynamicTarget(
		entries,
		new URL("https://example.com/dynamic/#dynamic-entry-23"),
	);
	assert.equal(target, 23);
	assert.equal(Math.floor((target as number) / 10) + 1, 3);
});

test("missing IDs and malformed anchors fail explicitly", () => {
	assert.equal(
		findDynamicTarget(
			[],
			new URL("https://example.com/dynamic/?entry=removed"),
		),
		-1,
	);
	assert.equal(
		findDynamicTarget([], new URL("https://example.com/dynamic/#dynamic-%ZZ")),
		-1,
	);
	assert.equal(
		findDynamicTarget([], new URL("https://example.com/dynamic/?page=2")),
		null,
	);
});

test("generated detail URLs take priority while remote feeds retain lookup links", () => {
	const path = dynamicDetailPath("folder/中文 & #");
	assert.equal(path, "/dynamic/folder/%E4%B8%AD%E6%96%87%20%26%20%23/");
	assert.equal(
		dynamicPermalink("https://example.com/dynamic/?page=3", "id", path),
		`https://example.com${path}`,
	);
	assert.equal(
		new URL(
			dynamicPermalink("https://example.com/dynamic/", "remote"),
		).searchParams.get("entry"),
		"remote",
	);
	assert.equal(
		new URL(
			dynamicPermalink(
				"https://example.com/dynamic/",
				"remote",
				"//other.example/path",
			),
		).origin,
		"https://example.com",
	);
});
