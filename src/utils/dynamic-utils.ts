import type { CollectionEntry } from "astro:content";

export const sortDynamics = (
	entries: CollectionEntry<"dynamic">[],
): CollectionEntry<"dynamic">[] =>
	entries.sort((a, b) => {
		// 置顶优先，然后按发布时间降序
		if (a.data.pinned && !b.data.pinned) return -1;
		if (!a.data.pinned && b.data.pinned) return 1;
		return b.data.published.getTime() - a.data.published.getTime();
	});

export const dynamicSlug = (id: string): string =>
	id.replace(/\.(md|mdx)$/i, "");

export const dynamicAnchor = (id: string): string =>
	`dynamic-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

export const dynamicPlainText = (entry: CollectionEntry<"dynamic">): string =>
	(entry.body || "")
		.replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/[#>*_`~[\]()-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

export const dynamicSearchText = (entry: CollectionEntry<"dynamic">): string =>
	[dynamicPlainText(entry), entry.data.location]
		.filter(Boolean)
		.join(" ")
		.toLocaleLowerCase();

export const getDynamicImageSizes = (
	imageCount: number,
	index: number,
): string => {
	if (imageCount === 1) {
		return "(max-width: 48rem) calc(100vw - 5.75rem), 36rem";
	}
	if (imageCount === 3 && index === 0) {
		return "(max-width: 48rem) calc((100vw - 6rem) * 0.6667), 28rem";
	}
	if (imageCount === 5) {
		return index === 0
			? "(max-width: 48rem) calc((100vw - 6rem) / 2), 21rem"
			: "(max-width: 48rem) calc((100vw - 6.75rem) / 4), 10.5rem";
	}
	if (imageCount === 2 || imageCount === 4) {
		return "(max-width: 48rem) calc((100vw - 6rem) / 2), 14rem";
	}
	return "(max-width: 48rem) calc((100vw - 6.5rem) / 3), 14rem";
};
