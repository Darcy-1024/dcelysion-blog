<script lang="ts">
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { NsfwMode } from "@/types/nsfw";
import type { VndbUlistEntry } from "@/types/vndb";
import { getFailedCovers, markCoverFailed } from "@/utils/failed-covers";
import { isVndbNsfw } from "@/utils/nsfw-utils";
import {
	formatVndbLength,
	getVndbStatusText,
	normalizeVndbLabel,
} from "@/utils/vndb-utils";

interface Props {
	item: VndbUlistEntry;
	loadImage?: boolean;
	vnBaseUrl?: string;
	nsfw?: NsfwMode; // NSFW 处理："off" | "blur" | "hide"
}

const {
	item,
	loadImage = false,
	vnBaseUrl = "https://vndb.org/",
	nsfw = "off",
}: Props = $props();

const STATUS_COLORS: Record<string, string> = {
	wishlist: "bg-blue-500",
	playing: "bg-yellow-500",
	finished: "bg-green-500",
	stalled: "bg-orange-500",
	dropped: "bg-red-500",
	unknown: "bg-gray-500",
};

const firstLabel = $derived(
	(item.labels || []).find((label) =>
		["wishlist", "playing", "finished", "stalled", "dropped"].includes(
			normalizeVndbLabel(label.label),
		),
	)?.label ||
		(item.labels || []).find(
			(label) => normalizeVndbLabel(label.label) !== "voted",
		)?.label ||
		"",
);
const labelKey = $derived(normalizeVndbLabel(firstLabel));
const statusText = $derived(
	firstLabel
		? getVndbStatusText(labelKey, firstLabel)
		: i18n(I18nKey.vndbStatusUnknown),
);
const statusColor = $derived(STATUS_COLORS[labelKey] || "bg-gray-500");

const title = $derived(item.vn?.alttitle || item.vn?.title || "VNDB");
const altTitle = $derived(
	item.vn?.title && item.vn.title !== title ? item.vn.title : "",
);
const year = $derived(
	item.vn?.released ? item.vn.released.substring(0, 4) : "",
);
const imageUrl = $derived(
	item.vn?.image?.url || item.vn?.image?.thumbnail || "",
);
const imageNsfw = $derived(nsfw === "blur" && isVndbNsfw(item));
const userVote = $derived(item.vote);
const rating = $derived(item.vn?.rating);
const voteCount = $derived(item.vn?.votecount);
const lengthText = $derived(
	formatVndbLength(item.vn?.length, item.vn?.length_minutes),
);
const developerText = $derived(
	(item.vn?.developers || [])
		.slice(0, 2)
		.map((producer) => producer.name)
		.join(" / "),
);
const languageText = $derived(
	(item.vn?.languages || [])
		.slice(0, 4)
		.map((lang) => lang.toUpperCase())
		.join(" / "),
);
const platformText = $derived(
	(item.vn?.platforms || [])
		.slice(0, 4)
		.map((platform) => platform.toUpperCase())
		.join(" / "),
);
const metaText = $derived(
	[developerText, languageText, platformText].filter(Boolean).join(" · "),
);
const notes = $derived(item.notes?.trim() || "");
const playRange = $derived(
	[item.started, item.finished].filter(Boolean).join(" ~ "),
);
const hasDetails = $derived(
	Boolean(notes || altTitle || playRange || metaText),
);
const tags = $derived((item.vn?.tags || []).map((tag) => tag.name));
const visibleTags = $derived(tags.slice(0, 2));
const hiddenTagCount = $derived(
	Math.max((item.vn?.tagCount ?? tags.length) - visibleTags.length, 0),
);
const link = $derived(`${vnBaseUrl}${item.vn?.id || item.id}`);

let expanded = $state(false);

const FAILED_COVERS_KEY = "vndb-failed-covers";

const srcs = $derived(imageUrl ? [imageUrl] : []);
let initialSrc = $state("");

$effect(() => {
	const sources = srcs;
	initialSrc = sources[0] || "";
	if (typeof window === "undefined" || sources.length === 0) return;
	const failed = getFailedCovers(FAILED_COVERS_KEY);
	const firstGood = sources.find((url) => !failed.has(url));
	if (firstGood) initialSrc = firstGood;
});

function handleLoad(e: Event) {
	const img = e.currentTarget as HTMLImageElement;
	img.style.opacity = "1";
	const placeholder = img.parentElement?.querySelector(".lqip-placeholder");
	if (placeholder) placeholder.classList.add("loaded");
}

