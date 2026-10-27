<script lang="ts">
import { onMount } from "svelte";
import Icon from "@iconify/svelte";
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
import CurrentCollection from "./CurrentCollection.svelte";


let {
	kind,
	onexpired = () => {},
}: { kind: ConfigurationKind; onexpired?: () => void } = $props();
const workspaceWords = {
 music: { eyebrow: 'MUSIC COLLECTION', intro: '整理喜欢的旋律，为博客留下一份专属歌单。', icon: 'material-symbols:library-music-outline-rounded', empty: '让喜欢的音乐，在这里相遇', description: '从当前歌单创建一份私有修订，整理曲目、封面与歌词。已有歌曲会保留在修订中。', start: '开始整理歌单', item: '首歌曲', list: '曲目列表', select: '选择一首歌曲，编辑曲名、作者和音频信息。', features: ['曲目与顺序', '封面与歌词', '试听与私有保存'] },
 gallery: { eyebrow: 'PHOTO COLLECTION', intro: '把值得收藏的画面，整理成有故事的相册。', icon: 'material-symbols:photo-library-outline-rounded', empty: '为每一段回忆，留一个位置', description: '从当前相册创建一份私有修订，整理照片、封面与拍摄信息。已有相册会保留在修订中。', start: '开始整理相册', item: '本相册', list: '相册列表', select: '选择一本相册，编辑信息并整理照片。', features: ['相册与描述', '封面与照片', '排序与私有保存'] },
 settings: { eyebrow: 'CONFIGURATION', intro: words.note, icon: 'material-symbols:tune-rounded', empty: '整理站点配置', description: '从当前配置创建一份私有修订。', start: words.current, item: '项配置', list: '配置列表', select: '选择配置后开始编辑。', features: ['读取当前配置', '编辑私有修订', '保存修改'] },
};
const workspace = $derived(workspaceWords[kind]);
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
 <div class="heading configuration-heading"><div><p class="eyebrow">{workspace.eyebrow}</p><h1>{words[kind]}</h1><p class="muted">{workspace.intro}</p></div>{#if detail}<button disabled={operation || view.busy} onclick={() => void open()}><Icon icon="material-symbols:add-rounded" />新建私有修订</button>{/if}</div>
 {#if error}<p role="alert" class="error configuration-alert">{error}</p>{/if}
 {#if !detail && kind === 'settings'}
 <section class="panel configuration-welcome">
  <div class="collection-art" aria-hidden="true"><Icon icon={workspace.icon} /></div>
  <div class="collection-intro"><p class="eyebrow">YOUR COLLECTION</p><h2>{workspace.empty}</h2><p>{workspace.description}</p><button class="primary" disabled={operation || view.busy || loading} onclick={() => void open()}><Icon icon="material-symbols:add-rounded" />{operation ? words.loading : workspace.start}</button><small>只保存到私有区，不会直接改变博客公开内容。</small></div>
 </section>
 <div class="collection-guide" aria-label="整理流程">{#each workspace.features as feature,index}<div><span>0{index+1}</span><strong>{feature}</strong></div>{/each}</div>
 {/if}
 {#if !detail && kind !== 'settings'}<CurrentCollection {kind} {onexpired} busy={operation} onedit={() => void open()}/>{/if}
 <details class="panel revision-panel" open={!detail && revisions.length > 0}><summary><span><Icon icon="material-symbols:history-rounded" />私有修订</span><small>{loading ? words.loading : error ? '暂不可用' : revisions.length ? revisions.length + ' 份 · 可继续编辑' : '暂无修订'}</small></summary>
  {#if loading}<p class="muted" role="status">{words.loading}</p>{:else if !revisions.length && !error}<p class="muted">创建后，保存的修订会出现在这里，方便下次继续整理。</p>{/if}
  <div class="configuration-revisions">{#each revisions as revision}<button disabled={operation || view.busy} onclick={() => void open(revision.id)}><span class="revision-version">r{revision.revision}</span><span><strong>{words.reopen}</strong><small>{new Date(revision.updated_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</small></span><Icon icon="material-symbols:arrow-forward-rounded" /></button>{/each}</div>
 </details>
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
  <div class="configuration-columns"><div class="configuration-list"><div class="collection-list-heading"><h2>{workspace.list}</h2><span>{(kind === 'music' ? tracks : albums).length} {workspace.item}</span></div><button class="collection-add" onclick={add}>{kind === 'music' ? words.addTrack : words.addAlbum}</button>{#each kind === 'music' ? tracks : albums as row, index (row.id)}<article class:active={selection === row.id}><button class="configuration-select" onclick={() => {selection=row.id;picker=null;lyricPreview='';}}>{index+1}. {row.name || '（未命名）'}</button><div class="editor-actions"><button aria-label={`${row.name}上移`} disabled={index===0} onclick={() => move(kind==='music'?tracks:albums,index,-1)}>{words.up}</button><button aria-label={`${row.name}下移`} disabled={index===(kind==='music'?tracks:albums).length-1} onclick={() => move(kind==='music'?tracks:albums,index,1)}>{words.down}</button><button onclick={() => { (kind==='music'?tracks:albums).splice(index,1); if(selection===row.id) selection='';changed();}}>{words.remove}</button></div></article>{/each}</div>
  <div class="configuration-fields collection-fields">
  {#if selectedTrack}<p class="muted">稳定 ID：{selectedTrack.id}</p><label>曲名<input bind:value={selectedTrack.name} oninput={changed} /></label><label>作者<input bind:value={selectedTrack.artist} oninput={changed} /></label><label>音频地址<input bind:value={selectedTrack.url} oninput={changed} /></label><button onclick={() => picker={record:selectedTrack!,field:'url',role:'audio'}}>{words.select} · 音频</button><label>封面地址<input bind:value={selectedTrack.cover} oninput={changed} /></label><button onclick={() => picker={record:selectedTrack!,field:'cover',role:'image'}}>{words.select} · 封面</button><label>歌词（LRC 内容或文件地址）<textarea rows="4" bind:value={selectedTrack.lrc} oninput={changed}></textarea></label><button onclick={() => picker={record:selectedTrack!,field:'lrc',role:'text'}}>{words.select} · 歌词</button><div class="configuration-audition">{#if selectedTrack.cover}<img alt="歌曲封面预览" src={protectedAsset(selectedTrack.cover)} />{/if}{#key selectedTrack.url}<audio aria-label="歌曲试听" controls preload="none" src={protectedAsset(selectedTrack.url)}></audio>{/key}</div><button onclick={() => void lyrics(selectedTrack!)}>查看歌词</button>{#if lyricPreview}<pre class="configuration-lyrics">{lyricPreview}</pre>{/if}
  {:else if selectedAlbum}<p class="muted">相册 ID / URL：{selectedAlbum.id}</p><label>相册标题<input bind:value={selectedAlbum.name} oninput={changed} /></label><label>描述<textarea rows="3" bind:value={selectedAlbum.description} oninput={changed}></textarea></label><label>日期<input type="date" bind:value={selectedAlbum.date} oninput={changed} /></label><label>地点<input bind:value={selectedAlbum.location} oninput={changed} /></label><label>标签（每行一个）<textarea rows="3" value={selectedAlbum.tags?.join('\n') || ''} oninput={(event) => {selectedAlbum!.tags=event.currentTarget.value?event.currentTarget.value.split('\n'):[];changed();}}></textarea></label><label>封面地址（留空使用自动封面）<input bind:value={selectedAlbum.cover} oninput={changed} /></label><button onclick={() => picker={record:selectedAlbum!,field:'cover',role:'image'}}>{words.select} · 封面</button>{#if selectedAlbum.cover}<img class="configuration-cover" alt="相册封面预览" src={protectedAsset(selectedAlbum.cover)} />{/if}<p class="muted">相册密码只是页面展示保护。移除图片只移除引用，不删除原件；历史 release 继续保留。</p>{#if selectedAlbum.photos === undefined}<p>兼容目录扫描 / urls.txt（只读图片来源）。请在可信源码导入显式清单后管理图片。</p>{:else}<button onclick={() => picker={record:selectedAlbum!,field:'photos',role:'image'}}>{words.select} · 批量添加图片</button><div class="configuration-photos">{#each selectedAlbum.photos as photo,index (photo.id)}<article><a href={protectedAsset(photo.original)} target="_blank" rel="noreferrer"><img alt={`图片 ${index+1}`} loading="lazy" src={protectedAsset(photo.preview || photo.original)} /></a><small>{index+1} · {photo.width || '—'}×{photo.height || '—'}</small><div class="editor-actions"><button disabled={index===0} onclick={() => move(selectedAlbum!.photos!,index,-1)}>{words.up}</button><button disabled={index===selectedAlbum.photos.length-1} onclick={() => move(selectedAlbum!.photos!,index,1)}>{words.down}</button><button onclick={() => {selectedAlbum!.cover=photo.original;changed();}}>设为封面</button><button onclick={() => {selectedAlbum!.photos!.splice(index,1);changed();}}>{words.remove}</button></div></article>{/each}</div>{/if}
  {:else}<div class="collection-selection-empty"><Icon icon={workspace.icon} /><h3>{(kind === 'music' ? tracks : albums).length ? '选择一个项目开始编辑' : kind === 'music' ? '还没有歌曲' : '还没有相册'}</h3><p>{workspace.select}</p><button onclick={add}>{kind === 'music' ? words.addTrack : words.addAlbum}</button></div>{/if}
  </div></div>
 {/if}
 <details><summary>未支持字段与完整清单（只读）</summary><pre class="configuration-lyrics">{serializeConfiguration(data)}</pre></details>
 </section>
 {#if picker}<section class="configuration-picker"><div class="editor-actions"><h2>选择 {picker.role} · {picker.field==='photos'?'可连续选择多张图片':'选中后返回'}</h2><button onclick={() => picker=null}>{words.done}</button></div><MediaLibrary role={picker.role} purpose={kind === "music" ? "music" : "gallery"} onselect={(media) => pick(media)} {onexpired}/></section>{/if}

 {/if}
</section>
<style>
.configuration-heading{margin-bottom:4px}.configuration-heading button{display:flex;align-items:center;gap:8px}.configuration-welcome{display:flex;align-items:center;gap:40px;padding:40px;min-height:290px;background:linear-gradient(120deg,var(--surface),var(--accent-soft))}.collection-art{display:grid;place-items:center;width:170px;height:170px;flex-shrink:0;background:var(--surface);border:1px solid var(--border);border-radius:32px;transform:rotate(-7deg);box-shadow:var(--shadow)}.collection-art :global(svg){font-size:76px;color:var(--accent)}.collection-intro{max-width:620px}.collection-intro .eyebrow{margin:0 0 10px}.collection-intro h2{font-size:25px;line-height:1.5;margin:0 0 10px}.collection-intro>p:not(.eyebrow){font-size:14px;line-height:1.9;color:var(--text-muted);margin:0 0 20px}.collection-intro button{display:inline-flex;gap:8px;align-items:center}.collection-intro small{display:block;color:var(--text-muted);font-size:12px;margin-top:14px}.collection-guide{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.collection-guide>div{display:flex;align-items:center;gap:14px;padding:18px 22px;background:var(--surface);border:1px solid var(--border);border-radius:14px}.collection-guide span{font-size:12px;font-weight:650;color:var(--accent);background:var(--accent-soft);padding:7px 9px;border-radius:9px}.collection-guide strong{font-size:13px;font-weight:550}.revision-panel{padding:20px 24px}.revision-panel summary{display:flex;justify-content:space-between;align-items:center;gap:14px;cursor:pointer;list-style:none}.revision-panel summary::-webkit-details-marker{display:none}.revision-panel summary>span{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:650}.revision-panel summary>small{font-size:12px;color:var(--text-muted);margin-left:auto}.revision-panel summary::after{content:'＋';color:var(--accent)}.revision-panel[open] summary::after{content:'−'}.configuration-revisions{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;max-height:280px;margin-top:18px}.configuration-revisions:empty{display:none}.configuration-revisions button{display:flex;align-items:center;gap:12px;text-align:left;padding:14px;background:var(--surface-soft)}.configuration-revisions button>span:nth-child(2){flex:1;min-width:0}.configuration-revisions strong,.configuration-revisions small{display:block}.configuration-revisions strong{font-size:13px}.configuration-revisions small{font-size:11px;margin-top:4px;color:var(--text-muted)}.revision-version{padding:8px;border-radius:9px;color:var(--accent);background:var(--accent-soft);font-weight:700}.configuration-editor{padding:24px}.configuration-editor>.editor-actions{margin:0;padding-bottom:20px;border-bottom:1px solid var(--border)}.configuration-editor>.editor-actions strong{flex:1;font-size:13px}.configuration-columns{grid-template-columns:minmax(210px,270px) minmax(0,1fr);gap:28px}.configuration-list{padding-right:22px;border-right:1px solid var(--border)}.collection-list-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px}.collection-list-heading h2{font-size:15px;margin:0}.collection-list-heading span{color:var(--text-muted);font-size:11px}.configuration-page .collection-add{width:100%;border-style:dashed;color:var(--accent)}.configuration-list article{padding:12px}.configuration-list article .editor-actions{gap:6px;margin:10px 0 0}.configuration-list article .editor-actions button{font-size:11px;padding:5px 8px}.configuration-page .configuration-select{border:0;background:transparent;padding:4px;font-size:13px;font-weight:650}.collection-fields{align-content:start;gap:16px}.collection-fields>p:first-child{font-size:11px;margin:0;padding-bottom:10px;border-bottom:1px solid var(--border)}.collection-fields>button{display:inline-flex;align-items:center}.configuration-audition{padding:16px;border-radius:14px;background:var(--surface-soft)}.configuration-audition img{width:80px;height:80px;border-radius:12px;object-fit:cover}.configuration-audition audio{flex:1;min-width:180px}.configuration-cover{width:100%;max-width:320px;height:190px;border-radius:14px;background:var(--surface-soft)}.configuration-editor>details{border-top:1px solid var(--border);padding-top:20px;font-size:12px;color:var(--text-muted)}.configuration-editor>details>summary{cursor:pointer}.collection-selection-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:330px;text-align:center;padding:28px;border:1px dashed var(--border);border-radius:16px;background:var(--surface-soft)}.collection-selection-empty :global(svg){font-size:42px;color:var(--accent)}.collection-selection-empty h3{font-size:17px;margin:18px 0 8px}.collection-selection-empty p{font-size:13px;color:var(--text-muted);margin:0 0 20px}.configuration-picker{padding:24px;border-radius:18px;background:var(--surface-soft)}.configuration-alert{padding:14px 18px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
@media(max-width:1000px){.configuration-welcome{padding:28px;gap:24px}.collection-art{width:120px;height:140px}.collection-art :global(svg){font-size:56px}.collection-guide{gap:10px}.collection-guide>div{padding:14px;gap:10px}.configuration-columns{grid-template-columns:minmax(180px,220px) minmax(0,1fr);gap:20px}.configuration-list{padding-right:16px}}
@media(max-width:700px){.configuration-page .configuration-welcome{flex-direction:column;align-items:start;gap:22px;padding:24px}.collection-art{width:64px;height:64px;border-radius:18px}.collection-art :global(svg){font-size:32px}.collection-intro h2{font-size:22px}.collection-guide{grid-template-columns:1fr}.collection-guide>div{padding:12px 16px}.configuration-page .revision-panel{padding:18px}.configuration-columns{grid-template-columns:1fr}.configuration-list{border-right:0;border-bottom:1px solid var(--border);padding:0 0 20px}.configuration-page .configuration-editor{padding:18px}.configuration-picker{padding:12px}.configuration-revisions{grid-template-columns:1fr}.collection-selection-empty{min-height:240px}.revision-panel summary{flex-wrap:wrap}.revision-panel summary>small{font-size:11px}}
/* Keep nested editors and media pickers within the available content width. */
.configuration-page,
.configuration-editor,
.configuration-fields label,
.configuration-fields,
.configuration-photos,
.configuration-picker > .editor-actions,
.collection-intro { min-width: 0; overflow-wrap: anywhere; }
fieldset.configuration-fields { margin: 0; min-inline-size: 0; }
.configuration-fields legend { max-width: 100%; }
.configuration-photos { grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr)); }
.configuration-revisions { grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); }
.configuration-revisions button { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.configuration-revisions button > :global(svg),
.configuration-heading button > :global(svg) { flex-shrink: 0; }
.configuration-audition audio { min-width: 0; }
.configuration-picker h2 { min-width: 0; flex: 1 1 180px; font-size: 18px; overflow-wrap: anywhere; }
.configuration-picker > .editor-actions > button { flex-shrink: 0; }
@media (max-width: 900px) {
 .configuration-columns { grid-template-columns: minmax(0, 1fr); }
 .configuration-list { border-right: 0; border-bottom: 1px solid var(--border); padding: 0 0 20px; }
 .configuration-audition audio { width: 100%; flex-basis: 100%; }
}
@media (max-width: 760px) {
 .configuration-heading > div { min-width: 0; }
 .configuration-heading > button { justify-content: center; max-width: 100%; white-space: normal; }
 .configuration-page .configuration-select { padding: 10px 4px; }
 .configuration-list article .editor-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
 .configuration-list article .editor-actions button { min-width: 0; }
 .configuration-photos .editor-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
 .configuration-photos .editor-actions button { min-width: 0; white-space: normal; }
 .configuration-editor > .editor-actions strong { flex-basis: 100%; min-width: 0; }
 .collection-list-heading { flex-wrap: wrap; }
 .configuration-audition { padding: 12px; }
 .configuration-audition audio { flex-basis: 100%; }
 .configuration-revisions { grid-template-columns: minmax(0, 1fr); }
}
</style>
