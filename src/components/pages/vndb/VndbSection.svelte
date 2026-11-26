<script lang="ts">
import ClientPagination from "@/components/common/ClientPagination.svelte";
import FilterControls from "@/components/common/FilterControls.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { NsfwMode } from "@/types/nsfw";
import type { VndbUlistEntry } from "@/types/vndb";
import { filterNsfw, isVndbNsfw } from "@/utils/nsfw-utils";
import Card from "./Card.svelte";

interface Props {
	sectionId: string;
	items: VndbUlistEntry[];
	isActive: boolean;
	itemsPerPage?: number;
	vnBaseUrl?: string;
	nsfw?: NsfwMode; // NSFW 处理："off" | "blur" | "hide"
}

const {
	sectionId,
	items,
	isActive,
	itemsPerPage = 24,
	vnBaseUrl,
	nsfw = "off",
}: Props = $props();

// NSFW 拦截：mode === "hide" 时过滤掉命中条目
const safeItems = $derived(filterNsfw(items, nsfw, isVndbNsfw));

const filterCounts = $derived.by(() => {
	let voted = 0;
	let unvoted = 0;
	let notes = 0;
	for (const item of safeItems) {
		if (item.vote != null) voted += 1;
		else unvoted += 1;
		if (item.notes) notes += 1;
	}
	return { voted, unvoted, notes };
});

const filters = $derived.by(() => {
	const counts = filterCounts;
	return [
		{
			value: "all",
			label: i18n(I18nKey.vndbFilterAll),
			count: safeItems.length,
		},
		{
			value: "voted",
			label: i18n(I18nKey.vndbFilterVoted),
			count: counts.voted,
		},
		{
			value: "unvoted",
			label: i18n(I18nKey.vndbFilterUnvoted),
			count: counts.unvoted,
		},
		{
			value: "notes",
			label: i18n(I18nKey.vndbFilterNotes),
			count: counts.notes,
		},
	].filter((filter) => filter.value === "all" || filter.count > 0);
});

let activeFilter = $state("all");
let searchQuery = $state("");
let currentPage = $state(1);

const normalizedQuery = $derived(searchQuery.trim().toLowerCase());

function matchesSearch(item: VndbUlistEntry, query: string): boolean {
	if (!query) return true;
	const title = item.vn?.title?.toLowerCase() || "";
	const altTitle = item.vn?.alttitle?.toLowerCase() || "";
	const developers = (item.vn?.developers || [])
		.map((dev) => dev.name?.toLowerCase() || "")
		.join(" ");
	const notes = item.notes?.toLowerCase() || "";
	return (
		title.includes(query) ||
		altTitle.includes(query) ||
		developers.includes(query) ||
		notes.includes(query)
	);
}

const filteredItems = $derived.by(() => {
	const query = normalizedQuery;
	return safeItems.filter((item) => {
		if (activeFilter === "voted" && item.vote == null) return false;
		if (activeFilter === "unvoted" && item.vote != null) return false;
		if (activeFilter === "notes" && !item.notes) return false;
		return matchesSearch(item, query);
	});
});

const totalPages = $derived(
	Math.max(1, Math.ceil(filteredItems.length / itemsPerPage)),
);

const pagedItems = $derived(
	filteredItems.slice(
		(currentPage - 1) * itemsPerPage,
		currentPage * itemsPerPage,
	),
);

function handleFilterChange(filter: string) {
	activeFilter = filter;
	currentPage = 1;
}

function handleSearchInput(event: Event) {
	searchQuery = (event.currentTarget as HTMLInputElement).value;
	currentPage = 1;
}

function clearSearch() {
	searchQuery = "";
	currentPage = 1;
}

function goToPage(page: number) {
	if (page >= 1 && page <= totalPages) {
		currentPage = page;
	}
}
</script>

<div class="media-section" class:hidden={!isActive} data-section={sectionId}>
  {#if safeItems.length > 0}
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 mb-4 [&>div:first-child]:mb-0">
      <FilterControls
        filters={filters}
        activeFilter={activeFilter}
        onFilterChange={handleFilterChange}
      />

      <div class="relative w-full sm:w-56 md:w-64 shrink-0">
        <svg
          class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-(--content-meta)"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          oninput={handleSearchInput}
          placeholder={i18n(I18nKey.search)}
          aria-label={i18n(I18nKey.search)}
          class="w-full h-8 pl-8 pr-7 rounded-full text-xs border border-(--line-divider) bg-transparent text-black/90 dark:text-white/90 placeholder:text-(--content-meta) outline-none transition-colors focus:border-(--primary) focus:ring-1 focus:ring-(--primary)"
        />
        {#if searchQuery}
          <button
            type="button"
            onclick={clearSearch}
            aria-label={i18n(I18nKey.announcementClose)}
            class="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full inline-flex items-center justify-center text-(--content-meta) hover:text-(--primary) hover:bg-(--btn-regular-bg-hover) transition-colors cursor-pointer"
          >
            <span aria-hidden="true" class="text-sm leading-none">&times;</span>
          </button>
        {/if}
      </div>
    </div>

    {#if filteredItems.length > 0}
      <div class="media-grid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {#each pagedItems as item (item.id)}
          <div
            class="media-item"
            data-item-section={sectionId}
            data-item-id={item.id}
          >
            <Card item={item} loadImage={isActive} {vnBaseUrl} nsfw={nsfw}/>
          </div>
        {/each}
      </div>

      <ClientPagination
        totalItems={filteredItems.length}
        itemsPerPage={itemsPerPage}
        currentPage={currentPage}
        onPageChange={goToPage}
      />
    {:else}
      <div class="text-center py-12" role="status">
        <p class="text-sm text-(--content-meta)">{i18n(I18nKey.searchNoResults)}</p>
      </div>
    {/if}
  {:else}
    <div class="text-center py-12">
      <h3 class="text-xl font-medium text-gray-600 dark:text-gray-400 mb-2">{i18n(I18nKey.vndbNoData)}</h3>
      <p class="text-gray-500 dark:text-gray-500">{i18n(I18nKey.vndbNoDataDescription)}</p>
    </div>
  {/if}
</div>
