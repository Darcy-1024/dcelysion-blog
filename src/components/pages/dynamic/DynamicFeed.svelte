<script lang="ts">
import { onMount, tick } from "svelte";
import ClientPagination from "@/components/common/ClientPagination.svelte";
import type { DynamicEntry, DynamicImage } from "@/types/dynamic";
import { formatDynamicDate, formatDynamicDateFull } from "@/utils/date-utils";
import { dynamicPermalink, findDynamicTarget } from "@/utils/dynamic-share";
import { getDynamicImageSizes } from "@/utils/dynamic-utils";
import { fetchWithDedup } from "@/utils/fetch-dedup";
import { assignMedia, backupMedia, mediaRouter } from "@/utils/media-client";
import { registerDynamicGallery } from "./dynamic-gallery";
import { registerDynamicInlineComments } from "./dynamic-inline-comments";

interface MemosConfig {
	enable: boolean;
	apiUrl: string;
	parent?: string;
}

interface Props {
	source: string;
	itemsPerPage: number;
	showComments: boolean;
	emptyText: string;
	noResultsText: string;
	loadingText: string;
	linkMissingText: string;
	shareFailedText: string;
	allYearsText: string;
	timezone: string;
	authorName: string;
	siteTitle: string;
	memos?: MemosConfig;
	prerenderedCount?: number;
	initialTotal?: number;
}

const {
	source,
	itemsPerPage,
	showComments,
	emptyText,
	noResultsText,
	loadingText,
	linkMissingText,
	shareFailedText,
	allYearsText,
	timezone,
	authorName,
	siteTitle,
	memos,
	prerenderedCount,
	initialTotal,
}: Props = $props();

const hasPrerendered = prerenderedCount !== undefined;

let entries = $state<DynamicEntry[]>([]);
let filtered = $state<DynamicEntry[]>([]);
let entriesLoaded = $state(hasPrerendered && (initialTotal ?? 0) === 0);
let ssrPageActive = $state(hasPrerendered && (prerenderedCount ?? 0) > 0);
let currentPage = $state(1);
let loading = $state(!hasPrerendered);
let failed = $state(false);
let templateReady = $state(false);
let anchorEl: HTMLElement;
let list: HTMLElement | null = null;
let missingEl: HTMLElement | null = null;
let template: HTMLTemplateElement | null = null;
let searchInput: HTMLInputElement | null = null;
let yearSelect: HTMLSelectElement | null = null;
let resetButton: HTMLButtonElement | null = null;
let countEl: HTMLElement | null = null;
let restoreAnchorAfterRender = false;
let targetMissing = $state(false);
let selected = $state<{
	description: string;
	image: string | null;
	avatar: string | null;
	pubDate: string;
	url: string;
} | null>(null);
let SharePoster = $state<
	typeof import("@/components/misc/SharePoster.svelte").default | null
>(null);
let alive = true;
let shareRequest = 0;
let shareError = $state("");
let entriesLoadPromise: Promise<boolean> | null = null;

const totalFilteredCount = $derived(
	entriesLoaded ? filtered.length : (initialTotal ?? 0),
);

