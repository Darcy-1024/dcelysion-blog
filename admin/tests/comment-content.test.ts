import assert from "node:assert/strict";
import { test } from "node:test";
import { commentParts } from "../client/comment-content.js";

const text = (value: string) => commentParts(value).map((part) =>
	part.type === "text" ? part.text : part.alt,
).join("");

test("comment paragraphs, explicit line breaks, entities and real wl-emoji text survive", () => {
	assert.equal(text('<p>正文 &amp; &lt;代码&gt;<br>第二行</p><p><span class="wl-emoji">不是图片的正文</span></p>'), "正文 & <代码>\n第二行\n不是图片的正文");
	assert.equal(text("正文\n\n尾行\n"), "正文\n\n尾行\n");
	assert.equal(text('<p>前<img src="https://example.com/a.png" alt="图片说明">后</p>'), "前图片说明后");
});

test("only known Waline emoji images produce image tokens, with no HTML attributes", () => {
	assert.deepEqual(commentParts('<p>前<img class="wl-emoji" src="https://unpkg.com/@waline/emojis@1.4.0/weibo/dog.png" alt="[dog]" onerror="alert(1)">后</p>'), [
		{ type: "text", text: "前" },
		{ type: "emoji", src: "https://unpkg.com/@waline/emojis@1.4.0/weibo/dog.png", alt: "[dog]" },
		{ type: "text", text: "后" },
	]);
});

test("active markup cannot create DOM, links or untrusted image requests", () => {
	const attacks = [
		"javascript:alert(1)", "data:image/svg+xml,alert(1)",
		"https://evil.example/a.png", "https://unpkg.com.evil.example/@waline/emojis@1.4.0/weibo/a.png",
		"https://user:pass@unpkg.com/@waline/emojis@1.4.0/weibo/a.png",
		"https://unpkg.com/@waline/emojis@1.4.0/weibo/a.svg",
		"https://unpkg.com/@waline/emojis@1.4.0/weibo/a.png?module",
		"https://unpkg.com/@waline/emojis@1.4.0/weibo/../evil.png",
		"https://unpkg.com/@waline/emojis@1.4.0/weibo/a%2f..%2f..%2fevil.png",
	];
	for (const src of attacks) {
		assert.deepEqual(commentParts(`<img class="wl-emoji" src="${src}" alt="保留说明">`), [{ type: "text", text: "保留说明" }]);
	}
	assert.equal(text('<script>alert(1)</script><style>body{display:none}</style><a href="javascript:alert(1)" onclick="alert(2)">可读正文</a><svg onload="alert(3)"><text>普通文本</text></svg>'), "可读正文普通文本");
	assert.equal(text('<span class="wl-emoji" onclick="alert(1)">这仍是正文</span>'), "这仍是正文");
});

test("deeply nested comment markup is traversed without recursive rendering", () => {
	assert.equal(text(`${"<span>".repeat(1000)}正文${"</span>".repeat(1000)}`), "正文");
});
