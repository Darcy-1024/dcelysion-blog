<script lang="ts">
import Icon from "@iconify/svelte";
import { onMount, tick } from "svelte";
import { memosWords as words } from "./memos-words.js";

export let onexpired: () => void = () => {};
let origin = "";
let access = "awaiting-unified-auth";
let loading = true;
let failed = false;
let help = false;
const frameName = `memos-${crypto.randomUUID()}`;
let entering = false;
let entryError = false;
let disposed = false;

export function canLeave() {
	return !origin || access !== "unified-session" || window.confirm(words.leave);
}

async function load() {
	loading = true;
	failed = false;
	try {
		const response = await fetch("/api/memos", { credentials: "same-origin", cache: "no-store" });
		if (disposed) return;
		if (response.status === 401) { onexpired(); failed = true; return; }
		const result = await response.json();
		if (disposed) return;
		if (!response.ok || !result.ok || typeof result.data?.origin !== "string") throw new Error();
		const value = result.data.origin;
		if (value && (new URL(value).origin !== value || new URL(value).protocol !== "https:" || value === window.location.origin)) throw new Error();
		origin = value;
		access = result.data.access;
		loading = false;
		await tick();
		if (origin && access === "unified-session" && !disposed) await enter(frameName);
	} catch {
		if (!disposed) failed = true;
	} finally {
		if (!disposed) loading = false;
	}
}
async function enter(target: string) {
	if (entering) return;
	entering = true;
	entryError = false;
	try {
		const response = await fetch("/api/memos/entry", {
			method: "POST", credentials: "same-origin", cache: "no-store",
			headers: { "content-type": "application/json" }, body: "{}",
		});
		if (disposed) return;
		if (response.status === 401) { onexpired(); throw new Error(); }
		const result = await response.json();
		if (disposed) return;
		if (!response.ok || !result.ok || typeof result.data?.ticket !== "string") throw new Error();
		const form = document.createElement("form");
		form.action = `${origin}/_bridge/entry`;
		form.method = "POST";
		form.target = target;
		if (target === "_blank") form.rel = "noopener";
		const ticket = document.createElement("input");
		ticket.type = "hidden";
		ticket.name = "ticket";
		ticket.value = result.data.ticket;
		form.append(ticket);
		document.body.append(form);
		try { form.submit(); } finally { form.remove(); }
	} catch {
		if (!disposed) { entryError = true; help = true; }
	} finally { if (!disposed) entering = false; }
}
onMount(() => {
	void load();
	return () => { disposed = true; };
});
</script>

<section class="memos-page">
  <div class="heading"><div><p class="eyebrow">LIFE & NOTES</p><h1>{words.title}</h1><p class="muted">{words.intro}</p></div>
    {#if origin && access === 'unified-session'}<button class="memos-open" disabled={entering} onclick={() => void enter('_blank')}>{words.open} ↗</button>{:else}<span class="memos-status">入口待就绪</span>{/if}
  </div>
  {#if loading}<p role="status">正在读取入口…</p>
  {:else if failed}<div class="panel memos-empty"><span class="memos-symbol"><Icon icon="material-symbols:edit-note-rounded" /></span><h2>随时记录新的灵感</h2><p role="alert">{words.unavailable}</p><button onclick={() => void load()}>{words.retry}</button></div>
  {:else if !origin}<div class="panel memos-empty"><span class="memos-symbol"><Icon icon="material-symbols:edit-note-rounded" /></span><h2>{words.unconfigured}</h2><p>{words.setup}</p></div>
  {:else if access !== 'unified-session'}<div class="panel"><h2>{words.authPending}</h2><p>{words.authDetail}</p></div>
  {:else}
    <div class="memos-notice"><p>{words.login} {words.logout}</p><button aria-expanded={help} onclick={() => help = !help}>{words.help}</button>
      {#if entryError}<p role="alert">{words.unavailable}</p>{/if}
      {#if help}<p role="status">{words.hint}</p><button disabled={entering} onclick={() => { if (canLeave()) void enter(frameName); }}>{words.reload}</button>{/if}
    </div>
    <iframe name={frameName} title={words.frame} src="about:blank" referrerpolicy="strict-origin" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox" onerror={() => help = true}></iframe>
  {/if}
</section>

<style>
.memos-page { min-width: 0; }
.heading { display: flex; flex-wrap: wrap; align-items: start; gap: 1rem; justify-content: space-between; }
.memos-open { display: inline-block; white-space: nowrap; padding: .65rem .85rem; border: 1px solid currentColor; border-radius: .65rem; }
.memos-notice { margin: .8rem 0; font-size: .85rem; }
.memos-notice p { margin: .4rem 0; }
iframe { display: block; width: 100%; height: max(32rem, calc(100dvh - 18rem)); border: 1px solid var(--border); border-radius: .75rem; background: var(--surface); }
@media (max-width: 600px) {
  iframe { height: max(30rem, calc(100dvh - 16rem)); border-radius: .35rem; }
  .memos-open { width: 100%; text-align: center; box-sizing: border-box; }
}
.memos-notice{padding:16px 20px;background:var(--accent-soft);color:var(--text-muted);border-radius:16px}.panel{padding:24px}iframe{border-radius:18px;border-color:var(--border)}
.memos-empty{min-height:300px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px}.memos-symbol{display:grid;place-items:center;width:64px;height:64px;background:var(--accent-soft);color:var(--accent);font-size:34px;border-radius:20px}.memos-empty h2{font-size:20px;margin:8px 0 0}.memos-empty p{max-width:560px;color:var(--text-muted);font-size:13px;line-height:1.8;margin:0}.memos-status{padding:7px 12px;border-radius:20px;background:var(--surface);color:var(--text-muted);font-size:12px}.heading .eyebrow{margin:0 0 8px}
</style>