async function shareFromRoot(root: HTMLElement, entry?: DynamicEntry) {
	const request = ++shareRequest;
	const content = root.querySelector<HTMLElement>("[data-dynamic-content]");
	const text = document.createElement("div");
	if (entry) {
		text.innerHTML = entry.html;
	} else if (content) {
		text.innerHTML = content.innerHTML;
	}
	text.querySelectorAll("script,style,img").forEach((node) => {
		node.remove();
	});
	text.querySelectorAll("br,p,div,li,blockquote").forEach((node) => {
		node.append("\n");
	});
	const description = (text.textContent || "").trim().slice(0, 2000);
	const firstImage =
		root.querySelector<HTMLImageElement>(
			"dynamic-gallery img[data-original-src], dynamic-gallery img",
		) || content?.querySelector<HTMLImageElement>("img");
	const image =
		firstImage?.dataset.originalSrc ||
		firstImage?.currentSrc ||
		firstImage?.src ||
		entry?.images[0]?.src ||
		null;
	const avatar = root.querySelector<HTMLImageElement>(".page-avatar img");
	const timeEl = root.querySelector<HTMLTimeElement>("[data-dynamic-time]");
	const pubDate = entry
		? new Date(entry.published).toISOString()
		: timeEl?.dateTime || new Date().toISOString();
	const permalinkEl = root.querySelector<HTMLAnchorElement>(
		"[data-dynamic-permalink]",
	);
	const shareUrl = entry
		? dynamicPermalink(window.location.href, entry.id, entry.detailUrl)
		: permalinkEl?.href || window.location.href;
	try {
		const module = await import("@/components/misc/SharePoster.svelte");
		if (!alive || request !== shareRequest) return;
		selected = null;
		await tick();
		if (!alive || request !== shareRequest) return;
		SharePoster = module.default;
		selected = {
			description,
			image,
			avatar: avatar?.currentSrc || avatar?.src || null,
			pubDate,
			url: shareUrl,
		};
		shareError = "";
	} catch (error) {
		console.error("Failed to load sharing", error);
		shareError = shareFailedText;
	}
}

function attachPreviewFallback(
	element: HTMLImageElement,
	previewSrc: string | undefined,
	originalSrc: string,
) {
	if (!previewSrc || element.dataset.fallbackBound) return;
	element.dataset.fallbackBound = "true";
	element.addEventListener(
		"error",
		() => {
			if (mediaRouter().entry(previewSrc)) {
				backupMedia(element);
				return;
			}
			element.removeAttribute("srcset");
			element.removeAttribute("sizes");
			element.dataset.previewFallback = "true";
			assignMedia(element, originalSrc);
		},
		{ once: true },
	);
}

function bindCardInteractions(root: HTMLElement, entry?: DynamicEntry) {
	if (root.dataset.boundInteractions) return;
	root.dataset.boundInteractions = "true";

	if (root.dataset.clickable === "true") {
		root.addEventListener("click", (event) => {
			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey ||
				window.getSelection()?.toString().trim()
			)
				return;
			const target = event.target;
			if (
				!(target instanceof Element) ||
				target.closest(
					'a, button, input, textarea, select, label, summary, [role="button"], [role="link"], [contenteditable]:not([contenteditable="false"]), audio, video, iframe, [data-gallery-viewer], dynamic-inline-comments, content-like',
				)
			)
				return;
			root
				.querySelector<HTMLAnchorElement>("[data-dynamic-permalink]")
				?.click();
		});
	}

	root
		.querySelector<HTMLButtonElement>("[data-dynamic-share]")
		?.addEventListener("click", () => {
			void shareFromRoot(root, entry);
		});

	if (root.dataset.clickable !== "true") {
		root
			.querySelectorAll<HTMLAnchorElement>("[data-dynamic-permalink]")
			.forEach((link) => {
				link.dataset.noSwup = "";
				link.addEventListener("click", (event) => {
					if (
						event.button !== 0 ||
						event.metaKey ||
						event.ctrlKey ||
						event.shiftKey ||
						event.altKey
					)
						return;
					event.preventDefault();
					event.stopPropagation();
					if (link.href) history.replaceState(history.state, "", link.href);
				});
			});
	}

	root
		.querySelectorAll<HTMLImageElement>("img[data-original-src]")
		.forEach((img) => {
			const originalSrc = img.dataset.originalSrc;
			const previewSrc = img.getAttribute("src") || undefined;
			if (originalSrc && previewSrc && previewSrc !== originalSrc) {
				attachPreviewFallback(img, previewSrc, originalSrc);
			}
		});
}

function syncMissingBanner(missing: boolean) {
	targetMissing = missing;
	if (missingEl) missingEl.hidden = !missing;
}

