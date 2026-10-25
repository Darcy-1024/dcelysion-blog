<script lang="ts">
import { onMount, tick } from "svelte";
import ClientPagination from "@/components/common/ClientPagination.svelte";
import { profileConfig, siteConfig } from "@/config";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { DynamicEntry, DynamicImage } from "@/types/dynamic";
import { formatTimezoneOffset } from "@/utils/date-utils";
import { dynamicPermalink, findDynamicTarget } from "@/utils/dynamic-share";
import { assignMedia, backupMedia, mediaRouter } from "@/utils/media-client";
import { fetchMemos } from "@/utils/memos-adapter";
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
	allYearsText: string;
	timezone: string;
	memos?: MemosConfig;
}

const {
	source,
	itemsPerPage,
	showComments,
	emptyText,
	noResultsText,
	loadingText,
	allYearsText,
	timezone,
	memos,
}: Props = $props();

let entries = $state<DynamicEntry[]>([]);
let filtered = $state<DynamicEntry[]>([]);
let currentPage = $state(1);
let loading = $state(true);
let failed = $state(false);
let templateReady = $state(false);
let list: HTMLElement;
let template: HTMLTemplateElement | null = null;
let searchInput: HTMLInputElement | null = null;
let yearSelect: HTMLSelectElement | null = null;
let restoreAnchorAfterRender = false;
let targetMissing = $state(false);
let selected = $state<{
	entry: DynamicEntry;
	description: string;
	image: string | null;
	avatar: string | null;
} | null>(null);
let SharePoster = $state<
	typeof import("@/components/misc/SharePoster.svelte").default | null
>(null);
let alive = true;
let shareRequest = 0;
let shareError = $state("");

async function shareEntry(entry: DynamicEntry, root: HTMLElement) {
	const request = ++shareRequest;
	const content = root.querySelector<HTMLElement>("[data-dynamic-content]");
	const text = document.createElement("div");
	text.innerHTML = entry.html;
	text.querySelectorAll("script,style").forEach((node) => {
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
		entry.images[0]?.src ||
		null;
	const avatar = root.querySelector<HTMLImageElement>(".page-avatar img");
	try {
		const module = await import("@/components/misc/SharePoster.svelte");
		if (!alive || request !== shareRequest) return;
		selected = null;
		await tick();
		if (!alive || request !== shareRequest) return;
		SharePoster = module.default;
		selected = {
			entry,
			description,
			image,
			avatar: avatar?.currentSrc || avatar?.src || null,
		};
		shareError = "";
	} catch (error) {
		console.error("Failed to load sharing", error);
		shareError = i18n(I18nKey.sharePosterFailed);
	}
}

function locateSharedEntry() {
	const target = findDynamicTarget(entries, new URL(window.location.href));
	targetMissing = target === -1;
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
	filtered = [...entries];
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
		targetMissing = false;
	}
	history.replaceState(history.state, "", current);
}

function applyFilters(resetPage = true) {
	const query = searchInput?.value.toLocaleLowerCase().trim() || "";
	const year = yearSelect?.value || "all";
	filtered = entries.filter(
		(entry) =>
			(year === "all" ||
				String(new Date(entry.published).getUTCFullYear()) === year) &&
			(!query || entry.searchText.includes(query)),
	);
	if (resetPage) currentPage = 1;
	const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
	currentPage = Math.min(currentPage, totalPages);
	updateUrl(resetPage);
}

function populateYears() {
	if (!yearSelect) return;
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
}

function getImageSizes(imageCount: number, index: number): string {
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
	element.sizes = getImageSizes(imageCount, index);

	element.addEventListener(
		"error",
		() => {
			if (mediaRouter().entry(image.preview?.src || "")) {
				backupMedia(element);
				return;
			}
			element.removeAttribute("srcset");
			element.removeAttribute("sizes");
			element.dataset.previewFallback = "true";
			assignMedia(element, image.src);
		},
		{ once: true },
	);
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
			// Follow the existing link so Swup keeps handling page navigation.
			root
				.querySelector<HTMLAnchorElement>("[data-dynamic-permalink]")
				?.click();
		});
	}
	root
		.querySelector<HTMLButtonElement>("[data-dynamic-share]")
		?.addEventListener("click", () => {
			void shareEntry(entry, root);
		});
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
			if (entry.detailUrl) return;
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
				history.replaceState(history.state, "", permalink);
			});
		});
	const time = root.querySelector<HTMLTimeElement>("[data-dynamic-time]");
	if (time) {
		const date = new Date(entry.published);
		time.dateTime = date.toISOString();
		// 第三方 API 和 Memos 使用浏览器本地时区，不做额外时区转换
		if (source.startsWith("http") || memos?.enable) {
			time.textContent = date.toLocaleDateString("zh-CN", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
			});
		} else {
			time.textContent = new Intl.DateTimeFormat(
				document.documentElement.lang || undefined,
				{
					timeZone: "UTC",
					year: "numeric",
					month: "2-digit",
					day: "2-digit",
					hour: "2-digit",
					minute: "2-digit",
					second: "2-digit",
				},
			).format(date);
			time.textContent += ` ${formatTimezoneOffset(timezone, date)}`;
		}
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

	// 置顶标识
	const pinned = root.querySelector<HTMLElement>("[data-dynamic-pinned]");
	if (pinned) {
		if (entry.pinned) {
			pinned.removeAttribute("hidden");
		} else {
			pinned.setAttribute("hidden", "");
		}
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
	return fragment;
}

