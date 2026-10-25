import type { DynamicEntry } from "@/types/dynamic";

/** Exact source IDs keep links independent of pagination and filters. */
export function dynamicPermalink(
	location: string,
	id: string,
	detailUrl?: string,
): string {
	const url = new URL(location);
	if (detailUrl?.startsWith("/") && !detailUrl.startsWith("//")) {
		const detail = new URL(detailUrl, url);
		detail.search = "";
		detail.hash = "";
		return detail.href;
	}
	url.search = "";
	url.hash = "";
	url.searchParams.set("entry", id);
	return url.href;
}

export function dynamicDetailPath(id: string): string {
	return `/dynamic/${id.split("/").map(encodeURIComponent).join("/")}/`;
}

/** null: ordinary list; -1: unavailable entry. Also accepts legacy anchors. */
export function findDynamicTarget(
	entries: Pick<DynamicEntry, "id">[],
	url: URL,
): number | null {
	const id = url.searchParams.get("entry");
	if (id !== null) return entries.findIndex((entry) => entry.id === id);
	let anchor: string;
	try {
		anchor = decodeURIComponent(url.hash.slice(1));
	} catch {
		return -1;
	}
	if (!anchor.startsWith("dynamic-")) return null;
	return entries.findIndex(
		(entry) => `dynamic-${entry.id.replace(/[^a-zA-Z0-9_-]/g, "-")}` === anchor,
	);
}
