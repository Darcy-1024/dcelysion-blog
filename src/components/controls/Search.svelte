<script lang="ts">
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { navigateToPage } from "@utils/navigation-utils";
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import type { SearchResult } from "@/global";
import { FLOATING_PANEL_CLOSE_EVENT } from "@/utils/floating-panel-utils";
import { url as formatUrl, getSearchUrl } from "@/utils/url-utils";

// --- State ---
let keywordDesktop = "";
let keywordMobile = "";
let result: SearchResult[] = [];
let activeIndex = -1;
let isSearching = false;
let initialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let searchRequestId = 0;

// --- Mocks for Dev Mode ---
const fakeResult: SearchResult[] = [
	{
		url: formatUrl("/"),
		meta: { title: "This Is a Fake Search Result" },
		excerpt:
			"Because Pagefind cannot work in the <mark>dev</mark> environment.",
	},
	{
		url: formatUrl("/"),
		meta: { title: "If You Want to Test the Search" },
		excerpt: "Try running <mark>npm build && npm preview</mark> instead.",
	},
];

// --- UI Logic ---
// pagefind.js 是按需加载的（见 Navbar.astro），搜索 UI 一被碰到就触发。
// 幂等，重复调用只会拿到同一个 promise。
const requestPagefind = (): void => {
	window.__loadPagefind?.();
};

const togglePanel = () => {
	requestPagefind();
	document
		.getElementById("search-panel")
		?.classList.toggle("float-panel-closed");
};

const handleDesktopFocus = (event: FocusEvent): void => {
	requestPagefind();

	const input = event.currentTarget;
	if (
		input instanceof HTMLElement &&
		input.hasAttribute("data-floating-panel-focus-return")
	)
		return;

	search(keywordDesktop, true);
};

const setPanelVisibility = (show: boolean, isDesktop: boolean): void => {
	const panel = document.getElementById("search-panel");
	if (
		!panel ||
		(isDesktop && !keywordDesktop) ||
		(!isDesktop && !keywordMobile)
	)
		return;
	if (show) {
		panel.classList.remove("float-panel-closed");
	} else {
		panel.classList.add("float-panel-closed");
	}
};

const cancelPendingSearch = (): void => {
	clearTimeout(debounceTimer);
	searchRequestId += 1;
	isSearching = false;
	activeIndex = -1;
};

const closeSearchPanel = (): void => {
	cancelPendingSearch();
	document.getElementById("search-panel")?.classList.add("float-panel-closed");
	keywordDesktop = "";
	keywordMobile = "";
	result = [];
	activeIndex = -1;
};

const handleResultClick = (event: Event, url: string): void => {
	event.preventDefault();
	closeSearchPanel();
	navigateToPage(url);
};

const scrollActiveItemIntoView = (index: number): void => {
	const panel = document.getElementById("search-panel");
	const items = panel?.querySelectorAll<HTMLElement>("[data-search-nav-item]");
	items?.[index]?.scrollIntoView({ block: "nearest" });
};

const handleKeydown = (event: KeyboardEvent, isDesktop: boolean): void => {
	if (event.isComposing || event.keyCode === 229) return;

	const currentKeyword = (isDesktop ? keywordDesktop : keywordMobile).trim();
	const panel = document.getElementById("search-panel");
	const isPanelOpen = Boolean(
		panel && !panel.classList.contains("float-panel-closed"),
	);

	if (event.key === "ArrowDown") {
		if (navUrls.length === 0) return;
		event.preventDefault();
		if (!isPanelOpen) setPanelVisibility(true, isDesktop);
		activeIndex = activeIndex < navUrls.length - 1 ? activeIndex + 1 : 0;
		scrollActiveItemIntoView(activeIndex);
		return;
	}

	if (event.key === "ArrowUp") {
		if (navUrls.length === 0) return;
		event.preventDefault();
		if (!isPanelOpen) setPanelVisibility(true, isDesktop);
		activeIndex = activeIndex > 0 ? activeIndex - 1 : navUrls.length - 1;
		scrollActiveItemIntoView(activeIndex);
		return;
	}

	if (event.key === "Enter") {
		if (isPanelOpen && activeIndex >= 0 && activeIndex < navUrls.length) {
			event.preventDefault();
			const targetUrl = navUrls[activeIndex];
			closeSearchPanel();
			navigateToPage(targetUrl);
			return;
		}
		if (currentKeyword) {
			event.preventDefault();
			closeSearchPanel();
			navigateToPage(getSearchUrl(currentKeyword));
		}
	}
};

