import { fromHtml } from "hast-util-from-html";

type PreviewAttributes = {
	src: string;
	srcset?: string;
	width: number;
	height: number;
	originalSrc: string;
};

const escapeAttribute = (value: string | number) =>
	String(value)
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

// Only rewrite marked img start tags; preserve all surrounding rendered content.
export async function dynamicImageHtml(
	html: string,
	resolve: (source: string) => Promise<PreviewAttributes | undefined>,
): Promise<string> {
	const tags = [...html.matchAll(/<img\b(?:[^"'>]|"[^"]*"|'[^']*')*>/gi)];
	const replacements = await Promise.all(
		tags.map(async ([tag]) => {
			const node = fromHtml(tag, { fragment: true }).children[0];
			if (node?.type !== "element" || node.tagName !== "img") return tag;
			const source = node.properties.dataDynamicImageSource;
			if (typeof source !== "string") return tag;
			const preview = await resolve(source);
			if (!preview) return tag;
			const cleaned = tag.replace(
				/\s(?:src|srcset|sizes|width|height|data-media-src|data-media-srcset|data-media-active|data-dynamic-image-source|data-original-src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
				"",
			);
			const attributes = {
				src: preview.src,
				...(preview.srcset ? { srcset: preview.srcset } : {}),
				sizes: "(max-width: 768px) 92vw, 640px",
				width: preview.width,
				height: preview.height,
				"data-original-src": preview.originalSrc,
			};
			return cleaned.replace(
				/\s*\/?\s*>$/,
				` ${Object.entries(attributes)
					.map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
					.join(" ")}>`,
			);
		}),
	);
	let index = 0;
	return html.replace(
		/<img\b(?:[^"'>]|"[^"]*"|'[^']*')*>/gi,
		() => replacements[index++],
	);
}
