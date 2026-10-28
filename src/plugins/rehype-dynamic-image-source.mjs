import { visit } from "unist-util-visit";

// Preserve the source identity through Astro's Markdown image optimization.
export default function rehypeDynamicImageSource() {
	return (tree, file) => {
		if (!file.path?.replaceAll("\\", "/").includes("/src/content/dynamic/"))
			return;
		visit(tree, "element", (node) => {
			if (
				node.tagName === "img" &&
				typeof node.properties?.src === "string" &&
				node.properties.src.startsWith("./images/")
			)
				node.properties["data-dynamic-image-source"] = node.properties.src;
		});
	};
}
