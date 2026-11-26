<script lang="ts">
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import type { SearchResult } from "@/global";
import { url as formatUrl } from "@/utils/url-utils";

// --- Props ---
export let title = i18n(I18nKey.search);
export let description = "";

// --- State ---
let keyword = "";
let results: SearchResult[] = [];
let isSearching = false;
let initialized = false;
let requestId = 0;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let searchInput: HTMLInputElement | undefined;

// 在客户端获取 URL 参数
const getInitialKeyword = (): string => {
	if (typeof window !== "undefined") {
		const searchParams = new URLSearchParams(window.location.search);
		return searchParams.get("q") || "";
	}
	return "";
};

const syncQueryToUrl = (value: string): void => {
	if (typeof window === "undefined") return;
	const nextUrlObj = new URL(window.location.href);
	const trimmed = value.trim();
	if (trimmed) {
		nextUrlObj.searchParams.set("q", trimmed);
	} else {
		nextUrlObj.searchParams.delete("q");
	}
	const nextUrl = `${nextUrlObj.pathname}${nextUrlObj.search}${nextUrlObj.hash}`;
	const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
	if (nextUrl !== currentUrl) {
		window.history.replaceState(window.history.state, "", nextUrl);
	}
};

// --- Mocks for Dev Mode ---
const fakeResult: SearchResult[] = [
	{
		url: formatUrl("/"),
		meta: { title: "Dev Mode Search Result 1" },
		excerpt: "This is a <mark>mock</mark> result for development.",
	},
	{
		url: formatUrl("/"),
		meta: { title: "Dev Mode Search Result 2" },
		excerpt: "Pagefind only works in <mark>production</mark> build.",
	},
];

// --- Core Search Logic ---
const search = async () => {
	const id = ++requestId;
	if (!initialized || !keyword.trim()) {
		results = [];
		isSearching = false;
		return;
	}
	isSearching = true;

	try {
		if (import.meta.env.PROD && window.pagefind) {
			const response = await window.pagefind.search(keyword);
			const rawResults = await Promise.all(
				response.results.map((item) => item.data()),
			);
			if (id === requestId) results = rawResults;
		} else if (import.meta.env.DEV) {
			// 开发模式下的模拟结果
			results = fakeResult.filter(
				(item) =>
					item.excerpt.toLowerCase().includes(keyword.toLowerCase()) ||
					item.meta.title.toLowerCase().includes(keyword.toLowerCase()),
			);
		}
	} catch (error) {
		if (id !== requestId) return;
		console.error("Search error:", error);
		results = [];
	} finally {
		if (id === requestId) isSearching = false;
	}
};

// --- Initialization onMount ---
onMount(() => {
	const initialize = () => {
		if (initialized) return;
		document.removeEventListener("pagefindready", initialize);
		window.removeEventListener("pagefindready", initialize);
		initialized = true;
		clearTimeout(debounceTimer);
		void search();
	};

	const handlePopState = () => {
		clearTimeout(debounceTimer);
		keyword = getInitialKeyword();
		void search();
	};

	keyword = getInitialKeyword();
	window.addEventListener("popstate", handlePopState);
	// 开发环境直接初始化
	if (import.meta.env.DEV) {
		initialize();
	} else {
		// 生产环境等待 Pagefind 加载
		window.__loadPagefind?.();
		if (window.pagefind) {
			initialize();
		} else {
			document.addEventListener("pagefindready", initialize, {
				once: true,
			});
			window.addEventListener("pagefindready", initialize, { once: true });
		}
	}
	return () => {
		++requestId;
		clearTimeout(debounceTimer);
		window.removeEventListener("popstate", handlePopState);
		document.removeEventListener("pagefindready", initialize);
		window.removeEventListener("pagefindready", initialize);
	};
});