async function renderItems(items: DynamicEntry[]) {
	await tick();
	if (!list || !template) return;
	list.replaceChildren();
	for (const entry of items) {
		const item = createItem(entry);
		if (item) list.append(item);
	}
	// Template avatars also need activation when a page has no gallery images.
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

function goToPage(page: number) {
	currentPage = page;
	updateUrl(true);
	document
		.querySelector(".page-shell")
		?.scrollIntoView({ behavior: "smooth", block: "start" });
}

$effect(() => {
	if (!templateReady) return;
	renderItems(pageEntries);
});

onMount(() => {
	registerDynamicGallery();
	registerDynamicInlineComments();
	const page = list.closest(".page-shell");
	template =
		page?.querySelector<HTMLTemplateElement>("[data-dynamic-item-template]") ??
		null;
	templateReady = template !== null;
	searchInput =
		page?.querySelector<HTMLInputElement>("[data-dynamic-search]") ?? null;
	yearSelect =
		page?.querySelector<HTMLSelectElement>("[data-year-select]") ?? null;
	const filter = () => applyFilters();
	searchInput?.addEventListener("input", filter);
	yearSelect?.addEventListener("change", filter);

	const locationChange = () => {
		if (!loading) locateSharedEntry();
	};
	window.addEventListener("popstate", locationChange);
	window.addEventListener("hashchange", locationChange);
	const load = async () => {
		try {
			if (memos?.enable) {
				entries = await fetchMemos(memos.apiUrl, { parent: memos.parent });
			} else {
				const response = await fetch(source);
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				entries = (await response.json()) as DynamicEntry[];
			}
			if (!alive) return;
			// 更新页面计数
			const countEl = document.querySelector("[data-dynamic-page-count]");
			if (countEl) countEl.textContent = String(entries.length);
			populateYears();
			currentPage = pageFromUrl();
			applyFilters(false);
			if (alive) locateSharedEntry();
		} catch (error) {
			console.error("Failed to load dynamics", error);
			failed = true;
		} finally {
			loading = false;
		}
	};
	void load();

	return () => {
		alive = false;
		shareRequest++;
		window.removeEventListener("popstate", locationChange);
		window.removeEventListener("hashchange", locationChange);
		searchInput?.removeEventListener("input", filter);
		yearSelect?.removeEventListener("change", filter);
	};
});
</script>

{#if loading}
	<div class="page-loading card-base" role="status">
		<span class="page-loading-spinner" aria-hidden="true"></span>
		<p>{loadingText}</p>
	</div>
{:else if failed || entries.length === 0}
	<div class="page-empty card-base">
		<p>{emptyText}</p>
	</div>
{:else if filtered.length === 0}
	<div class="page-no-results card-base">
		<p>{noResultsText}</p>
	</div>
{/if}

{#if targetMissing}<p class="page-no-results card-base" role="status">{i18n(I18nKey.dynamicLinkMissing)}</p>{/if}
{#if shareError}<p role="status">{shareError}</p>{/if}
{#if SharePoster && selected}
 {#key selected}
  <SharePoster title="" author={profileConfig.name} description={selected.description} pubDate={new Date(selected.entry.published).toISOString()} coverImage={selected.image} avatar={selected.avatar} url={dynamicPermalink(window.location.href, selected.entry.id, selected.entry.detailUrl)} siteTitle={siteConfig.title} autoOpen hideTrigger dynamicMode dateUTC={!source.startsWith("http") && !memos?.enable} onclose={() => { selected = null; }} />
 {/key}
{/if}
<div class="page-feed" bind:this={list}></div>

{#if !loading && !failed}
	<ClientPagination
		totalItems={filtered.length}
		{itemsPerPage}
		{currentPage}
		onPageChange={goToPage}
	/>
{/if}