function tryLocateInPrerendered(currentUrl: URL): boolean {
	if (!list || !ssrPageActive) return false;
	const entryParam = currentUrl.searchParams.get("entry");
	const nodes = Array.from(
		list.querySelectorAll<HTMLElement>("[data-dynamic-entry]"),
	);
	let matched: HTMLElement | undefined;
	if (entryParam !== null) {
		matched = nodes.find((node) => node.dataset.entryId === entryParam);
	} else if (currentUrl.hash.startsWith("#dynamic-")) {
		try {
			const anchor = decodeURIComponent(currentUrl.hash.slice(1));
			matched = nodes.find((node) => {
				const id = node.dataset.entryId || "";
				return `dynamic-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}` === anchor;
			});
		} catch {
			syncMissingBanner(true);
			return true;
		}
	}
	if (!matched) return false;
	syncMissingBanner(false);
	if (matched.dataset.clickable === "true") {
		const link = matched.querySelector<HTMLAnchorElement>(
			"[data-dynamic-permalink]",
		);
		if (
			link?.href &&
			new URL(link.href).pathname !== window.location.pathname
		) {
			window.location.replace(link.href);
			return true;
		}
	}
	matched.scrollIntoView({ behavior: "auto", block: "start" });
	return true;
}

function locateSharedEntry() {
	const target = findDynamicTarget(entries, new URL(window.location.href));
	syncMissingBanner(target === -1);
	if (target === null || target < 0) return;
	const entry = entries[target];
	if (entry.detailUrl) {
		const destination = dynamicPermalink(
			window.location.href,
			entry.id,
			entry.detailUrl,
		);
		if (new URL(destination).pathname !== window.location.pathname) {
			window.location.replace(destination);
			return;
		}
	}
	if (searchInput) searchInput.value = "";
	if (yearSelect) yearSelect.value = "all";
	ssrPageActive = false;
	filtered = [...entries];
	syncFilterUi();
	currentPage = Math.floor(target / itemsPerPage) + 1;
	restoreAnchorAfterRender = true;
	updateUrl();
}

const pageEntries = $derived(
	filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
);

function pageFromUrl() {
	return Math.max(
		1,
		Number(new URL(window.location.href).searchParams.get("page")) || 1,
	);
}

function updateUrl(clearHash = false) {
	const current = new URL(window.location.href);
	if (currentPage > 1) current.searchParams.set("page", String(currentPage));
	else current.searchParams.delete("page");
	if (clearHash) {
		current.hash = "";
		current.searchParams.delete("entry");
		syncMissingBanner(false);
	}
	history.replaceState(history.state, "", current);
}

function syncFilterUi() {
	const query = searchInput?.value.toLocaleLowerCase().trim() || "";
	const year = yearSelect?.value || "all";
	const isFiltered = query !== "" || year !== "all";
	if (resetButton) {
		resetButton.hidden = !isFiltered;
	}
	if (entriesLoaded && countEl) {
		countEl.textContent = isFiltered
			? `${filtered.length} / ${entries.length}`
			: String(entries.length);
	}
}

function applyFilters(resetPage = true) {
	const query = searchInput?.value.toLocaleLowerCase().trim() || "";
	const year = yearSelect?.value || "all";
	ssrPageActive = false;
	filtered = entries.filter(
		(entry) =>
			(year === "all" ||
				String(new Date(entry.published).getUTCFullYear()) === year) &&
			(!query || entry.searchText.includes(query)),
	);
	syncFilterUi();
	if (resetPage) currentPage = 1;
	const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
	currentPage = Math.min(currentPage, totalPages);
	updateUrl(resetPage);
}

function populateYears() {
	if (!yearSelect) return;
	const previous = yearSelect.value || "all";
	yearSelect.replaceChildren();
	const all = document.createElement("option");
	all.value = "all";
	all.textContent = allYearsText;
	yearSelect.append(all);
	const years = [
		...new Set(
			entries.map((entry) => new Date(entry.published).getUTCFullYear()),
		),
	];
	for (const year of years) {
		const option = document.createElement("option");
		option.value = String(year);
		option.textContent = String(year);
		yearSelect.append(option);
	}
	if ([...yearSelect.options].some((opt) => opt.value === previous)) {
		yearSelect.value = previous;
	}
}

