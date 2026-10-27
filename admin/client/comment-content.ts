import { fromHtml } from "hast-util-from-html";
import type { Element, RootContent } from "hast";

export type CommentPart =
	| { type: "text"; text: string }
	| { type: "emoji"; src: string; alt: string };

const blocks = new Set([
	"p", "div", "blockquote", "pre", "li", "ul", "ol", "h1", "h2", "h3",
	"h4", "h5", "h6", "table", "tr", "section", "hr",
]);
const hidden = new Set(["script", "style", "iframe", "object", "template"]);

function emojiSource(element: Element): string | null {
	const classes = element.properties.className;
	if (!Array.isArray(classes) || !classes.includes("wl-emoji")) return null;
	const source = element.properties.src;
	if (typeof source !== "string") return null;
	try {
		const url = new URL(source);
		// Match the blog's configured Waline packs; never load arbitrary comment images.
		if (
			url.protocol !== "https:" || url.hostname !== "unpkg.com" ||
			url.port || url.username || url.password || url.search || url.hash ||
			/%(?:2f|5c|2e|25)/i.test(url.pathname) ||
			!/^\/@waline\/emojis@1\.4\.0\/(weibo|bilibili|bmoji)\/[\w%.-]+\.(png|gif|webp|jpe?g)$/i.test(url.pathname)
		) return null;
		return url.href;
	} catch {
		return null;
	}
}

/** Parse without creating browser DOM. Only data tokens ever reach the template. */
export function commentParts(content: string): CommentPart[] {
	const root = fromHtml(content, { fragment: true });
	const parts: CommentPart[] = [];
	let trailingBlockBreak = false;
	const append = (text: string) => {
		if (!text) return;
		trailingBlockBreak = false;
		const last = parts.at(-1);
		if (last?.type === "text") last.text += text;
		else parts.push({ type: "text", text });
	};
	const newline = () => {
		const last = parts.at(-1);
		if (last && !(last.type === "text" && last.text.endsWith("\n"))) {
			append("\n");
			trailingBlockBreak = true;
		}
	};
	// Iterative traversal also handles deeply nested untrusted markup.
	const stack: (RootContent | "break")[] = [...root.children].reverse();
	while (stack.length) {
		const node = stack.pop();
		if (!node) continue;
		if (node === "break") { newline(); continue; }
		if (node.type === "text") { append(node.value); continue; }
		if (node.type !== "element" || hidden.has(node.tagName)) continue;
		if (node.tagName === "br") { append("\n"); continue; }
		if (node.tagName === "img") {
			const alt = typeof node.properties.alt === "string" ? node.properties.alt : "";
			const src = emojiSource(node);
			if (src) {
				parts.push({ type: "emoji", src, alt: alt || "表情" });
				trailingBlockBreak = false;
			}
			else append(alt);
			continue;
		}
		if (blocks.has(node.tagName)) { newline(); stack.push("break"); }
		stack.push(...[...node.children].reverse());
	}
	const last = parts.at(-1);
	if (trailingBlockBreak && last?.type === "text") {
		last.text = last.text.replace(/\n$/, "");
		if (!last.text) parts.pop();
	}
	return parts;
}
