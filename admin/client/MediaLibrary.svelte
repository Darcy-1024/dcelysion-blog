<script lang="ts">
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
	try {
		const result = await call(
			`/api/library?trash=${trash ? 1 : 0}&type=${kind}&purpose=${purpose || "all"}&page=${page}`,
		);
		if (active) {
			pageCount = result.items.length;
			items = result.items.filter(accepts);
			syncConfigured = result.info.syncConfigured;
			purposes = result.info.purposes || [];
		}
	} catch (cause) {
		if (active) error = (cause as Error).message;
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
<section class="panel media-library" aria-label={words.title}>
 <div class="editor-actions"><h2>{words.title}</h2><button onclick={() => { trash = !trash; page = 1; references = null; void load(); }}>{trash ? words.library : words.trash}</button><button onclick={() => void load()}>{words.refresh}</button></div>
 <p class="muted">{words.note}</p><p class="muted">{words.types}</p>
 {#if !syncConfigured}<p class="error">{words.notConfigured}</p>{/if}
 <label>{words.purpose}<select bind:value={uploadPurpose} disabled={!!purpose || uploading || !!requestId}>{#each ["article", "gallery", "wallpaper", "music"] as value}<option value={value}>{stateWord(value)}</option>{/each}</select></label>
 {#if !purposeConfigured}<p class="error">{words.purposeNotConfigured}</p>{/if}
 <div class="media-upload"><label>{words.upload}<input bind:this={fileInput} type="file" accept=".jpg,.jpeg,.png,.webp,.avif,.gif,.mp3,.wav,.flac,.mp4,.txt,.lrc" disabled={uploading || !purposeConfigured} onchange={(event) => { selectedFile = event.currentTarget.files?.[0] || null; requestId = ""; }} /></label><button class="primary" disabled={!selectedFile || uploading || !purposeConfigured} onclick={() => void upload()}>{requestId ? words.retryUpload : words.upload}</button>{#if uploading}<button onclick={() => xhr?.abort()}>{words.cancel}</button><span role="status">{progress === 100 ? words.processing : `已发送 ${progress ?? "—"}%（传输进度）`}</span>{/if}</div>
 <label>类型<select bind:value={kind} disabled={!!role} onchange={() => { page = 1; void load(); }}>{#each ["all", "image", "audio", "video", "text"] as type}<option value={type}>{stateWord(type)}</option>{/each}</select></label>
 {#if error}<p class="error" role="alert">{error}</p>{/if}
 {#if !items.length}<p>{words.empty}</p>{/if}
 <div class="media-grid">{#each items as media (media.id)}<article class="media-card">
  {#if media.kind === "image" && media.local === "ready"}<img src={`/api/library/${media.id}/preview`} alt={media.name} loading="lazy" />{/if}
  <strong>{media.name}</strong><small>{media.purpose ? stateWord(media.purpose) : words.legacyPurpose} · {media.kind} · {(media.original.size / 1024 / 1024).toFixed(2)} MiB {media.width ? `· ${media.width}×${media.height}` : ""}</small>
  <p>{words.local}：{stateWord(media.local)}<br />{words.private}：{stateWord(media.privateCopy)}<br />{words.public}：{stateWord(media.publicCopy)}<br />{words.dualEligibility}：{eligibleCopies(media)} / {media.preview ? 2 : 1}</p>
  <small>{stateWord(media.stage)} · 尝试 {media.attempt}</small>{#if media.error}<p class="error">{apiMessage({ code: media.error })}</p>{/if}
  {#if media.local === "ready" && media.kind === "audio"}<audio controls preload="none" src={`/api/library/${media.id}/original`}></audio>{:else if media.local === "ready" && media.kind === "video"}<!-- svelte-ignore a11y_media_has_caption --><video controls preload="none" src={`/api/library/${media.id}/original`}></video>{/if}
  <div class="editor-actions">{#if onselect && !trash && media.local === "ready"}<button onclick={() => onselect?.(media, false)}>{words.original}</button>{#if media.preview}<button onclick={() => onselect?.(media, true)}>{words.preview}</button>{/if}{/if}{#if media.local === "ready"}<a href={`/api/library/${media.id}/original`} target="_blank" rel="noreferrer">{words.protected}</a>{/if}{#if media.privateCopy === "failed" && media.local === "ready"}<button disabled={busy} onclick={() => void action(media, "retry")}>{words.syncRetry}</button>{/if}<button disabled={busy} onclick={() => void action(media, trash ? "restore" : "trash")}>{trash ? words.restore : words.remove}</button><button disabled={busy} onclick={() => void action(media, "references")}>{words.references}</button></div>
 </article>{/each}</div>
 {#if references}<details open><summary>引用 · {referenceId}</summary>{#each references as reference}<p><code>{reference.kind} · {reference.ref_id}</code></p>{/each}{#if !references.length}<p>没有已登记引用，仍不能证明历史无引用。</p>{/if}</details>{/if}
 <p class="muted">{words.cleanup}</p><div class="editor-actions"><button disabled={page === 1} onclick={() => { page--; void load(); }}>{words.prev}</button><span>{page}</span><button disabled={pageCount < 30} onclick={() => { page++; void load(); }}>{words.next}</button></div>
</section>
<style>
.media-library { margin-top: 1rem; } h2 { margin: 0; } .media-upload { display: flex; flex-wrap: wrap; align-items: end; gap: .7rem; margin: 1rem 0; } .media-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,240px),1fr)); gap: .8rem; margin-top: 1rem; } .media-card { border: 1px solid #8883; border-radius: .7rem; padding: .8rem; min-width: 0; overflow-wrap: anywhere; } .media-card img { width: 100%; height: 140px; object-fit: contain; background: #8881; } .media-card strong,.media-card small { display: block; } .media-card audio,.media-card video { width: 100%; } input[type=file] { max-width: 100%; } .media-card p { line-height: 1.7; } code { overflow-wrap: anywhere; }
</style>