function setImageSource(
	element: HTMLImageElement,
	image: DynamicImage,
	imageCount: number,
	index: number,
) {
	element.alt = image.alt;
	element.loading = "lazy";
	element.decoding = "async";
	element.dataset.originalSrc = image.src;
	if (image.title) element.title = image.title;

	if (!image.preview) {
		assignMedia(element, image.src);
		return;
	}

	element.width = image.preview.width;
	element.height = image.preview.height;
	element.sizes = getDynamicImageSizes(imageCount, index);
	attachPreviewFallback(element, image.preview.src, image.src);
	assignMedia(element, image.preview.src, image.preview.srcSet);
}

function createItem(entry: DynamicEntry) {
	if (!template) return null;
	const fragment = template.content.cloneNode(true) as DocumentFragment;
	const root = fragment.querySelector<HTMLElement>("[data-dynamic-entry]");
	if (!root) return null;
	const anchorId = `dynamic-${encodeURIComponent(entry.id)}`;
	const permalink = dynamicPermalink(
		window.location.href,
		entry.id,
		entry.detailUrl,
	);
	root.id = anchorId;
	root.dataset.entryId = entry.id;
	if (entry.detailUrl) {
		root.dataset.clickable = "true";
	} else {
		delete root.dataset.clickable;
	}
	root.dataset.year = String(new Date(entry.published).getUTCFullYear());

	const author = root.querySelector<HTMLElement>("[data-dynamic-author]");
	if (author) {
		author.id = `${anchorId}-author`;
		root.querySelector("article")?.setAttribute("aria-labelledby", author.id);
	}
	root
		.querySelectorAll<HTMLAnchorElement>("[data-dynamic-permalink]")
		.forEach((link) => {
			link.href = permalink;
		});
	const time = root.querySelector<HTMLTimeElement>("[data-dynamic-time]");
	if (time) {
		const date = new Date(entry.published);
		const useLocalTimeZone =
			source.startsWith("http") || Boolean(memos?.enable);
		time.dateTime = date.toISOString();
		time.textContent = formatDynamicDate(date, { useLocalTimeZone });
		time.title = formatDynamicDateFull(date, {
			timezone,
			useLocalTimeZone,
		});
	}
	const location = root.querySelector<HTMLElement>("[data-dynamic-location]");
	if (location) {
		const locationText = entry.location?.trim();
		if (locationText) {
			const text = location.querySelector<HTMLElement>(
				"[data-dynamic-location-text]",
			);
			if (text) text.textContent = locationText;
			location.title = locationText;
			location.removeAttribute("hidden");
		} else {
			location.setAttribute("hidden", "");
		}
	}

	const content = root.querySelector<HTMLElement>("[data-dynamic-content]");
	if (content) {
		content.id = `${anchorId}-content`;
		content.innerHTML = entry.html;
		entry.images.forEach((image, index) => {
			const element = document.createElement("img");
			setImageSource(element, image, entry.images.length, index);
			content.append(element);
		});
		const gallery = root.querySelector<HTMLElement>("dynamic-gallery");
		if (gallery) gallery.dataset.sourceId = content.id;
	}

	const pinned = root.querySelector<HTMLElement>("[data-dynamic-pinned]");
	if (pinned) {
		if (entry.pinned) {
			pinned.removeAttribute("hidden");
		} else {
			pinned.setAttribute("hidden", "");
		}
	}

	const detailLink = root.querySelector<HTMLAnchorElement>(
		"[data-dynamic-detail-link]",
	);
	const decoration = root.querySelector<HTMLElement>(
		"[data-dynamic-decoration]",
	);
	if (entry.detailUrl) {
		if (detailLink) {
			detailLink.href = permalink;
			detailLink.removeAttribute("hidden");
		}
		decoration?.setAttribute("hidden", "");
	} else {
		if (detailLink) {
			detailLink.removeAttribute("href");
			detailLink.setAttribute("hidden", "");
		}
		decoration?.removeAttribute("hidden");
	}

	const like = root.querySelector<HTMLElement>("content-like");
	if (like) like.dataset.path = `/dynamic/${entry.id}`;

	const comments = root.querySelector<HTMLElement>("dynamic-inline-comments");
	if (comments) {
		if (showComments) {
			comments.dataset.src = `/dynamic/comments/?path=${encodeURIComponent(
				`/dynamic/${entry.id}/`,
			)}`;
		} else {
			comments.remove();
		}
	}

	bindCardInteractions(root, entry);
	return fragment;
}