function handleError(e: Event) {
	const img = e.currentTarget as HTMLImageElement;
	markCoverFailed(img.src, FAILED_COVERS_KEY);
	img.style.display = "none";
}

function toggleExpanded(e: MouseEvent) {
	e.preventDefault();
	e.stopPropagation();
	expanded = !expanded;
}

function handleCardKeydown(e: KeyboardEvent) {
	if (e.key === "Escape" && expanded) {
		e.stopPropagation();
		expanded = false;
	}
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="group relative overflow-hidden rounded-xl transition-all duration-300 hover:shadow-lg hover:scale-[1.02]"
  onkeydown={handleCardKeydown}
>
  <div class="aspect-2/3 relative overflow-hidden">
    {#if initialSrc}
      <div class="lqip-placeholder absolute inset-0 pointer-events-none" style="background: var(--muted)" aria-hidden="true"></div>
      <img
        src={loadImage ? initialSrc : undefined}
        data-src={loadImage ? undefined : initialSrc}
        alt={title}
        class="w-full h-full object-cover pointer-events-none opacity-0 transition-all duration-500 ease-out group-hover:scale-105"
        loading="lazy"
        decoding="async"
        onload={handleLoad}
        onerror={handleError}
        style={imageNsfw ? "filter: blur(20px)" : undefined}
      />
    {:else}
      <div class="w-full h-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
        <div class="text-gray-400 dark:text-gray-500 text-4xl font-bold">VN</div>
      </div>
    {/if}

    {#if !expanded}
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer nofollow"
        aria-label={title}
        class="peer absolute inset-0 z-10 rounded-xl focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:-outline-offset-2"
      ></a>
    {/if}

    <div class="absolute top-2 left-2 z-15 pointer-events-none px-2 py-1 rounded-full text-xs text-white font-medium {statusColor}">
      {statusText}
    </div>

    <div class="absolute top-2 right-2 z-20 flex flex-col items-end gap-1">
      {#if userVote}
        <div class="pointer-events-none px-2 py-1 rounded-full text-xs text-white font-medium bg-black/50 backdrop-blur-sm flex items-center gap-1">
          <span class="text-yellow-400">&#11088;</span>
          {userVote}
        </div>
      {/if}

      {#if notes}
        <button
          type="button"
          onclick={toggleExpanded}
          aria-expanded={expanded}
          aria-label={i18n(I18nKey.vndbFilterNotes)}
          title={i18n(I18nKey.vndbFilterNotes)}
          class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-black/60 hover:bg-black/80 text-amber-200 border border-amber-300/35 backdrop-blur-sm inline-flex items-center gap-1 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-(--primary)"
        >
          <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>{i18n(I18nKey.vndbFilterNotes)}</span>
        </button>
      {:else if hasDetails}
        <button
          type="button"
          onclick={toggleExpanded}
          aria-expanded={expanded}
          aria-label={i18n(I18nKey.projectDetails)}
          title={i18n(I18nKey.projectDetails)}
          class="w-6 h-6 rounded-full bg-black/55 hover:bg-black/80 text-white/90 border border-white/15 backdrop-blur-sm inline-flex items-center justify-center cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-(--primary)"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
        </button>
      {/if}
    </div>

    {#if expanded}
      <div class="absolute inset-0 z-30 bg-black/88 backdrop-blur-md p-3 flex flex-col justify-between text-white">
        <div class="flex items-start justify-between gap-2 pb-2 border-b border-white/15">
          <h3 class="font-bold text-xs sm:text-sm leading-snug line-clamp-2">{title}</h3>
          <button
            type="button"
            onclick={toggleExpanded}
            aria-label={i18n(I18nKey.announcementClose)}
            class="w-6 h-6 shrink-0 rounded-full bg-white/10 hover:bg-white/25 inline-flex items-center justify-center text-white/90 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-(--primary)"
          >
            <span aria-hidden="true" class="text-sm leading-none">&times;</span>
          </button>
        </div>

        <div class="my-2 flex-1 overflow-y-auto space-y-1.5 pr-0.5 text-[11px] leading-relaxed text-white/85">
          {#if altTitle}
            <p class="text-white/75">{altTitle}</p>
          {/if}
          {#if developerText}
            <p class="text-white/80">{developerText}</p>
          {/if}
          {#if languageText || platformText}
            <p class="text-white/70">{[languageText, platformText].filter(Boolean).join(" · ")}</p>
          {/if}
          {#if playRange || voteCount}
            <p class="text-white/75">
              {#if voteCount}<span>{voteCount} {i18n(I18nKey.vndbVotes)}</span>{/if}
              {#if voteCount && playRange} · {/if}
              {#if playRange}<span>{playRange}</span>{/if}
            </p>
          {/if}
          {#if notes}
            <p class="pt-1.5 border-t border-white/15 text-white whitespace-pre-line">{notes}</p>
          {/if}
        </div>

        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer nofollow"
          class="inline-flex items-center justify-center gap-1 w-full py-1.5 px-2.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-medium text-white transition-colors focus-visible:outline-2 focus-visible:outline-(--primary)"
        >
          <span>VNDB</span>
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M7 17 17 7" />
            <path d="M7 7h10v10" />
          </svg>
        </a>
      </div>
    {:else}
      <div class="vndb-scrim absolute inset-0 pointer-events-none transition-opacity duration-300 motion-reduce:transition-none" aria-hidden="true"></div>
      <div class="vndb-scrim-hover absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 peer-focus-visible:opacity-100 transition-opacity duration-300 motion-reduce:transition-none" aria-hidden="true"></div>
      <div class="absolute bottom-0 left-0 right-0 p-3 z-15 pointer-events-none">
        <h3 class="font-bold text-sm text-white line-clamp-2 drop-shadow-[0_1px_5px_rgba(0,0,0,0.9)]">{title}</h3>
        {#if year || lengthText || rating}
          <p class="text-xs text-white/90 mt-1 line-clamp-1 drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]">
            {#if year}{year}{/if}
            {#if year && lengthText} · {/if}
            {#if lengthText}{lengthText}{/if}
            {#if (year || lengthText) && rating} · {/if}
            {#if rating}<span class="text-yellow-300 font-semibold">&#9733; {rating}</span>{/if}
          </p>
        {/if}
        {#if altTitle || playRange || voteCount || metaText || notes}
          <div class="vndb-hover-details max-h-0 opacity-0 overflow-hidden group-hover:max-h-40 group-hover:opacity-100 peer-focus-visible:max-h-40 peer-focus-visible:opacity-100 transition-all duration-300 motion-reduce:transition-none">
            <div class="mt-1.5 pt-1.5 border-t border-white/15 space-y-0.5 text-[11px] leading-snug text-white/80 drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]">
              {#if altTitle}
                <p class="text-white/75 line-clamp-1" title={altTitle}>{altTitle}</p>
              {/if}
              {#if voteCount || playRange}
                <p class="line-clamp-1">
                  {#if voteCount}<span>{voteCount} {i18n(I18nKey.vndbVotes)}</span>{/if}
                  {#if voteCount && playRange} · {/if}
                  {#if playRange}<span>{playRange}</span>{/if}
                </p>
              {/if}
              {#if metaText}
                <p class="line-clamp-2 text-white/75" title={metaText}>{metaText}</p>
              {/if}
              {#if notes}
                <p class="text-white/90 line-clamp-2 pt-0.5" title={notes}>{notes}</p>
              {/if}
            </div>
          </div>
        {/if}
        {#if visibleTags.length > 0}
          <div class="flex flex-wrap gap-1 mt-1.5">
            {#each visibleTags as tag}
              <span class="text-[0.6rem] px-1.5 py-0.5 rounded bg-black/45 border border-white/15 text-white/95 backdrop-blur-sm">{tag}</span>
            {/each}
            {#if hiddenTagCount > 0}
              <span class="text-[0.6rem] px-1.5 py-0.5 rounded bg-black/45 border border-white/15 text-white/75 backdrop-blur-sm">+{hiddenTagCount}</span>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .vndb-scrim {
    background: linear-gradient(
      to top,
      rgba(8, 7, 12, 0.94) 0%,
      rgba(8, 7, 12, 0.72) 24%,
      rgba(8, 7, 12, 0.3) 44%,
      transparent 62%
    );
  }
  .vndb-scrim-hover {
    background: linear-gradient(
      to top,
      rgba(8, 7, 12, 0.96) 0%,
      rgba(8, 7, 12, 0.84) 38%,
      rgba(8, 7, 12, 0.45) 58%,
      transparent 76%
    );
  }
</style>
