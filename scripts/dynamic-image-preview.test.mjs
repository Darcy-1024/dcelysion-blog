import assert from "node:assert/strict";
import test from "node:test";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import rehypeDynamicImageSource from "../src/plugins/rehype-dynamic-image-source.mjs";
import { dynamicImageHtml } from "../src/utils/dynamic-image-html.ts";

test("only local dynamic Markdown images receive a source identity", async () => {
	const processor = await createMarkdownProcessor({
		rehypePlugins: [rehypeDynamicImageSource],
	});
	const markdown =
		"正文😋\n\n![第一张](./images/a.avif)\n\n![远程](https://example.com/a.jpg)";
	const dynamic = await processor.render(markdown, {
		fileURL: new URL(
			"file:///F:/DcElysion-blog/src/content/dynamic/example.md",
		),
	});
	assert.match(dynamic.code, /data-dynamic-image-source/);
	assert.equal(
		(dynamic.code.match(/data-dynamic-image-source/g) || []).length,
		1,
	);
	const post = await processor.render(markdown, {
		fileURL: new URL("file:///F:/DcElysion-blog/src/content/posts/example.md"),
	});
	assert.doesNotMatch(post.code, /data-dynamic-image-source/);
});

test("SSR replaces requests before HTML delivery while preserving body, order and originals", async () => {
	const prefix = "<p>文学少女20周年纪念开箱😋 &amp; 原文</p><center><figure>";
	const suffix = "</figure></center><p>正文结尾。</p>";
	const first =
		'<img src="/original-first.webp" srcset="/original-first.webp 4000w" width="4000" height="3000" alt="图片 &quot;一&gt;二&quot;" data-dynamic-image-source="./images/first.avif">';
	const second =
		'<img data-media-src="/original-second.webp" data-media-srcset="/original-second.webp 4000w" alt="第二张" data-dynamic-image-source="./images/second.avif">';
	const remote = '<img src="https://example.com/a.jpg" alt="远程">';
	const result = await dynamicImageHtml(
		prefix + first + second + remote + suffix,
		async (source) => {
			const name = source.includes("first") ? "first" : "second";
			return {
				src: `/preview-${name}.webp`,
				srcset: `/preview-${name}-320.webp 320w, /preview-${name}.webp 960w`,
				width: 960,
				height: 720,
				originalSrc: `/original-${name}.avif`,
			};
		},
	);
	assert.ok(result.startsWith(prefix));
	assert.ok(result.endsWith(remote + suffix));
	assert.ok(
		result.indexOf("/preview-first.webp") <
			result.indexOf("/preview-second.webp"),
	);
	assert.match(result, /alt="图片 &quot;一&gt;二&quot;"/);
	assert.match(result, /data-original-src="\/original-first.avif"/);
	assert.match(result, /width="960" height="720"/);
	assert.doesNotMatch(
		result,
		/data-media-src|data-dynamic-image-source|4000w|\ssrc="\/original/,
	);
});