const handleInput = (event: Event & { currentTarget: HTMLInputElement }) => {
	keyword = event.currentTarget.value;
	++requestId;
	clearTimeout(debounceTimer);
	if (!keyword.trim()) {
		results = [];
		isSearching = false;
		debounceTimer = setTimeout(() => {
			syncQueryToUrl("");
		}, 300);
		return;
	}
	debounceTimer = setTimeout(() => {
		syncQueryToUrl(keyword);
		void search();
	}, 300);
};

const clearSearch = (): void => {
	++requestId;
	clearTimeout(debounceTimer);
	keyword = "";
	results = [];
	isSearching = false;
	syncQueryToUrl("");
	searchInput?.focus();
};
</script>

<div class="card-base px-6 py-6 md:px-9 md:py-6 mb-4 rounded-(--radius-large)">
	<!-- Title Section -->
	<div class="mb-4">
		<div class="flex items-center gap-3 mb-3">
			<div class="h-8 w-8 rounded-lg bg-(--primary) flex items-center justify-center text-white dark:text-black/70">
				<Icon icon="material-symbols:search" class="text-[1.5rem]" />
			</div>
			<div class="text-3xl font-bold text-90">
				{title}
			</div>
		</div>
		{#if description}
			<p class="text-base text-50 leading-relaxed">
				{description}
			</p>
		{/if}
	</div>

	<!-- Search Bar -->
	<div class="relative flex">
		<div class="relative flex-1">
			<div class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
				<Icon icon="material-symbols:search" class="text-2xl text-50" />
			</div>
			<input
				bind:this={searchInput}
				type="text"
				class="block w-full p-4 pl-10 pr-10 text-sm bg-transparent border border-black/10 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-(--primary) focus:border-(--primary) hover:border-black/20 dark:hover:border-white/20 text-75 placeholder:opacity-50 transition-colors outline-hidden"
				placeholder={i18n(I18nKey.search)}
				value={keyword}
				on:input={handleInput}
			/>
			{#if keyword}
				<button
					type="button"
					on:click={clearSearch}
					aria-label={i18n(I18nKey.announcementClose)}
					class="absolute inset-y-0 right-2 my-auto h-8 w-8 flex items-center justify-center rounded-md text-50 hover:text-90 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						width="1.125rem"
						height="1.125rem"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M18 6 6 18" />
						<path d="m6 6 12 12" />
					</svg>
				</button>
			{/if}
		</div>
	</div>
</div>

<div class="grid grid-cols-1 gap-4">
	<!-- Results Area -->
	<div>
		{#if isSearching}
			<div class="flex justify-center py-10">
				<Icon icon="svg-spinners:ring-resize" class="text-4xl text-(--primary)" />
			</div>
		{:else if results.length > 0}
			<div class="flex items-center gap-2 px-1 mb-3 text-sm text-50">
				<span>{i18n(I18nKey.search)}</span>
				<span class="inline-flex items-center justify-center px-2 py-0.5 text-xs font-semibold rounded-full bg-(--btn-regular-bg) text-(--primary)">
					{results.length}
				</span>
			</div>
			<div class="space-y-4">
				{#each results as result}
					<div class="card-base p-6 block rounded-(--radius-large)">
						<a href={result.url} class="block group">
							<h5 class="mb-2 text-2xl font-bold tracking-tight text-90 group-hover:text-(--primary) transition-colors">
								{@html result.meta.title}
							</h5>
							<p class="font-normal text-75">
								{@html result.excerpt}
							</p>
						</a>
					</div>
				{/each}
			</div>
		{:else if keyword}
			<div class="card-base p-10 text-center text-50 rounded-(--radius-large)">
				{i18n(I18nKey.searchNoResults)}
			</div>
		{:else}
			<div class="card-base p-10 text-center text-50 rounded-(--radius-large)">
				{i18n(I18nKey.searchTypeSomething)}
			</div>
		{/if}
	</div>
</div>

<style>
    /* 关键字高亮效果 - 主题色 */
    :global(mark) {
        background: transparent;
        color: var(--primary);
        font-weight: 600;
        padding: 0 0.1em;
    }
</style>
