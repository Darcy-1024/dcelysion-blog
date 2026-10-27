<script lang="ts">
import Icon from "@iconify/svelte";
import { onMount } from "svelte";
import type { Media, MediaPurpose } from "../shared/media.js";
import { apiMessage, mediaWords as words } from "./i18n.js";

let {
	onselect,
	role,
	purpose,
	onexpired = () => {},
}: {
	onselect?: (media: Media, preview: boolean) => void;
	role?: Media["kind"];
	purpose?: MediaPurpose;
	onexpired?: () => void;
} = $props();
let items = $state<Media[]>([]);
let pageCount = $state(0);
function eligibleCopies(media: Media): number {
	return [media.original, media.preview].filter(object => {
		if (!object || !media.publicKeys?.includes(object.key) || !media.tencentKeys?.includes(object.key)) return false;
		const receipt = media.deliveryReceipts?.[object.key];
		return receipt?.sha256 === object.sha256 && receipt.size === object.size && receipt.mime === object.mime;
	}).length;
}
let trash = $state(false);
// svelte-ignore state_referenced_locally
let kind = $state<string>(role || "all");
let page = $state(1);
let error = $state("");
let busy = $state(false);
let loading = $state(true);
let loaded = $state(false);
let uploading = $state(false);
let syncConfigured = $state(false);
let purposes = $state<MediaPurpose[]>([]);
// svelte-ignore state_referenced_locally
let uploadPurpose = $state<MediaPurpose>(purpose || "article");
const purposeConfigured = $derived(purposes.includes(uploadPurpose));
function accepts(media: Media) {
	return (!role || media.kind === role) && (!purpose || !media.purpose || media.purpose === purpose);
}
let progress = $state<number | null>(null);
let references = $state<{ kind: string; ref_id: string }[] | null>(null);
let referenceId = $state("");
let selectedFile = $state<File | null>(null);
let requestId = $state("");
let xhr: XMLHttpRequest | null = null;
let fileInput: HTMLInputElement;
let active = true;
function stateWord(value: string) {
	return words[value as keyof typeof words] || value;
}
async function call(path: string, post = false) {
	const response = await fetch(path, {
		credentials: "same-origin",
		cache: "no-store",
		...(post ? { method: "POST" } : {}),
	});
	const result = await response.json();
	if (!result.ok) {
		if (result.error.code === "UNAUTHORIZED") onexpired();
		throw new Error(apiMessage(result.error));
	}
	return result.data;
}
async function load() {
	loading = true;
	error = "";
	try {
		const result = await call(
			`/api/library?trash=${trash ? 1 : 0}&type=${kind}&purpose=${purpose || "all"}&page=${page}`,
		);
		if (active) {
			loaded = true;
			pageCount = result.items.length;
			items = result.items.filter(accepts);
			syncConfigured = result.info.syncConfigured;
			purposes = result.info.purposes || [];
		}
	} catch (cause) {
		if (active) error = (cause as Error).message;
	} finally {
		if (active) loading = false;
	}
}
async function action(media: Media, command: string) {
	busy = true;
	error = "";
	try {
		if (command === "references") {
			const result = await call(`/api/library/${media.id}/references`);
			references = result.refs;
			referenceId = media.id;
		} else {
			await call(`/api/library/${media.id}/${command}`, true);
			await load();
		}
	} catch (cause) {
		error = (cause as Error).message;
	} finally {
		busy = false;
	}
}
async function upload() {
	if (!selectedFile || uploading || !purposeConfigured) return;
	uploading = true;
	error = "";
	progress = 0;
	requestId ||= crypto.randomUUID();
	const file = selectedFile;
	try {
		await new Promise<void>((accept, reject) => {
			const request = new XMLHttpRequest();
			xhr = request;
			request.open("POST", "/api/library/upload");
			request.timeout = 600000;
			request.setRequestHeader("content-type", "application/octet-stream");
			request.setRequestHeader("x-media-request", requestId);
			request.setRequestHeader("x-media-name", encodeURIComponent(file.name));
			request.setRequestHeader("x-media-purpose", uploadPurpose);
			request.upload.onprogress = (event) => {
				if (active)
					progress = event.lengthComputable
						? Math.round((event.loaded * 100) / event.total)
						: null;
			};
			request.onload = () => {
				try {
					const result = JSON.parse(request.responseText);
					if (!result.ok) {
						if (result.error.code === "UNAUTHORIZED") onexpired();
						reject(new Error(apiMessage(result.error)));
					} else accept();
				} catch {
					reject(new Error(apiMessage({ code: "NETWORK" })));
				}
			};
			request.onerror = request.ontimeout = () =>
				reject(new Error(apiMessage({ code: "NETWORK" })));
			request.onabort = () => reject(new Error(words.cancel));
			request.send(file);
		});
		selectedFile = null;
		fileInput.value = "";
		requestId = "";
		await load();
	} catch (cause) {
		if (active) error = (cause as Error).message;
	} finally {
		if (active) {
			uploading = false;
			progress = null;
		}
		xhr = null;
	}
}
onMount(() => {
	void load();
	const timer = setInterval(() => {
		if (
			items.some(
				(m) =>
					["queued", "running"].includes(m.privateCopy) ||
					m.local === "uploading",
			)
		)
			void load();
	}, 2000);
	return () => {
		active = false;
		clearInterval(timer);
		xhr?.abort();
	};
});
</script>
<section class="media-library" aria-label={words.title}>
 <header class="heading"><div><p class="eyebrow">ASSET COLLECTION</p><h2>{words.title}</h2><p class="muted">集中收藏图片、音乐与视频，为下一次创作准备素材。</p></div><div class="editor-actions"><button onclick={() => { trash = !trash; page = 1; references = null; void load(); }}>{trash ? words.library : words.trash}</button><button disabled={loading} onclick={() => void load()}>{words.refresh}</button></div></header>
 <div class="media-workspace"><section class="media-upload-panel panel" aria-label="上传素材"><div class="upload-intro"><span class="upload-symbol"><Icon icon="material-symbols:cloud-upload-outline-rounded" /></span><h3>添加素材</h3><p class="muted">选择用途，再上传文件。</p></div>
 <label>{words.purpose}<select bind:value={uploadPurpose} disabled={!!purpose || uploading || !!requestId}>{#each ["article", "gallery", "wallpaper", "music"] as value}<option value={value}>{stateWord(value)}</option>{/each}</select></label>

 <div class="media-upload"><label>{words.upload}<input bind:this={fileInput} type="file" accept=".jpg,.jpeg,.png,.webp,.avif,.gif,.mp3,.wav,.flac,.mp4,.txt,.lrc" disabled={uploading || !purposeConfigured} onchange={(event) => { selectedFile = event.currentTarget.files?.[0] || null; requestId = ""; }} /></label><button class="primary" disabled={!selectedFile || uploading || !purposeConfigured} onclick={() => void upload()}>{requestId ? words.retryUpload : words.upload}</button>{#if uploading}<button onclick={() => xhr?.abort()}>{words.cancel}</button><span role="status">{progress === 100 ? words.processing : `已发送 ${progress ?? "—"}%（传输进度）`}</span>{/if}</div>
 {#if !loading && !purposeConfigured}<p class="upload-unavailable">上传暂不可用，等待配置存储目标。</p>{/if}<details class="media-help"><summary>格式与存储说明</summary><p>{words.types}</p><p>{words.note}</p>{#if loaded && !syncConfigured}<p>{words.notConfigured}</p>{/if}{#if loaded && !purposeConfigured}<p>{words.purposeNotConfigured}</p>{/if}</details></section><section class="media-results panel" aria-label="素材列表" aria-busy={loading}><div class="media-filter"><div><h3>{trash ? '回收站' : '素材一览'}</h3><small>{loading ? "正在读取…" : error ? "暂不可用" : `${items.length} 项 · 当前页`}</small></div>
 <label>类型<select bind:value={kind} disabled={!!role} onchange={() => { page = 1; void load(); }}>{#each ["all", "image", "audio", "video", "text"] as type}<option value={type}>{stateWord(type)}</option>{/each}</select></label>
 </div>{#if error}<div class="media-empty" role="alert"><Icon icon="material-symbols:cloud-off-outline-rounded" /><h3>暂时无法读取素材</h3><p>{error}</p><p class="muted">已有素材不会因此被删除，请稍后重试。</p></div>{:else if loading && !items.length}<div class="media-empty" role="status"><p>正在加载素材…</p></div>{:else if !items.length}<div class="media-empty"><Icon icon="material-symbols:photo-library-outline-rounded" /><h3>{trash ? '回收站是空的' : '这里还没有素材'}</h3><p>{trash ? '移入回收站的素材会显示在这里。' : '上传第一份素材，或切换类型查看已有收藏。'}</p></div>{/if}
 <div class="media-grid">{#each items as media (media.id)}<article class="media-card">
  {#if media.kind === "image" && media.local === "ready"}<img src={`/api/library/${media.id}/preview`} alt={media.name} loading="lazy" />{/if}
  <strong>{media.name}</strong><small>{media.purpose ? stateWord(media.purpose) : words.legacyPurpose} · {media.kind} · {(media.original.size / 1024 / 1024).toFixed(2)} MiB {media.width ? `· ${media.width}×${media.height}` : ""}</small>
  <details class="media-copy-state"><summary>存储与同步状态</summary><p>{words.local}：{stateWord(media.local)}<br />{words.private}：{stateWord(media.privateCopy)}<br />{words.public}：{stateWord(media.publicCopy)}<br />{words.dualEligibility}：{eligibleCopies(media)} / {media.preview ? 2 : 1}</p>
  <small>{stateWord(media.stage)} · 尝试 {media.attempt}</small></details>{#if media.error}<p class="error">{apiMessage({ code: media.error })}</p>{/if}
  {#if media.local === "ready" && media.kind === "audio"}<audio controls preload="none" src={`/api/library/${media.id}/original`}></audio>{:else if media.local === "ready" && media.kind === "video"}<!-- svelte-ignore a11y_media_has_caption --><video controls preload="none" src={`/api/library/${media.id}/original`}></video>{/if}
  <div class="editor-actions">{#if onselect && !trash && media.local === "ready"}<button onclick={() => onselect?.(media, false)}>{words.original}</button>{#if media.preview}<button onclick={() => onselect?.(media, true)}>{words.preview}</button>{/if}{/if}{#if media.local === "ready"}<a href={`/api/library/${media.id}/original`} target="_blank" rel="noreferrer">{words.protected}</a>{/if}{#if media.privateCopy === "failed" && media.local === "ready"}<button disabled={busy} onclick={() => void action(media, "retry")}>{words.syncRetry}</button>{/if}<button disabled={busy} onclick={() => void action(media, trash ? "restore" : "trash")}>{trash ? words.restore : words.remove}</button><button disabled={busy} onclick={() => void action(media, "references")}>{words.references}</button></div>
 </article>{/each}</div>
 {#if references}<details open><summary>引用 · {referenceId}</summary>{#each references as reference}<p><code>{reference.kind} · {reference.ref_id}</code></p>{/each}{#if !references.length}<p>没有已登记引用，仍不能证明历史无引用。</p>{/if}</details>{/if}
 <details class="media-help"><summary>文件保留说明</summary><p>{words.cleanup}</p></details>{#if page > 1 || pageCount >= 30}<div class="editor-actions"><button disabled={page === 1} onclick={() => { page--; void load(); }}>{words.prev}</button><span>{page}</span><button disabled={pageCount < 30} onclick={() => { page++; void load(); }}>{words.next}</button></div>{/if}
</section></div></section>
<style>
.media-library { margin-top: 1rem; } h2 { margin: 0; } .media-upload { display: flex; flex-wrap: wrap; align-items: end; gap: .7rem; margin: 1rem 0; } .media-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,240px),1fr)); gap: .8rem; margin-top: 1rem; } .media-card { border: 1px solid var(--border); border-radius: .7rem; padding: .8rem; min-width: 0; overflow-wrap: anywhere; } .media-card img { width: 100%; height: 140px; object-fit: contain; background: var(--surface-soft); } .media-card strong,.media-card small { display: block; } .media-card audio,.media-card video { width: 100%; } input[type=file] { max-width: 100%; } .media-card p { line-height: 1.7; } code { overflow-wrap: anywhere; }
.media-library{padding:24px;margin-top:0}.media-library h2{margin-right:auto;font-size:22px}.media-upload{padding:20px;border:1px dashed var(--focus);border-radius:16px;background:var(--accent-soft);gap:16px}.media-upload label{display:grid;gap:10px;min-width:0;flex:1}.media-help{margin-bottom:18px;color:var(--text-muted);font-size:13px}.media-help summary{cursor:pointer}.media-card{background:var(--surface);border-color:var(--border);border-radius:16px;padding:16px}.media-card img{height:180px;border-radius:10px;margin-bottom:12px;background:var(--surface-soft)}.media-card small{color:var(--text-muted);margin-top:6px}.media-card strong{font-size:14px}.media-card .editor-actions{border-top:1px solid var(--border);padding-top:12px}.media-card .editor-actions button{font-size:12px;padding:7px 10px}@media(max-width:760px){.media-library{padding:16px}.media-upload{padding:14px}}
.media-library{padding:0}.heading{margin-bottom:24px}.heading h2{font-size:28px;margin:0 0 8px}.heading .eyebrow{margin:0 0 8px}.heading .editor-actions{margin:0}.media-workspace{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:22px;align-items:start}.media-upload-panel{grid-column:2;grid-row:1;padding:24px}.media-results{grid-column:1;grid-row:1;min-width:0;padding:24px}.upload-intro{text-align:center;margin-bottom:22px}.upload-symbol{display:grid;place-items:center;margin:0 auto 14px;width:56px;height:56px;background:var(--accent-soft);color:var(--accent);border-radius:18px;font-size:28px}h3{font-size:16px;margin:0 0 8px}.media-upload-panel>label{display:grid;gap:8px;font-size:13px}.media-upload{display:grid;padding:16px 12px;border-color:var(--border);background:var(--surface-soft)}.media-upload label{overflow-wrap:anywhere}.media-upload input{width:100%;min-width:0;padding:0;border:0;font-size:12px}.upload-unavailable{padding:10px 12px;border-radius:10px;background:var(--warning-bg);color:var(--warning);font-size:12px}.media-help{line-height:1.8;margin-top:18px}.media-copy-state{font-size:12px;color:var(--text-muted);margin-top:14px}.media-copy-state summary{cursor:pointer}.media-filter{display:flex;justify-content:space-between;gap:16px;align-items:center;padding-bottom:20px;border-bottom:1px solid var(--border)}.media-filter small{font-size:12px;color:var(--text-muted)}.media-filter label{display:flex;align-items:center;gap:8px;font-size:12px}.media-empty{min-height:320px;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;padding:30px 16px;gap:8px;color:var(--text-muted)}.media-empty :global(svg){font-size:42px;color:var(--accent);margin-bottom:14px}.media-empty h3{color:var(--text)}.media-empty p{font-size:13px;margin:0;line-height:1.7}@media(max-width:1100px){.media-workspace{grid-template-columns:minmax(0,1fr)}.media-upload-panel{grid-column:1;grid-row:2}.media-results{grid-row:1}.media-empty{min-height:240px}}@media(max-width:600px){.media-results,.media-upload-panel{padding:18px}.media-filter{flex-wrap:wrap}.heading h2{font-size:25px}}
.media-library, .media-upload-panel, .heading > div, .media-filter > div { min-width: 0; }
.media-library { overflow-wrap: anywhere; }
.media-upload { grid-template-columns: minmax(0, 1fr); }
.media-upload input { max-width: 100%; }
.media-card audio, .media-card video { display: block; min-width: 0; max-width: 100%; }
.media-card .editor-actions > a { max-width: 100%; overflow-wrap: anywhere; }
@media (max-width: 760px) {
 .heading { align-items: flex-start; }
 .heading > div { flex-basis: 100%; }
 .heading .editor-actions { width: 100%; }
 .heading .editor-actions button { flex: 1; }
 .media-workspace { gap: 16px; }
 .media-results, .media-upload-panel { padding: 16px; }
 .media-card { padding: 12px; }
 .media-filter { gap: 12px; flex-wrap: wrap; }
 .media-filter label { min-width: 0; flex: 1 1 100%; justify-content: space-between; }
 .media-filter select { min-width: 0; max-width: calc(100% - 40px); }
 .media-card .editor-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; gap: 8px; }
 .media-card .editor-actions button, .media-card .editor-actions > a { min-width: 0; white-space: normal; text-align: center; }
 .media-card .editor-actions > a { display: flex; align-items: center; justify-content: center; }
 .media-upload input { font-size: 16px; }
 .media-upload input::file-selector-button { max-width: 100%; white-space: normal; }
}
</style>