// --- Core Search Logic ---
const search = async (keyword: string, isDesktop: boolean): Promise<void> => {
	if (!keyword) {
		cancelPendingSearch();
		setPanelVisibility(false, isDesktop);
		result = [];
		return;
	}
	if (!initialized) return;

	clearTimeout(debounceTimer);
	const requestId = ++searchRequestId;
	isSearching = true;
	activeIndex = -1;

	debounceTimer = setTimeout(async () => {
		try {
			let searchResults: SearchResult[] = [];

			if (import.meta.env.PROD && window.pagefind) {
				const response = await window.pagefind.search(keyword);
				searchResults = await Promise.all(
					response.results.map((item) => item.data()),
				);
			} else if (import.meta.env.DEV) {
				searchResults = fakeResult;
			}

			if (requestId !== searchRequestId) return;

			result = searchResults;
			activeIndex = -1;
			setPanelVisibility(true, isDesktop);
		} catch (error) {
			if (requestId !== searchRequestId) return;

			console.error("Search error:", error);
			result = [];
			activeIndex = -1;
			setPanelVisibility(false, isDesktop);
		} finally {
			if (requestId === searchRequestId) {
				isSearching = false;
			}
		}
	}, 300); // 300ms debounce
};

// --- Initialization onMount ---
onMount(() => {
	const initializePagefind = () => {
		initialized = true;
		if (keywordDesktop) search(keywordDesktop, true);
		if (keywordMobile) search(keywordMobile, false);
	};

	if (import.meta.env.DEV) {
		console.log("Pagefind mock enabled in development mode.");
		initializePagefind();
	} else {
		if (window.pagefind) {
			// If script already loaded
			initializePagefind();
		} else {
			// Listen for the event
			document.addEventListener("pagefindready", initializePagefind, {
				once: true,
			});
			document.addEventListener("pagefindloaderror", initializePagefind, {
				once: true,
			});
		}
	}

	const panel = document.getElementById("search-panel");
	panel?.addEventListener(FLOATING_PANEL_CLOSE_EVENT, cancelPendingSearch);

	return () => {
		panel?.removeEventListener(FLOATING_PANEL_CLOSE_EVENT, cancelPendingSearch);
		document.removeEventListener("pagefindready", initializePagefind);
		document.removeEventListener("pagefindloaderror", initializePagefind);
		cancelPendingSearch();
	};
});

// --- Reactive Statements ---
$: visibleResults = result.slice(0, 5);
$: hasViewMore = result.length > 5;
$: navUrls = isSearching
	? []
	: [
			...visibleResults.map((item) => item.url),
			...(hasViewMore ? [getSearchUrl(keywordDesktop || keywordMobile)] : []),
		];

$: if (initialized && (keywordDesktop || keywordDesktop === "")) {
	search(keywordDesktop, true);
}
$: if (initialized && (keywordMobile || keywordMobile === "")) {
	search(keywordMobile, false);
}
</script>

<!-- search bar for desktop view -->
<div id="search-bar" class="hidden lg:flex transition-all items-center h-11 mr-2 rounded-lg
      bg-black/4 hover:bg-black/6 focus-within:bg-black/6
      dark:bg-white/5 dark:hover:bg-white/10 dark:focus-within:bg-white/10
">
	<Icon
		icon="material-symbols:search"
		class="absolute text-[1.25rem] pointer-events-none ml-3 transition my-auto text-black/30 dark:text-white/30"
	/>
	<input
		id="search-input-desktop"
		placeholder={i18n(I18nKey.search)}
		bind:value={keywordDesktop}
		aria-controls="search-panel"
		data-floating-panel-no-expanded
		on:focus={handleDesktopFocus}
		on:keydown={(e) => handleKeydown(e, true)}
		class="transition-all pl-10 text-sm bg-transparent outline-0
         h-full w-40 active:w-60 focus:w-60 text-black/50 dark:text-white/50"
	/>
</div>

<!-- toggle btn for phone/tablet view -->
<button
	on:click={togglePanel}
	aria-label="Search Panel"
	aria-controls="search-panel"
	aria-expanded="false"
	id="search-switch"
	class="btn-plain scale-animation lg:hidden rounded-lg w-11 h-11 active:scale-90"
>
	<Icon icon="material-symbols:search" class="text-[1.25rem]" />
</button>

<!-- search panel -->
<div
	id="search-panel"
	class="float-panel float-panel-closed search-panel absolute md:w-120
top-20 left-4 md:left-[unset] right-4 shadow-2xl rounded-2xl p-2"
	data-floating-panel
	data-floating-panel-trigger="search-switch search-input-desktop"
	inert
	aria-hidden="true"
