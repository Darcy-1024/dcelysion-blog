import { SKIP, visit } from "unist-util-visit";
import { mediaImageProps } from "../utils/media-image-props.ts";

// Runs at build time, before the browser/preload scanner can see a managed lazy src.
export default function rehypeMediaRouting() {
	return (tree) =>
		visit(tree, "element", (node, _index, parent) => {
			if (parent?.tagName === "picture" || parent?.tagName === "noscript")
				return;
			if (node.tagName !== "img" || typeof node.properties?.src !== "string")
				return;
			const original = { ...node.properties };
			const props = mediaImageProps(
				original.src,
				original.loading !== "eager",
				original.srcSet,
			);
			if (!props["data-media-src"]) return;
			delete node.properties.src;
			delete node.properties.srcSet;
			Object.assign(node.properties, props, { loading: "lazy" });
			// No-JS gets the same valid default URL, without a second JS-enabled fetch.
			node.tagName = "span";
			node.children = [
				{
					type: "element",
					tagName: "img",
					properties: node.properties,
					children: [],
				},
				{
					type: "element",
					tagName: "noscript",
					properties: {},
					children: [
						{
							type: "element",
							tagName: "img",
							properties: original,
							children: [],
						},
					],
				},
			];
			node.properties = {};
			return SKIP;
		});
}
