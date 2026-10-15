<script lang="ts">
export let src: string;
export let name: string;
let failed = false;
let previous = src;
$: if (src !== previous) {
	previous = src;
	failed = false;
}
</script>

<span class="user-avatar" aria-hidden="true">
  {#if src && !failed}
    <img {src} alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer" onerror={() => failed = true} />
  {:else}
    {Array.from(name.trim())[0] || "?"}
  {/if}
</span>

<style>
.user-avatar { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex-shrink: 0; overflow: hidden; border-radius: 50%; background: #e8edf4; color: #213047; font-size: 20px; }
img { width: 100%; height: 100%; object-fit: cover; }
</style>