async function renderItems(items: DynamicEntry[]) {
	await tick();
	if (!list || !template || ssrPageActive) return;
	list.replaceChildren();
	for (const entry of items) {
		const item = createItem(entry);
		if (item) list.append(item);
	}
	document.dispatchEvent(
		new CustomEvent("media:images-added", { detail: list }),
	);
	if (restoreAnchorAfterRender) {
		restoreAnchorAfterRender = false;
		const index = findDynamicTarget(entries, new URL(window.location.href));
		const id = index !== null && index >= 0 ? entries[index].id : null;
		const target = Array.from(
			list.querySelectorAll<HTMLElement>("[data-entry-id]"),
		).find((node) => node.dataset.entryId === id);
		target?.scrollIntoView({ behavior: "auto", block: "start" });
	}
}

async function ensureEntriesLoaded(showSpinner = false): Promise<boolean> {
	if (entriesLoaded) return true;
	if (entriesLoadPromise) return entriesLoadPromise;

	if (showSpinner) loading = true;
	entriesLoadPromise = (async () => {
		try {
			let fetched: DynamicEntry[];
			if (memos?.enable) {
				const { fetchMemos } = await import("@/utils/memos-adapter");
				fetched = await fetchMemos(memos.apiUrl, { parent: memos.parent });
			} else {
				fetched = await fetchWithDedup<DynamicEntry[]>(source);
			}
			if (!alive) return false;
			entries = fetched;
			filtered = [...fetched];
			entriesLoaded = true;
			failed = false;
			populateYears();
			syncFilterUi();
			return true;
		} catch (error) {
			console.error("Failed to load dynamics", error);
			if (!hasPrerendered) failed = true;
			return false;
		} finally {
			entriesLoadPromise = null;
			loading = false;
		}
	})();

	return entriesLoadPromise;
}

async function goToPage(page: number) {
	if (!entriesLoaded) {
		const ok = await ensureEntriesLoaded();
		if (!ok) return;
	}
	ssrPageActive = false;
	currentPage = page;
	updateUrl(true);
	document
		.querySelector(".page-shell")
		?.scrollIntoView({ behavior: "smooth", block: "start" });
}

$effect(() => {
	if (!templateReady || ssrPageActive || !entriesLoaded) return;
	void renderItems(pageEntries);
});

