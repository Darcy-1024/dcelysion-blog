import assert from "node:assert/strict";
import { test } from "node:test";
import {
	fixedCommentSourceNames,
	normalizeCommentSource,
} from "../server/comment-source.js";

const origin = "https://blog.example.invalid";

test("source lookup keys normalize slash, same-origin URLs and query/hash while preserving old dynamic anchor keys", () => {
	for (const input of [
		"/posts/welcome",
		"/posts/welcome/",
		"/posts/welcome///?a=b#post-comments",
		`${origin}/posts/welcome?ignored=1#post-comments`,
	])
		assert.equal(normalizeCommentSource(input, origin), "/posts/welcome/");
	assert.equal(
		normalizeCommentSource("/dynamic/#dynamic-2026-10-28", origin),
		"/dynamic/#dynamic-2026-10-28",
	);
	assert.equal(
		normalizeCommentSource("/dynamic?x=1#dynamic-abc_1", origin),
		"/dynamic/#dynamic-abc_1",
	);
	assert.equal(
		normalizeCommentSource("/posts/入站必看/", origin),
		"/posts/%E5%85%A5%E7%AB%99%E5%BF%85%E7%9C%8B/",
	);
	assert.equal(normalizeCommentSource("/", origin), "/");
});

test("unsafe and malformed source lookup keys are rejected", () => {
	for (const path of [
		"https://evil.invalid/posts/a",
		"https://user:pass@blog.example.invalid/posts/a",
		"//evil.invalid/posts/a",
		"/posts/../api",
		"/posts/%2e%2e/api",
		"/posts/a%2fb",
		"/posts/a%5cb",
		"/posts/%252e%252e",
		"/posts/%GG",
		"/posts/a\\b",
		"/posts/a\n",
		"javascript:alert(1)",
		"posts/relative",
		"/posts//a/",
	])
		assert.equal(normalizeCommentSource(path, origin), null, path);
	assert.equal(
		normalizeCommentSource(
			"/posts/a",
			"https://user:pass@blog.example.invalid",
		),
		null,
	);
	assert.equal(normalizeCommentSource("/posts/a", "not-an-origin"), null);
});

test("fixed page names use the same canonical lookup keys", () => {
	for (const [path, title] of fixedCommentSourceNames) {
		const bare = normalizeCommentSource(path.slice(0, -1), origin);
		const absolute = normalizeCommentSource(
			`${origin}${path}?q=1#comments`,
			origin,
		);
		assert.ok(bare && absolute);
		assert.equal(fixedCommentSourceNames.get(bare), title);
		assert.equal(fixedCommentSourceNames.get(absolute), title);
	}
	assert.equal(fixedCommentSourceNames.get("/guestbook/"), "留言板");
	assert.equal(fixedCommentSourceNames.get("/about/"), "关于我");
	assert.equal(fixedCommentSourceNames.get("/friends/"), "友链");
});
