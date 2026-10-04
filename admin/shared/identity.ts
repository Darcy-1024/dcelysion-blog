import { slug as githubSlug } from "github-slugger";
import { isMap, isScalar, parseDocument } from "yaml";
import { frontmatter } from "./editor.js";

// Mirrors the installed Astro glob loader: explicit slug, then GitHub-slugged path.
export function contentIdentity(path: string, source: string) {
	const fallback = path
		.replace(/\.(md|mdx)$/iu, "")
		.split("/")
		.map((part) => githubSlug(part))
		.join("/")
		.replace(/\/index$/u, "");
	const fm = frontmatter(source);
	if (!fm) return { id: fallback, reliable: false };
	const document = parseDocument(fm.yaml, {
		prettyErrors: false,
		logLevel: "silent",
	});
	if (
		document.errors.length ||
		document.warnings.length ||
		!isMap(document.contents)
	)
		return { id: fallback, reliable: false };
	const node = document.contents.get("slug", true);
	if (!node || (isScalar(node) && !node.value))
		return { id: fallback, reliable: true };
	if (!isScalar(node) || typeof node.value !== "string")
		return { id: fallback, reliable: false };
	return { id: node.value, reliable: true };
}
export function safeIdentity(id: string) {
	return (
		id.length > 0 &&
		[...id].every((char) => char.charCodeAt(0) >= 32) &&
		id.length <= 200 &&
		id.split("/").every((part) => !!part && part !== "." && part !== "..") &&
		!/[\\\s<>:"|?*%#]/u.test(id)
	);
}