>
	<!-- search bar inside panel for phone/tablet -->
	<div
		id="search-bar-inside"
		class="flex relative lg:hidden transition-all items-center h-11 rounded-xl
      bg-black/4 hover:bg-black/6 focus-within:bg-black/6
      dark:bg-white/5 dark:hover:bg-white/10 dark:focus-within:bg-white/10
  "
	>
		<Icon
			icon="material-symbols:search"
			class="absolute text-[1.25rem] pointer-events-none ml-3 transition my-auto text-black/30 dark:text-white/30"
		/>
		<input
			placeholder={i18n(I18nKey.search)}
			bind:value={keywordMobile}
			on:focus={requestPagefind}
			on:keydown={(e) => handleKeydown(e, false)}
			class="pl-10 absolute inset-0 text-sm bg-transparent outline-0
               focus:w-60 text-black/50 dark:text-white/50"
		/>
	</div>

	<!-- search results -->
	{#if isSearching}
		<div class="transition first-of-type:mt-2 lg:first-of-type:mt-0 block rounded-xl text-lg px-3 py-2 text-50">
			{i18n(I18nKey.searchLoading)}
		</div>
	{:else if result.length > 0}
		{#each visibleResults as item, index}
			<a
				href={item.url}
				data-search-nav-item
				on:click={(e) => handleResultClick(e, item.url)}
				class="transition first-of-type:mt-2 lg:first-of-type:mt-0 group block
           rounded-xl text-lg px-3 py-2 hover:bg-(--btn-plain-bg-hover) active:bg-(--btn-plain-bg-active)"
				class:search-result-active={activeIndex === index}
			>
				<div
					class="transition text-90 inline-flex font-bold group-hover:text-(--primary)"
					class:text-(--primary)={activeIndex === index}
				>
					{@html item.meta.title}
					<Icon
						icon="fa7-solid:chevron-right"
						class="transition text-[0.75rem] translate-x-1 my-auto text-(--primary)"
					/>
				</div>
				{#if item.excerpt.includes("<mark>")}
					<div class="transition text-sm text-50" style="display: flex; align-items: flex-start; margin-top: 0.1rem">
						<div>
							{@html item.excerpt}
						</div>
					</div>
				{/if}

				{#if item.content && item.content.includes("<mark>")}
					<div class="transition text-sm text-30" style="display: flex; align-items: flex-start; margin-top: 0.1rem">
						<span style="display: inline-block; background-color: var(--btn-plain-bg-active); color: var(--primary); padding: 0.1em 0.4em; border-radius: 5px; font-size: 0.75em; font-weight: 600; margin-right: 0.5em; shrink: 0;">
							{i18n(I18nKey.searchContent)}
						</span>
						<div>
							{@html item.content}
						</div>
					</div>
				{/if}
			</a>
		{/each}
		{#if hasViewMore}
			<a
				href={getSearchUrl(keywordDesktop || keywordMobile)}
				data-search-nav-item
				on:click={(e) => handleResultClick(e, getSearchUrl(keywordDesktop || keywordMobile))}
				class="transition first-of-type:mt-2 lg:first-of-type:mt-0 group block rounded-xl text-lg px-3 py-2 hover:bg-(--btn-plain-bg-hover) active:bg-(--btn-plain-bg-active) text-(--primary) font-bold text-center"
				class:search-result-active={activeIndex === visibleResults.length}
			>
				<span class="inline-flex items-center">
					{i18n(I18nKey.searchViewMore).replace("{count}", (result.length - 5).toString())}
					<Icon icon="fa7-solid:arrow-right" class="transition text-[0.75rem] ml-1" />
				</span>
			</a>
		{/if}
	{:else if result.length === 0}
		<div class="transition first-of-type:mt-2 lg:first-of-type:mt-0 block rounded-xl text-lg px-3 py-2 text-50">
			{i18n(I18nKey.searchNoResults)}
		</div>
	{:else if keywordDesktop || keywordMobile}
		<div class="transition first-of-type:mt-2 lg:first-of-type:mt-0 block rounded-xl text-lg px-3 py-2 text-50">
			{i18n(I18nKey.searchTypeSomething)}
		</div>
	{/if}
</div>

<style>
	input:focus {
		outline: 0;
	}

	.search-panel {
		max-height: calc(100vh - 100px);
		overflow-y: auto;
	}

	.search-result-active {
		background-color: var(--btn-plain-bg-hover);
		box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--primary) 45%, transparent);
	}
</style>
