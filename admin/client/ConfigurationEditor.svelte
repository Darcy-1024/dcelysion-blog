<script lang="ts">
import { onMount } from "svelte";
import {
	defaultMediaPolicy,
	type MediaPolicy,
} from "../../src/utils/media-contract.js";
import {
	type Album,
	type Configuration,
	type ConfigurationKind,
	type Photo,
	protectedAsset,
	serializeConfiguration,
	settingsFields,
	type Track,
} from "../shared/configuration.js";
import type { DraftDetail } from "../shared/contracts.js";
import { type Media, mediaMarker } from "../shared/media.js";
import { EditorSession, type SaveResult } from "./editor-session.js";
import {
	apiMessage,
	editorWords,
	configurationWords as words,
} from "./i18n.js";
import MediaLibrary from "./MediaLibrary.svelte";
import Publishing from "./Publishing.svelte";

let {
	kind,
	onexpired = () => {},
}: { kind: ConfigurationKind; onexpired?: () => void } = $props();
let detail = $state<DraftDetail | null>(null);
let data = $state<Configuration>({ version: 1 });
let revisions = $state<{ id: string; revision: number; updated_at: string }[]>(
	[],
);
let session = $state.raw<EditorSession | null>(null);
let version = $state(0);
let loading = $state(true);
let operation = $state(false);
let error = $state("");
let selection = $state("");
let picker = $state<{
	record: Track | Album;
	field: string;
	role: Media["kind"];
} | null>(null);
let pendingCreate: {
	requestId: string;
	kind: ConfigurationKind;
	path: string;
	fromSource: true;
} | null = null;
let lyricPreview = $state("");
const mediaPolicy = $derived({
	...defaultMediaPolicy,
	...((data.mediaRouting as Partial<MediaPolicy>) || {}),
});
function updateMediaPolicy(key: string, value: unknown) {
	data.mediaRouting = {
		...(data.mediaRouting ? mediaPolicy : defaultMediaPolicy),
		[key]: value,
	};
	changed();
}
const tracks = $derived(data.tracks || []);
const albums = $derived(data.albums || []);
const selectedTrack = $derived(tracks.find((row) => row.id === selection));
const selectedAlbum = $derived(albums.find((row) => row.id === selection));
const view = $derived.by(() => {
	version;
	return {
		dirty: session?.dirty || false,
		state: session?.state || "saved",
		error: session?.error || "",
		busy: session?.busy || false,
		detail: session?.detail || detail,
	};
});
async function call<T>(path: string, input?: unknown): Promise<T> {
	const result = await (
		await fetch(path, {
			cache: "no-store",
			credentials: "same-origin",
			...(input === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(input),
					}),
		})
	).json();
	if (!result.ok) {
		if (result.error.code === "UNAUTHORIZED") onexpired();
		throw new Error(apiMessage(result.error));
	}
	return result.data;
}
async function list() {
	try {
		revisions = (
			await call<{ items: typeof revisions }>(`/api/drafts?kind=${kind}&page=1`)
		).items;
	} catch (cause) {
		error = (cause as Error).message;
	} finally {
		loading = false;
	}
}
function install(next: DraftDetail) {
	session?.dispose();
	detail = next;
	data = JSON.parse(next.draft.source);
	selection = data.tracks?.[0]?.id || data.albums?.[0]?.id || "";
	picker = null;
	lyricPreview = "";
	session = new EditorSession(
		next,
		async (input) => {
			const result = (await (
				await fetch(`/api/drafts/${next.draft.id}/save`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(input),
					cache: "no-store",
					credentials: "same-origin",
				})
			).json()) as SaveResult;
			if (!result.ok && result.error.code === "UNAUTHORIZED") onexpired();
			return result;
		},
		() => {
			version++;
		},
	);
	version++;
}
export function canLeave() {
	return !session?.dirty || window.confirm(editorWords.leave);
}
function changed() {
	session?.edit(serializeConfiguration($state.snapshot(data)));
	error = "";
}
async function open(id?: string) {
	if (!canLeave()) return;
	operation = true;
	error = "";
	try {
		if (id) install(await call<DraftDetail>(`/api/drafts/${id}`));
		else {
			pendingCreate ||= {
				requestId: crypto.randomUUID(),
				kind,
				path: `${kind}.json`,
				fromSource: true,
			};
			install(await call<DraftDetail>("/api/drafts", pendingCreate));
			pendingCreate = null;
		}
		await list();
	} catch (cause) {
		error = (cause as Error).message;
	} finally {
		operation = false;
	}
}
async function save() {
	await session?.save();
	if (session?.state === "saved") await list();
}
async function copy() {
	if (!session) return;
	operation = true;
	try {
		install(
			await call<DraftDetail>("/api/drafts", {
				requestId: crypto.randomUUID(),
				copyFrom: session.detail.draft.id,
				source: session.source,
			}),
		);
		await list();
	} catch (cause) {
		error = (cause as Error).message;
	} finally {
		operation = false;
	}
}
function move(rows: (Track | Album | Photo)[], index: number, delta: number) {
	const to = index + delta;
	if (to < 0 || to >= rows.length) return;
	rows.splice(to, 0, ...rows.splice(index, 1));
	changed();
}
function add() {
	if (kind === "music") {
		const row: Track = {
			id: `track-${crypto.randomUUID()}`,
			name: "",
			artist: "",
			url: "",
			cover: "",
			lrc: "",
		};
		data.tracks ||= [];
		data.tracks.push(row);
		selection = row.id;
	} else {
		const row: Album = {
			id: `album-${crypto.randomUUID()}`,
			name: "",
			description: "",
			location: "",
			tags: [],
			photos: [],
		};
		data.albums ||= [];
		data.albums.push(row);
		selection = row.id;
	}
	changed();
}
function pick(media: Media) {
	if (!picker || media.kind !== picker.role || media.deleted || (media.purpose && media.purpose !== kind)) {
		error = apiMessage({ code: "MEDIA_ROLE" });
		return;
	}
	if (picker.field === "photos") {
		const album = picker.record as Album;
		if (album.photos === undefined) {
			error = "旧扫描相册须先在可信源码导入显式清单";
			return;
		}
		if (
			album.photos.some((photo) => photo.original === mediaMarker(media.id))
		) {
			error = "该图片已在相册中";
			return;
		}
		const photo: Photo = {
			id: `photo-${crypto.randomUUID()}`,
			original: mediaMarker(media.id),
			...(media.preview ? { preview: mediaMarker(media.id, "preview") } : {}),
			width: media.width,
			height: media.height,
			sha256: media.original.sha256,
			objectKey: media.original.key,
		};
		album.photos.push(photo);
	} else {
		picker.record[picker.field] = mediaMarker(media.id);
		picker = null;
	}
	changed();
}
async function lyrics(track: Track) {
	lyricPreview = "";
	if (!track.lrc) return;
	if (track.lrc.startsWith("[")) {
		lyricPreview = track.lrc;
		return;
	}
	const target = protectedAsset(track.lrc);
	if (!target.startsWith("/api/library/")) {
		lyricPreview = "外部歌词由前台播放器按原地址读取；后台不代理外部文件。";
		return;
	}
	try {
		const response = await fetch(target, {
			credentials: "same-origin",
			cache: "no-store",
		});
		if (!response.ok) {
			if (response.status === 401) onexpired();
			throw new Error("歌词读取失败");
		}
		lyricPreview = await response.text();
	} catch (cause) {
		error = (cause as Error).message;
	}
}
onMount(() => {
	void list();
	const before = (event: BeforeUnloadEvent) => {
		if (session?.dirty) {
			event.preventDefault();
			event.returnValue = "";
		}
	};
	window.addEventListener("beforeunload", before);
	return () => {
		session?.dispose();
		window.removeEventListener("beforeunload", before);
	};
});
</script>

