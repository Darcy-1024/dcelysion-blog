<script lang="ts">
import { onMount, tick, untrack } from "svelte";
import { isConfiguration } from "../shared/configuration.js";
import type { Draft } from "../shared/contracts.js";
import type {
	Job,
	PublishingInfo,
	PublishTarget,
	Release,
} from "../shared/publishing.js";
import { apiMessage, publishWords as words } from "./i18n.js";

let {
	draft = null,
	locked = false,
	onexpired = () => {},
	initialJobId = null,
}: {
	draft?: Draft | null;
	locked?: boolean;
	onexpired?: () => void;
	initialJobId?: string | null;
} = $props();
let info = $state<PublishingInfo | null>(null);
let targetId = $state("");
let tasks = $state<Job[]>([]);
let selected = $state<Job | null>(null);
let versions = $state<Release[]>([]);
let error = $state("");
let busy = $state(false);
let confirmation = $state("");
let confirmDialog: HTMLDialogElement;
let cancelButton: HTMLButtonElement;
let confirmationAction: (() => Promise<void>) | null = null;
let trigger: HTMLElement | null = null;
function closeConfirmation() {
	confirmDialog?.close();
	confirmation = "";
	confirmationAction = null;
	trigger?.focus();
}
async function ask(message: string, action: () => Promise<void>) {
	trigger =
		document.activeElement instanceof HTMLElement
			? document.activeElement
			: null;
	confirmation = message;
	confirmationAction = action;
	await tick();
	confirmDialog.showModal();
	cancelButton.focus();
}
function acceptConfirmation() {
	const action = confirmationAction;
	closeConfirmation();
	void action?.();
}
let plan = $state<{
	path: string;
	before: string | null;
	after: string;
	base: string;
	revision: number;
	draftId: string;
	target: PublishTarget;
	mediaConfirm?: string | null;
	mediaPlan?: { dependencies: { url: string }[] };
} | null>(null);
let pending: {
	requestId: string;
	draftId: string;
	revision: number;
	targetId: string;
	kind: string;
	base: string;
	confirm: string;
	mediaConfirm?: string | null;
} | null = null;
const target = $derived(info?.targets.find((value) => value.id === targetId));
const snapshot = $derived(draft ? `${draft.id}:${draft.revision}` : "");
let plannedSnapshot = $state("");
$effect(() => {
	if (snapshot !== plannedSnapshot) {
		plannedSnapshot = snapshot;
		plan = null;
		pending = null;
		untrack(closeConfirmation);
	}
});
async function call<T>(path: string, input?: unknown): Promise<T> {
	const response = await fetch(path, {
		cache: "no-store",
		credentials: "same-origin",
		...(input === undefined
			? {}
			: {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(input),
				}),
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
		info = await call<PublishingInfo>("/api/publishing");
		targetId ||= info.targets[0]?.id || "";
		tasks = await call<Job[]>("/api/jobs");
		if (selected) selected = await call<Job>(`/api/jobs/${selected.id}`);
		if (target?.deploy)
			versions = await call<Release[]>(
				`/api/releases?targetId=${encodeURIComponent(targetId)}`,
			);
		else versions = [];
	} catch (cause) {
		error = (cause as Error).message;
	}
}
async function inspect() {
	if (!draft || !target) return;
	busy = true;
	error = "";
	try {
		plan = await call("/api/publishing/diff", {
			draftId: draft.id,
			revision: draft.revision,
			targetId,
		});
		plannedSnapshot = snapshot;
		pending = null;
	} catch (cause) {
		error = (cause as Error).message;
	} finally {
		busy = false;
	}
}
async function create(kind: "preview" | "publish") {
	if (!plan || !target) return;
	pending ||= {
		requestId: crypto.randomUUID(),
		draftId: plan.draftId,
		revision: plan.revision,
		targetId,
		kind,
		base: plan.base,
		confirm: target.fingerprint,
		mediaConfirm: plan.mediaConfirm,
	};
	if (pending.kind !== kind) {
		pending = { ...pending, requestId: crypto.randomUUID(), kind };
	}
	const input = { ...pending };
	const mediaNotice = plan.mediaPlan?.dependencies.length
		? `\n将先把 ${plan.mediaPlan.dependencies.length} 项固定媒体依赖交付到公开目录和 R2 公共桶；构建或推送随后失败也不会自动撤回这些公开文件。确认此公开动作。`
		: "";
	if (kind === "publish")
		return ask(
			`固定 r${plan.revision}，提交 ${plan.path} 及固定的公开媒体分发快照。\n目标：${target.label} / ${target.branch}\n${target.pages ? "推送 master 会触发 GitHub Pages 自动部署。\n" : ""}${target.deploy ? "随后安装整站 release。" : "只同步 Git。"}\n${target.mode === "local-fixture" ? "本次仅隔离测试仓库和本地目录。" : ""}${mediaNotice}`,
			() => submit(input),
		);
	await submit(input);
}
async function submit(input: Record<string, unknown>) {
	busy = true;
	error = "";
	try {
		selected = await call("/api/jobs", input);
		pending = null;
		await load();
	} catch (cause) {
		error = (cause as Error).message;
	} finally {
		busy = false;
	}
}
async function choose(id: string) {
	error = "";
	try {
		selected = await call<Job>(`/api/jobs/${id}`);
	} catch (cause) {
		error = (cause as Error).message;
	}
}
async function retry() {
	if (!selected) return;
	busy = true;
	error = "";
	try {
		selected = await call<Job>(`/api/jobs/${selected.id}/retry`, {});
		await load();
	} catch (cause) {
		error = (cause as Error).message;
	} finally {
		busy = false;
	}
}
async function rollback(id: string) {
	if (!target) return;
	const input = {
		targetId,
		releaseId: id,
		expected: versions.find((value) => value.current)?.id || null,
		confirm: target.fingerprint,
	};
	await ask(
		`把整个站点 current 切换为 ${id}？不会改写 Git 历史。\n目标：${target.label}\n${target.mode === "local-fixture" ? "仅隔离测试目录。" : ""}`,
		() => performRollback(input),
	);
}
async function performRollback(input: Record<string, unknown>) {
	busy = true;
	error = "";
	try {
		versions = await call("/api/releases/rollback", input);
	} catch (cause) {
		error = (cause as Error).message;
	} finally {
		busy = false;
	}
}
onMount(() => {
	void load().then(() => {
		if (initialJobId) void choose(initialJobId);
	});
	const timer = setInterval(() => {
		if (
			tasks.some(
				(task) => task.status === "queued" || task.status === "running",
			)
		)
			void load();
	}, 2000);
	return () => {
		clearInterval(timer);
		confirmDialog?.close();
	};
});
</script>
<section class="publishing panel">
 <div class="publish-heading"><h2>{draft?words.title:words.queue}</h2><button disabled={busy} onclick={()=>void load()}>{words.refresh}</button></div>
 {#if error}<p class="error" role="alert">{error}</p>{/if}
 {#if info}
  <p class="muted">保存只进私有区。候选提交、Git 推送、release 安装分别记录。{#if draft && !isConfiguration(draft.kind)}draft:true 会保留。{/if}</p>
  {#if !info.targets.length}<p>尚未配置真实目标。</p>{:else}<label>执行目标<select bind:value={targetId} disabled={busy} onchange={()=>{plan=null;pending=null;void load();}}>{#each info.targets as value}<option value={value.id}>{value.label} · {value.branch}</option>{/each}</select></label>{/if}
  {#if target}<p>{target.mode==='local-fixture'?'仅隔离验收：本地 bare remote + 临时 release 目录。':target.label}{target.pages?' 推送 master 会触发 GitHub Pages，腾讯安装单独执行。':''}</p>{/if}
  <p>构建：{info.buildMode==='fixture'?'fixture（不代表真实 Astro 渲染）':'受限容器中的真实 Astro 管线'}{!info.available?' · '+apiMessage({code:info.reason||'BUILD_UNAVAILABLE'}):''}</p>
  {#if draft}<div class="editor-actions"><button disabled={busy||locked||!target} onclick={()=>void inspect()}>{words.diff} · r{draft.revision}</button><button disabled={busy||locked||!plan||!info.available} onclick={()=>void create('preview')}>{words.preview}</button><button class="primary" disabled={busy||locked||!plan||!info.available} onclick={()=>void create('publish')}>{words.publish}</button></div>{#if locked}<p>先完成当前私有保存，再固定预览或发布快照。</p>{/if}{/if}
  {#if plan}<details open><summary>{plan.path} · 固定 r{plan.revision} · 基准 {plan.base.slice(0,12)}</summary><div class="publish-diff"><div><strong>远端基准</strong><pre>{plan.before||'（新内容）'}</pre></div><div><strong>候选快照</strong><pre>{plan.after}</pre></div></div></details>{/if}
 {/if}
 <h3>{words.queue}</h3>
 {#if !tasks.length}<p class="muted">{words.empty}</p>{/if}
 <div class="publish-task-list">{#each tasks as task}<button class:active={selected?.id===task.id} onclick={()=>void choose(task.id)}><strong>{task.snapshot.path} · r{task.revision} · {task.kind==='preview'?'预览':'发布'}</strong><span>{words.states[task.status]} / {words.stages[task.stage]||task.stage}</span></button>{/each}</div>
 {#if selected}<div class="job-detail"><h3>{selected.kind==='preview'?'预览':'发布'}任务 · {selected.id.slice(0,8)}</h3><p>{words.states[selected.status]} · {words.stages[selected.stage]||selected.stage}</p><p>候选提交：<code>{selected.effects.commit||'未形成'}</code><br/>Git 推送：{selected.effects.pushed?'已完成':'未完成'} · release 安装：{selected.effects.installed?'已完成':'未完成'}</p>{#if selected.effects.release}<p>release：<code>{selected.effects.release}</code></p>{/if}{#if selected.error}<p class="error">{apiMessage({code:selected.error})}（{selected.error}）</p>{/if}{#if selected.status==='failed'}<button disabled={busy} onclick={()=>void retry()}>{words.retry}</button>{/if}<ol class="job-logs">{#each selected.logs as log}<li>{words.stages[log.stage]||log.stage}：{log.message}</li>{/each}</ol>
 {#if selected.kind==='preview'&&selected.status==='succeeded'}<p>受保护静态排版预览。脚本、表单、后台 API、外部媒体及统计请求已阻止。{selected.effects.buildMode==='fixture'?'当前是 fixture 页面。':''}</p><iframe title="受保护预览" sandbox="" src={`/api/previews/${selected.id}/${selected.snapshot.kind==='posts'?`posts/${selected.snapshot.contentId}/index.html`:'index.html'}`}></iframe>{/if}
 </div>{/if}
 {#if target?.deploy}<h3>{words.versions}</h3><p class="muted">回退整站产物，不改变 Git 或单篇内容历史。</p>{#if !versions.length}<p>暂无可校验的 release。</p>{/if}{#each versions as version}<div class="release-row"><code>{version.id}</code><span>{version.current?'当前版本':''}</span><button disabled={busy||version.current} onclick={()=>void rollback(version.id)}>{words.rollback}</button></div>{/each}{/if}
</section>
<dialog bind:this={confirmDialog} class="admin-confirm" aria-label="确认发布或回退" oncancel={(event)=>{event.preventDefault();closeConfirmation();}}><h2>确认操作</h2><p>{confirmation}</p><div class="editor-actions"><button bind:this={cancelButton} onclick={closeConfirmation}>取消</button><button class="primary" disabled={busy} onclick={acceptConfirmation}>确认执行</button></div></dialog>
