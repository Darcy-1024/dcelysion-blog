<script lang="ts">
import { afterUpdate, onMount } from "svelte";
import { commentParts } from "./comment-content.js";

export let content: string;
let body: HTMLDivElement;
let expanded = false;
let overflowing = false;
let previous = content;
$: parts = commentParts(content);
$: if (content !== previous) {
	previous = content;
	expanded = false;
}
function measure() {
	if (body && !expanded) overflowing = body.scrollHeight > body.clientHeight + 1;
}
afterUpdate(measure);
onMount(() => {
	const observer = new ResizeObserver(measure);
	observer.observe(body);
	return () => observer.disconnect();
});
</script>

<div class="comment-content">
  <div bind:this={body} class="comment-body" class:collapsed={!expanded}>{#each parts as part}{#if part.type === "text"}{part.text}{:else}<img class="comment-emoji" src={part.src} alt={part.alt} title={part.alt} loading="lazy" referrerpolicy="no-referrer" width="24" height="24" />{/if}{/each}{#if !parts.length}<span class="empty">（空评论）</span>{/if}</div>
  {#if overflowing || expanded}<button class="expand" type="button" aria-expanded={expanded} onclick={() => expanded = !expanded}>{expanded ? "收起正文" : "展开全文"}</button>{/if}
</div>

<style>
.comment-content { min-width: 0; }
.comment-body { color: var(--text); font-size: 16px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.comment-body.collapsed { display: -webkit-box; line-clamp: 5; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.comment-emoji { display: inline-block; width: 1.5em; height: 1.5em; vertical-align: -0.35em; object-fit: contain; }
.empty { color: var(--text-muted); font-size: 14px; }
.expand { display: inline-flex; width: auto; min-height: 36px; padding: 4px 0; border: 0; border-radius: 0; background: transparent; color: var(--accent); font-size: 13px; box-shadow: none; }
.expand:hover { text-decoration: underline; }
</style>
