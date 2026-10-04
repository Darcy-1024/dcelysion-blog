<script lang="ts">
import { onMount, tick } from "svelte";
import { isConfiguration } from "../shared/configuration.js";
import type { DraftDetail } from "../shared/contracts";
import {
	fields,
	frontmatter,
	images,
	insertImage,
	inspect,
	moveImage,
	patchField,
} from "../shared/editor";
import { type Media, mediaMarker } from "../shared/media.js";
import {
	EditorSession,
	type SaveResult,
	textareaChange,
} from "./editor-session";
import { apiMessage, editorWords as words } from "./i18n";
import MediaLibrary from "./MediaLibrary.svelte";
import Publishing from "./Publishing.svelte";

let {
	initial,
	onback,
	onexpired,
	onreplace,
}: {
	initial: DraftDetail;
	onback: () => void;
	onexpired: () => void;
	onreplace: (detail: DraftDetail) => void;
} = $props();
let version = $state(0);
let sourceArea: HTMLTextAreaElement;
let timer: ReturnType<typeof setTimeout> | undefined;
let operationBusy = $state(false);
let notice = $state("");
let media = $state<string[]>([]);
let url = $state("");
let alt = $state("");
let copyRequest: {
	requestId: string;
	copyFrom: string;
	source: string;
} | null = null;
// The parent keys this component by the draft detail; each mount owns one session.
// svelte-ignore state_referenced_locally
const session = new EditorSession(
	initial,
	async (input) => {
		const result = (await call(
			`/api/drafts/${initial.draft.id}/save`,
			input,
		)) as SaveResult;
		if (!result.ok && result.error.code === "UNAUTHORIZED") onexpired();
		return result;
	},
	() => {
		version++;
		clearTimeout(timer);
		if (copyRequest && !operationBusy && copyRequest.source !== session.source)
			copyRequest = null;
		if (session.state === "dirty")
			timer = setTimeout(() => void session.save(), 900);
	},
);
const view = $derived.by(() => {
	version;
	return {
		source: session.source,
		state: session.state,
		revision: session.revision,
		conflict: session.conflict,
		error: session.error,
		dirty: session.dirty,
		detail: session.detail,
		busy: session.busy,
	};
});
const metadata = $derived(inspect(view.source, initial.draft.kind));
const imageInfo = $derived(images(view.source));
const mediaOptions = $derived([
	...new Set([...media, ...imageInfo.items.map((item) => item.url)]),
]);
async function call(path: string, input?: unknown) {
	const response = await fetch(path, {
		credentials: "same-origin",
		cache: "no-store",
		...(input === undefined
			? {}
			: {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(input),
				}),
	});
	return response.json();
}
onMount(() => {
	void call(`/api/media?kind=${initial.draft.kind}`)
		.then((result) => {
			if (result.ok) media = result.data;
		})
		.catch(() => {});
	void tick().then(() => sourceArea?.focus());
	const beforeUnload = (event: BeforeUnloadEvent) => {
		if (session.dirty) {
			event.preventDefault();
			event.returnValue = "";
		}
	};
	window.addEventListener("beforeunload", beforeUnload);
	return () => {
		session.dispose();
		clearTimeout(timer);
		window.removeEventListener("beforeunload", beforeUnload);
	};
});
export function canLeave() {
	return !session.dirty || window.confirm(words.leave);
}
function field(event: Event, name: string) {
	const input = event.currentTarget as HTMLInputElement;
	let value: unknown =
		name === "draft" || name === "pinned" ? input.checked : input.value;
	try {
		if (name === "tags") value = input.value ? input.value.split("\n") : [];
		session.edit(patchField(session.source, initial.draft.kind, name, value));
		notice = "";
	} catch (cause) {
		notice = cause instanceof Error ? cause.message : "字段格式无效";
	}
}
function insert() {
	try {
		const position = sourceArea.selectionStart;
		const prefix = sourceArea.value.slice(0, position);
		// Convert the textarea's LF offset to the corresponding original-source offset.
		let offset = 0;
		for (let i = 0; i < prefix.length; i++)
			offset += session.source.slice(offset, offset + 2) === "\r\n" ? 2 : 1;
		const boundary = frontmatter(session.source)?.bodyStart;
		if (boundary !== undefined && offset < boundary)
			throw new Error("请先把源码光标放到正文，再插入图片");
		session.edit(insertImage(session.source, url, alt, Math.max(offset, 0)));
		notice = "";
		sourceArea.focus();
	} catch (cause) {
		notice = cause instanceof Error ? cause.message : "图片格式无效";
	}
}
function insertManaged(media: Media, preview: boolean) {
	try {
		const position = sourceArea.selectionStart;
		const prefix = sourceArea.value.slice(0, position);
		let offset = 0;
		for (let i = 0; i < prefix.length; i++)
			offset += session.source.slice(offset, offset + 2) === "\r\n" ? 2 : 1;
		if (offset < (frontmatter(session.source)?.bodyStart || 0))
			throw new Error("请先把源码光标放到正文，再选用媒体");
		const marker = mediaMarker(media.id);
		const description = alt.replace(/[[\]<>\r\n]/gu, "");
		let snippet =
			media.kind === "image"
				? preview
					? `[![${description}](${mediaMarker(media.id, "preview")})](${marker})`
					: `![${description}](${marker})`
				: media.kind === "audio"
					? `<audio controls src="${marker}"></audio>`
					: media.kind === "video"
						? `<video controls src="${marker}"></video>`
						: `[${description || "文本附件"}](${marker})`;
		const eol = session.source.includes("\r\n") ? "\r\n" : "\n";
		snippet = eol + snippet + eol;
		session.edit(
			session.source.slice(0, offset) + snippet + session.source.slice(offset),
		);
		notice = "";
		sourceArea.focus();
	} catch (cause) {
		notice = (cause as Error).message;
	}
}
async function copy() {
	operationBusy = true;
	copyRequest ||= {
		requestId: crypto.randomUUID(),
		copyFrom: initial.draft.id,
		source: session.source,
	};
	try {
		const result = await call("/api/drafts", copyRequest);
		if (result.ok) {
			session.dispose();
			clearTimeout(timer);
			onreplace(result.data);
		} else {
			notice = apiMessage(result.error);
			if (result.error.code === "UNAUTHORIZED") onexpired();
		}
	} catch {
		notice = apiMessage({ code: "NETWORK" });
	} finally {
		operationBusy = false;
	}
}
async function reloadSaved() {
	if (
		!window.confirm(
			"用服务器已保存内容替换当前编辑区？请先检查差异；未保存输入将丢失。",
		)
	)
		return;
	operationBusy = true;
	try {
		const result = await call(`/api/drafts/${initial.draft.id}`);
		if (result.ok) onreplace(result.data);
		else {
			notice = apiMessage(result.error);
			if (result.error.code === "UNAUTHORIZED") onexpired();
		}
	} catch {
		notice = apiMessage({ code: "NETWORK" });
	} finally {
		operationBusy = false;
	}
}
function diff(a: string, b: string) {
	const before = a.split("\n");
	const after = b.split("\n");
	let start = 0;
	let end = 0;
	while (
		start < before.length &&
		start < after.length &&
		before[start] === after[start]
	)
		start++;
	while (
		end < before.length - start &&
		end < after.length - start &&
		before[before.length - end - 1] === after[after.length - end - 1]
	)
		end++;
	if (start === before.length && start === after.length) return "内容相同";
	return [
		`相同前缀 ${start} 行 / 相同后缀 ${end} 行`,
		...before.slice(start, before.length - end).map((line) => `− ${line}`),
		...after.slice(start, after.length - end).map((line) => `+ ${line}`),
	].join("\n");
}
</script>

