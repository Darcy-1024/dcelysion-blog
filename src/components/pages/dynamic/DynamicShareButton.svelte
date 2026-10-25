<script lang="ts">
import { onMount } from "svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

const {
	author,
	pubDate,
	url,
	siteTitle,
	entryId,
}: {
	author: string;
	pubDate: string;
	url: string;
	siteTitle: string;
	entryId: string;
} = $props();
let SharePoster = $state<
	typeof import("@/components/misc/SharePoster.svelte").default | null
>(null);
let open = $state(false);
let description = $state("");
let image = $state<string | null>(null);
let avatar = $state<string | null>(null);
let feedback = $state("");
let shareUrl = $state("");
let alive = true;
onMount(() => () => {
	alive = false;
});

async function share() {
	shareUrl = new URL(
		new URL(url, window.location.href).pathname,
		window.location.href,
	).href;
	const root = document.getElementById(entryId);
	const content = root?.querySelector<HTMLElement>("[data-dynamic-content]");
	description = (content?.innerText || "").trim().slice(0, 2000);
	const cover = root?.querySelector<HTMLImageElement>(
		"[data-gallery-grid] img, [data-dynamic-content] img",
	);
	image = cover?.dataset.originalSrc || cover?.currentSrc || cover?.src || null;
	const authorImage = root?.querySelector<HTMLImageElement>(".page-avatar img");
	avatar = authorImage?.currentSrc || authorImage?.src || null;
	try {
		const module = await import("@/components/misc/SharePoster.svelte");
		if (!alive) return;
		SharePoster = module.default;
		open = true;
		feedback = "";
	} catch {
		feedback = i18n(I18nKey.sharePosterFailed);
	}
}
</script>

<button type="button" class="dynamic-share-button" onclick={share}>
	<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M18 16a3 3 0 0 0-2.38 1.18l-6.76-3.9a3.2 3.2 0 0 0 0-2.56l6.76-3.9A3 3 0 1 0 15 5c0 .26.03.51.1.75l-6.77 3.9a3 3 0 1 0 0 4.7l6.77 3.9A3 3 0 1 0 18 16Z" /></svg>
	<span>{i18n(I18nKey.shareDynamic)}</span>
</button>
{#if feedback}<p role="status">{feedback}</p>{/if}
{#if SharePoster && open}
	<SharePoster {author} {description} {pubDate} url={shareUrl} {siteTitle} coverImage={image} {avatar} dynamicMode dateUTC autoOpen hideTrigger onclose={() => { open = false; }} />
{/if}