onMount(() => {
	registerDynamicGallery();
	registerDynamicInlineComments();
	const page = anchorEl.closest(".page-shell");
	list = page?.querySelector<HTMLElement>("[data-dynamic-feed-list]") ?? null;
	missingEl =
		page?.querySelector<HTMLElement>("[data-dynamic-link-missing]") ?? null;
	template =
		page?.querySelector<HTMLTemplateElement>("[data-dynamic-item-template]") ??
		null;
	templateReady = template !== null;
	searchInput =
		page?.querySelector<HTMLInputElement>("[data-dynamic-search]") ?? null;
	yearSelect =
		page?.querySelector<HTMLSelectElement>("[data-year-select]") ?? null;
	resetButton =
		page?.querySelector<HTMLButtonElement>("[data-dynamic-filter-reset]") ??
		null;
	countEl =
		page?.querySelector<HTMLElement>("[data-dynamic-page-count]") ?? null;

	if (ssrPageActive && list) {
		list
			.querySelectorAll<HTMLElement>("[data-dynamic-entry]")
			.forEach((node) => {
				bindCardInteractions(node);
			});
	}

	const prewarm = () => {
		if (!entriesLoaded) void ensureEntriesLoaded();
	};
	const filter = async () => {
		const ok = await ensureEntriesLoaded();
		if (ok && alive) applyFilters();
	};
	const resetFilters = async () => {
		if (searchInput) searchInput.value = "";
		if (yearSelect) yearSelect.value = "all";
		const ok = await ensureEntriesLoaded();
		if (ok && alive) applyFilters();
		else syncFilterUi();
	};
	searchInput?.addEventListener("focus", prewarm, { passive: true });
	yearSelect?.addEventListener("focus", prewarm, { passive: true });
	yearSelect?.addEventListener("pointerenter", prewarm, { passive: true });
	searchInput?.addEventListener("input", filter);
	yearSelect?.addEventListener("change", filter);
	resetButton?.addEventListener("click", resetFilters);

	const handleNavigationTarget = async () => {
		const currentUrl = new URL(window.location.href);
		if (tryLocateInPrerendered(currentUrl)) return;
		const hasTarget =
			currentUrl.searchParams.has("entry") ||
			currentUrl.hash.startsWith("#dynamic-");
		if (!hasTarget) return;
		const ok = await ensureEntriesLoaded();
		if (ok && alive) locateSharedEntry();
	};

	const locationChange = () => {
		if (!loading) void handleNavigationTarget();
	};
	window.addEventListener("popstate", locationChange);
	window.addEventListener("hashchange", locationChange);

	const init = async () => {
		const initialUrl = new URL(window.location.href);
		const requestedPage = pageFromUrl();
		const hasTarget =
			initialUrl.searchParams.has("entry") ||
			initialUrl.hash.startsWith("#dynamic-");

		if (hasPrerendered) {
			if (hasTarget && tryLocateInPrerendered(initialUrl)) {
				return;
			}
			if (requestedPage === 1 && !hasTarget) {
				return;
			}
			if (ssrPageActive && list) {
				ssrPageActive = false;
				list.replaceChildren();
			}
			const ok = await ensureEntriesLoaded(true);
			if (!ok || !alive) return;
			currentPage = requestedPage;
			applyFilters(false);
			if (alive && hasTarget) locateSharedEntry();
			return;
		}

		const ok = await ensureEntriesLoaded(true);
		if (!ok || !alive) return;
		currentPage = requestedPage;
		applyFilters(false);
		if (alive) locateSharedEntry();
	};
	void init();

	return () => {
		alive = false;
		shareRequest++;
		window.removeEventListener("popstate", locationChange);
		window.removeEventListener("hashchange", locationChange);
		searchInput?.removeEventListener("focus", prewarm);
		yearSelect?.removeEventListener("focus", prewarm);
		yearSelect?.removeEventListener("pointerenter", prewarm);
		searchInput?.removeEventListener("input", filter);
		yearSelect?.removeEventListener("change", filter);
		resetButton?.removeEventListener("click", resetFilters);
	};
});
</script>

<div bind:this={anchorEl} hidden></div>

{#if loading}
	<div class="page-loading card-base" role="status">
		<span class="page-loading-spinner" aria-hidden="true"></span>
		<p>{loadingText}</p>
	</div>
{:else if failed || (entriesLoaded && entries.length === 0)}
	<div class="page-empty card-base">
		<p>{emptyText}</p>
	</div>
{:else if entriesLoaded && filtered.length === 0}
	<div class="page-no-results card-base">
		<p>{noResultsText}</p>
	</div>
{/if}

{#if targetMissing && !missingEl}<p class="page-no-results card-base" role="status">{linkMissingText}</p>{/if}
{#if shareError}<p role="status">{shareError}</p>{/if}
{#if SharePoster && selected}
 {#key selected}
  <SharePoster title="" author={authorName} description={selected.description} pubDate={selected.pubDate} coverImage={selected.image} avatar={selected.avatar} url={selected.url} {siteTitle} autoOpen hideTrigger dynamicMode dateUTC={!source.startsWith("http") && !memos?.enable} onclose={() => { selected = null; }} />
 {/key}
{/if}

{#if !loading && !failed}
	<ClientPagination
		totalItems={totalFilteredCount}
		{itemsPerPage}
		{currentPage}
		onPageChange={goToPage}
	/>
{/if}