<svelte:window onkeydown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void session.save(); } }} />

<section class="editor" aria-label="私有内容编辑器">
 <div class="editor-bar"><button onclick={onback}>{words.back}</button><strong>{initial.draft.path}</strong><span role="status" aria-live="polite">{words[view.state]} · r{view.revision}</span><button class="primary" disabled={view.busy || operationBusy || view.state === "conflict" || !view.dirty} onclick={() => void session.save()}>{view.state === "failed" ? "重试保存" : words.save}</button></div>
 <p class="muted">保存仅进入后台私有数据库。文件路径与已有文章 URL、动态评论标识保持固定。表单中的 draft 仅表示未来发布后的状态。固定标识：{initial.draft.contentId}</p>
 {#if view.error}<p class="error" role="alert">{apiMessage({ code: view.error })}</p>{/if}
 {#if notice}<p class="error" role="alert">{notice}</p>{/if}
 {#if view.detail.sourceState.changed && initial.draft.snapshot}<p class="muted">此副本保留原始基准；来源仍有变化。可继续保存私有副本，发布前必须处理来源差异。</p>{/if}
 {#if view.conflict}
  <section class="conflict panel" aria-label="冲突处理"><h2>{view.conflict.reason === "revision" ? "私有草稿版本冲突" : "来源内容冲突"}</h2><p>当前输入已保留，自动保存已暂停。{view.conflict.saved.sourceState.reason === "deleted" ? "来源文件已删除。" : view.conflict.saved.sourceState.reason === "collision" ? "拟用路径已被占用。" : "请检查下面的差异。"}</p>
   <div class="editor-actions"><button disabled={operationBusy} onclick={() => void copy()}>{words.copy}</button><button disabled={operationBusy} onclick={() => void reloadSaved()}>重新读取已保存内容</button><span>也可继续保留当前输入</span></div>
   <details><summary>已保存 → 当前输入差异</summary><pre>{diff(view.conflict.saved.draft.source, view.source)}</pre></details>
   <details><summary>原始基准 → 当前来源差异</summary><pre>{diff(view.conflict.saved.draft.baseSource || "", view.conflict.saved.sourceState.current || "")}</pre></details>
   <div class="conflict-sources">{#each [["当前输入", view.source], ["服务器已保存", view.conflict.saved.draft.source], ["原始基准", view.conflict.saved.draft.baseSource || "（新内容，无基准）"], ["当前来源", view.conflict.saved.sourceState.current || "（不存在或新内容）"]] as entry}<details><summary>{entry[0]}</summary><textarea aria-label={entry[0]} value={entry[1]} readonly rows="10"></textarea></details>{/each}</div>
  </section>
 {/if}
 <div class="editor-grid"><div class="source-pane"><label for="source-editor">{words.source}</label><textarea id="source-editor" bind:this={sourceArea} value={view.source} readonly={operationBusy} oninput={(event) => session.edit(textareaChange(session.source, event.currentTarget.value))} spellcheck="false" wrap="off" aria-describedby="source-note"></textarea><p id="source-note" class="muted">包含 frontmatter 与完整正文；不执行 MDX。无效 YAML 也能作为私有草稿保存。</p></div>
  <section class="metadata-pane" aria-label="元数据"><h2>元数据</h2>
   {#each isConfiguration(initial.draft.kind) ? [] : fields[initial.draft.kind] as name}
    {#if name === "draft" || name === "pinned"}<label class="check-field"><input type="checkbox" checked={metadata.values[name] === true} disabled={operationBusy || !metadata.editable.includes(name)} oninput={(event) => field(event, name)} />{words[name]}</label>
    {:else if name === "tags"}<label>{words.tags}<textarea rows="3" value={Array.isArray(metadata.values.tags) ? metadata.values.tags.join("\n") : ""} disabled={operationBusy || !metadata.editable.includes(name)} oninput={(event) => field(event, name)}></textarea></label>
    {:else}<label>{words[name as keyof typeof words]}<input value={name === "tags" ? JSON.stringify(metadata.values[name] ?? []) : String(metadata.values[name] ?? "")} disabled={operationBusy || !metadata.editable.includes(name)} oninput={(event) => field(event, name)} /></label>{/if}
    {#if !metadata.editable.includes(name)}<small class="muted">此字段需在源码中修改，原格式会保留。</small>{/if}
   {/each}
   {#if metadata.errors.length}<div class="validation" role="status"><strong>草稿校验提示（不阻止私有保存）</strong>{#each metadata.errors as message}<p>{message}</p>{/each}</div>{/if}
   <h2>插入已有图片</h2><label>已有媒体引用<select onchange={(event) => url = event.currentTarget.value}><option value="">选择已有地址</option>{#each mediaOptions as item}<option value={item}>{item}</option>{/each}</select></label><label>图片地址<input bind:value={url} placeholder="https://… 或 ./images/…" /></label><label>图片说明<input bind:value={alt} /></label><button disabled={operationBusy} onclick={insert}>在光标处插入</button>
   {#if initial.draft.kind === "dynamic"}<h2>动态图片顺序</h2>{#if !imageInfo.sortable}<p class="muted">复杂图片或代码语法请在源码中调整顺序。</p>{:else}{#each imageInfo.items as image, index}<div class="image-order"><code title={image.raw}>{index + 1}. {image.raw}</code><div><button disabled={operationBusy || index === 0} aria-label={`上移图片 ${index + 1}`} onclick={() => session.edit(moveImage(session.source, index, index - 1))}>↑</button><button disabled={operationBusy || index === imageInfo.items.length - 1} aria-label={`下移图片 ${index + 1}`} onclick={() => session.edit(moveImage(session.source, index, index + 1))}>↓</button></div></div>{/each}{/if}{/if}
  </section></div>
</section>
<Publishing draft={view.detail.draft} locked={view.dirty || view.busy || operationBusy || view.state==='conflict'} {onexpired}/>
<MediaLibrary purpose="article" onselect={insertManaged} {onexpired}/>