<section class="configuration-page">
 <div class="heading"><div><p class="eyebrow">CONFIGURATION</p><h1>{words[kind]}</h1><p class="muted">{words.note}</p></div><button class="primary" disabled={operation || view.busy} onclick={() => void open()}>{words.current}</button></div>
 {#if error}<p role="alert" class="error">{error}</p>{/if}
 <section class="panel"><h2>私有修订</h2>{#if loading}<p>{words.loading}</p>{:else if !revisions.length}<p>{words.empty}</p>{/if}<div class="configuration-revisions">{#each revisions as revision}<button disabled={operation || view.busy} onclick={() => void open(revision.id)}>{words.reopen} · r{revision.revision} · {new Date(revision.updated_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</button>{/each}</div></section>
 {#if detail}
 <section class="panel configuration-editor"><div class="editor-actions"><strong>r{view.detail?.draft.revision} · {editorWords[view.state]}</strong><button class="primary" disabled={operation || view.busy || !view.dirty || view.state === 'conflict'} onclick={() => void save()}>{words.save}</button>{#if view.state === 'conflict'}<button disabled={operation} onclick={() => void copy()}>{editorWords.copy}</button>{/if}</div>
 {#if view.error}<p class="error" role="alert">{apiMessage({ code: view.error })}</p>{/if}{#if view.state === 'conflict'}<p class="error">保存已停止，当前输入保留。重新打开最新修订或另存私有副本后核对差异；副本仍不能覆盖已变化来源。</p><details><summary>已保存版本与本地输入</summary><div class="publish-diff"><pre>{session?.conflict?.saved.draft.source}</pre><pre>{session?.source}</pre></div></details>{/if}
 {#if kind === 'settings'}
 <fieldset class="configuration-fields"><legend>{words.mediaRouting}</legend>
 <label><input type="checkbox" checked={mediaPolicy.enabled} onchange={event => updateMediaPolicy("enabled", event.currentTarget.checked)} />{words.mediaEnabled}</label>
 <label>{words.mediaMode}<select value={mediaPolicy.mode} onchange={event => updateMediaPolicy("mode",event.currentTarget.value)}><option value="auto">auto</option><option value="r2">R2</option><option value="tencent">Tencent</option></select></label>
 <label>{words.mediaDefault}<select value={mediaPolicy.defaultSource} onchange={event => updateMediaPolicy("defaultSource",event.currentTarget.value)}><option value="r2">R2</option><option value="tencent">Tencent</option></select></label>
 <label>{words.mediaTimeout}<input type="number" min="500" max="5000" value={mediaPolicy.timeoutMs} onchange={event => updateMediaPolicy("timeoutMs",Number(event.currentTarget.value))} /></label>
 <label>{words.mediaBytes}<input type="number" min="4096" max="65536" value={mediaPolicy.probeBytes} onchange={event => updateMediaPolicy("probeBytes",Number(event.currentTarget.value))} /></label>
 <label>{words.mediaAdvantage}<input type="number" min="0.1" max="0.5" step="0.05" value={mediaPolicy.minimumAdvantage} onchange={event => updateMediaPolicy("minimumAdvantage",Number(event.currentTarget.value))} /></label>
 <p class="muted">{words.mediaBoundary}</p></fieldset>
  <div class="configuration-fields">{#each settingsFields as key}<label>{words.settingsFields[key]}{#if key === 'keywords'}<textarea rows="5" value={data.keywords?.join('\n') || ''} oninput={(event) => {data.keywords = event.currentTarget.value ? event.currentTarget.value.split('\n') : []; changed();}}></textarea>{:else if key === 'description'}<textarea rows="3" bind:value={data.description} oninput={changed}></textarea>{:else}<input bind:value={data[key]} oninput={changed} />{/if}</label>{/each}</div><p class="muted">{words.readonly}</p>
 {:else}
  <div class="configuration-columns"><div class="configuration-list"><button onclick={add}>{kind === 'music' ? words.addTrack : words.addAlbum}</button>{#each kind === 'music' ? tracks : albums as row, index (row.id)}<article class:active={selection === row.id}><button class="configuration-select" onclick={() => {selection=row.id;picker=null;lyricPreview='';}}>{index+1}. {row.name || '（未命名）'}</button><div class="editor-actions"><button aria-label={`${row.name}上移`} disabled={index===0} onclick={() => move(kind==='music'?tracks:albums,index,-1)}>{words.up}</button><button aria-label={`${row.name}下移`} disabled={index===(kind==='music'?tracks:albums).length-1} onclick={() => move(kind==='music'?tracks:albums,index,1)}>{words.down}</button><button onclick={() => { (kind==='music'?tracks:albums).splice(index,1); if(selection===row.id) selection='';changed();}}>{words.remove}</button></div></article>{/each}</div>
  <div class="configuration-fields">
  {#if selectedTrack}<p class="muted">稳定 ID：{selectedTrack.id}</p><label>曲名<input bind:value={selectedTrack.name} oninput={changed} /></label><label>作者<input bind:value={selectedTrack.artist} oninput={changed} /></label><label>音频地址<input bind:value={selectedTrack.url} oninput={changed} /></label><button onclick={() => picker={record:selectedTrack!,field:'url',role:'audio'}}>{words.select} · 音频</button><label>封面地址<input bind:value={selectedTrack.cover} oninput={changed} /></label><button onclick={() => picker={record:selectedTrack!,field:'cover',role:'image'}}>{words.select} · 封面</button><label>歌词（LRC 内容或文件地址）<textarea rows="4" bind:value={selectedTrack.lrc} oninput={changed}></textarea></label><button onclick={() => picker={record:selectedTrack!,field:'lrc',role:'text'}}>{words.select} · 歌词</button><div class="configuration-audition">{#if selectedTrack.cover}<img alt="歌曲封面预览" src={protectedAsset(selectedTrack.cover)} />{/if}{#key selectedTrack.url}<audio aria-label="歌曲试听" controls preload="none" src={protectedAsset(selectedTrack.url)}></audio>{/key}</div><button onclick={() => void lyrics(selectedTrack!)}>查看歌词</button>{#if lyricPreview}<pre class="configuration-lyrics">{lyricPreview}</pre>{/if}
  {:else if selectedAlbum}<p class="muted">相册 ID / URL：{selectedAlbum.id}</p><label>相册标题<input bind:value={selectedAlbum.name} oninput={changed} /></label><label>描述<textarea rows="3" bind:value={selectedAlbum.description} oninput={changed}></textarea></label><label>日期<input type="date" bind:value={selectedAlbum.date} oninput={changed} /></label><label>地点<input bind:value={selectedAlbum.location} oninput={changed} /></label><label>标签（每行一个）<textarea rows="3" value={selectedAlbum.tags?.join('\n') || ''} oninput={(event) => {selectedAlbum!.tags=event.currentTarget.value?event.currentTarget.value.split('\n'):[];changed();}}></textarea></label><label>封面地址（留空使用自动封面）<input bind:value={selectedAlbum.cover} oninput={changed} /></label><button onclick={() => picker={record:selectedAlbum!,field:'cover',role:'image'}}>{words.select} · 封面</button>{#if selectedAlbum.cover}<img class="configuration-cover" alt="相册封面预览" src={protectedAsset(selectedAlbum.cover)} />{/if}<p class="muted">相册密码只是页面展示保护。移除图片只移除引用，不删除原件；历史 release 继续保留。</p>{#if selectedAlbum.photos === undefined}<p>兼容目录扫描 / urls.txt（只读图片来源）。请在可信源码导入显式清单后管理图片。</p>{:else}<button onclick={() => picker={record:selectedAlbum!,field:'photos',role:'image'}}>{words.select} · 批量添加图片</button><div class="configuration-photos">{#each selectedAlbum.photos as photo,index (photo.id)}<article><a href={protectedAsset(photo.original)} target="_blank" rel="noreferrer"><img alt={`图片 ${index+1}`} loading="lazy" src={protectedAsset(photo.preview || photo.original)} /></a><small>{index+1} · {photo.width || '—'}×{photo.height || '—'}</small><div class="editor-actions"><button disabled={index===0} onclick={() => move(selectedAlbum!.photos!,index,-1)}>{words.up}</button><button disabled={index===selectedAlbum.photos.length-1} onclick={() => move(selectedAlbum!.photos!,index,1)}>{words.down}</button><button onclick={() => {selectedAlbum!.cover=photo.original;changed();}}>设为封面</button><button onclick={() => {selectedAlbum!.photos!.splice(index,1);changed();}}>{words.remove}</button></div></article>{/each}</div>{/if}
  {:else}<p>{words.empty}，请选择或新增记录。</p>{/if}
  </div></div>
 {/if}
 <details><summary>未支持字段与完整清单（只读）</summary><pre class="configuration-lyrics">{serializeConfiguration(data)}</pre></details>
 </section>
 {#if picker}<section class="configuration-picker"><div class="editor-actions"><h2>选择 {picker.role} · {picker.field==='photos'?'可连续选择多张图片':'选中后返回'}</h2><button onclick={() => picker=null}>{words.done}</button></div><MediaLibrary role={picker.role} purpose={kind === "music" ? "music" : "gallery"} onselect={(media) => pick(media)} {onexpired}/></section>{/if}
 <Publishing draft={view.detail?.draft || null} locked={view.dirty || view.busy || view.state==='conflict'} {onexpired}/>
 {/if}
</section>
