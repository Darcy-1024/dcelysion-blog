<script lang="ts">
import { onMount } from "svelte";
import type {
	Account,
	BackendSession,
	Comment,
	ManagementInfo,
	Page,
	Thread,
	User,
} from "../shared/management.js";
import { apiMessage, connectionMessage } from "./i18n.js";
import { words } from "./management-words.js";
export let mode: "comments" | "users" | "account";
export let onexpired: () => void;
export let onsignout: () => void;
export let initialStatus = "all";
let info: ManagementInfo | null = null;
let rows: Page<Comment | User> | null = null;
let detail: Thread | null = null;
let selectedUser: User | null = null;
let account: Account | null = null;
let sessions: BackendSession[] = [];
let search = "";
let path = "";
let status = initialStatus;
let userId = "";
let page = 1;
let editText = "";
let replyText = "";
let nickname = "";
let website = "";
let currentPassword = "";
let newPassword = "";
let code = "";
let busy = false;
let error = "";
let notice = "";
let unknown = false;
let refreshedUnknown = false;
let pending: {
	action: string;
	label: string;
	object: string;
	input: Record<string, unknown>;
} | null = null;
let lastMode = mode;
type Result<T> =
	| { ok: true; data: T }
	| { ok: false; error: { code: string; message: string } };
async function request<T>(url: string, input?: Record<string, unknown>) {
	let result: Result<T>;
	try {
		const response = await fetch(url, {
			credentials: "same-origin",
			cache: "no-store",
			...(input
				? {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(input),
					}
				: {}),
		});
		result = (await response.json()) as Result<T>;
	} catch {
		if (input) {
			unknown = true;
			throw new Error(apiMessage({ code: "WRITE_UNKNOWN" }));
		}
		throw new Error(connectionMessage());
	}
	if (!result.ok) {
		if (["UNAUTHORIZED", "WALINE_REAUTH"].includes(result.error.code))
			onexpired();
		if (result.error.code === "WRITE_UNKNOWN") unknown = true;
		throw new Error(apiMessage(result.error));
	}
	return result.data;
}
async function run(task: () => Promise<void>) {
	if (busy) return;
	busy = true;
	error = "";
	notice = "";
	try {
		await task();
	} catch (cause) {
		error = cause instanceof Error ? cause.message : connectionMessage();
	} finally {
		busy = false;
	}
}
function dirty() {
	return (
		(!!detail && (editText !== detail.item.comment || !!replyText)) ||
		(!!account &&
			(nickname !== account.display_name ||
				website !== account.url ||
				!!currentPassword ||
				!!newPassword))
	);
}
export function canLeave() {
	return !busy && (!dirty() || confirm("存在未提交输入，确认离开此页？"));
}
async function loadRows() {
	rows = await request<Page<Comment | User>>(
		`/api/manage/${mode === "users" ? "users" : "comments"}?${new URLSearchParams({ page: String(page), search, ...(mode === "comments" ? { path, status, ...(userId ? { userId } : {}) } : {}) })}`,
	);
}
async function loadAccount() {
	account = await request<Account>("/api/manage/account");
	nickname = account.display_name;
	website = account.url;
}
async function initialize() {
	await run(async () => {
		info = await request<ManagementInfo>("/api/manage/info");
		if (mode === "account") {
			await loadAccount();
			sessions = await request<BackendSession[]>("/api/manage/sessions");
		} else await loadRows();
	});
}
onMount(() => void initialize());
$: if (mode !== lastMode) {
	lastMode = mode;
	rows = null;
	detail = null;
	selectedUser = null;
	account = null;
	search = path = userId = "";
	status = "all";
	page = 1;
	replyText = "";
	pending = null;
	unknown = false;
	void initialize();
}
async function open(id: string, threadPage = 1, preserve = false) {
	await run(async () => {
		if (mode === "users")
			selectedUser = await request<User>(`/api/manage/users/${id}`);
		else {
			detail = await request<Thread>(
				`/api/manage/comments/${id}?page=${threadPage}`,
			);
			if (!preserve) {
				editText = detail.item.comment;
				replyText = "";
				unknown = false;
			} else if (unknown) refreshedUnknown = true;
		}
	});
}
function prepare(
	action: string,
	label: string,
	object: string,
	input: Record<string, unknown>,
) {
	if (busy || unknown) return;
	pending = {
		action,
		label,
		object,
		input: { ...input, requestId: crypto.randomUUID() },
	};
}
function commentAction(
	action: string,
	label: string,
	input: Record<string, unknown> = {},
) {
	if (detail)
		prepare(
			`/api/manage/comments/${detail.item.objectId}/${action}`,
			label,
			`#${detail.item.objectId} · ${detail.item.nick} · ${detail.item.url}`,
			{ fingerprint: detail.item.fingerprint, ...input },
		);
}
async function submit() {
	const operation = pending;
	if (!operation) return;
	await run(async () => {
		let result: { signedOut?: boolean };
		try {
			result = await request(operation.action, operation.input);
		} catch (cause) {
			pending = null;
			if (unknown) refreshedUnknown = false;
			if (unknown && operation.action.endsWith("/password")) {
				currentPassword = newPassword = code = "";
				onexpired();
			}
			throw cause;
		}
		pending = null;
		if (result.signedOut) {
			currentPassword = newPassword = code = "";
			onsignout();
			return;
		}
		if (operation.action.includes("/sessions/"))
			sessions = await request("/api/manage/sessions");
		else if (mode === "account") await loadAccount();
		else if (mode === "users" && selectedUser) {
			selectedUser = await request(
				`/api/manage/users/${selectedUser.objectId}`,
			);
			await loadRows();
		} else {
			if (operation.action.endsWith("/delete")) {
				detail = null;
				replyText = editText = "";
			} else if (detail) {
				const refreshed = await request<Thread>(
					`/api/manage/comments/${detail.item.objectId}`,
				);
				detail = refreshed;
				editText = refreshed.item.comment;
				replyText = "";
			}
			await loadRows();
		}
		notice = words.success;
	});
}
function filter() {
	page = 1;
	void run(loadRows);
}
function turnPage(next: number) {
	page = next;
	void run(loadRows);
}
function userType(type: string) {
	return (
		(
			{
				guest: words.guest,
				banned: words.banned,
				unverified: words.unverified,
				administrator: words.administrator,
			} as Record<string, string>
		)[type] || type
	);
}
async function linked() {
	if (!selectedUser) return;
	const target = selectedUser.objectId;
	mode = "comments";
	lastMode = "comments";
	detail = null;
	rows = null;
	search = path = "";
	status = "all";
	page = 1;
	userId = target;
	await run(loadRows);
}
async function reconcile() {
	await run(async () => {
		if (mode === "comments" && detail)
			detail = await request<Thread>(
				`/api/manage/comments/${detail.item.objectId}`,
			);
		else if (mode === "users" && selectedUser) {
			selectedUser = await request<User>(
				`/api/manage/users/${selectedUser.objectId}`,
			);
			await loadRows();
		} else if (mode === "account") {
			account = await request<Account>("/api/manage/account");
			sessions = await request<BackendSession[]>("/api/manage/sessions");
		}
		refreshedUnknown = true;
	});
}
</script>

<section class="management">
<div class="heading"><div><p class="eyebrow">WALINE MANAGEMENT</p><h1>{words[mode]}</h1><p class="muted">{words.noTwikoo}</p></div><button disabled={busy} onclick={()=>void initialize()}>{words.refresh}</button></div>
{#if info}<div class="panel management-source"><strong>{words.source}</strong><code>{info.source}</code><small>{info.overlay}</small></div>{/if}
{#if error}<p class="feedback error" role="alert">{error}</p>{/if}
{#if notice}<p class="feedback" role="status">{notice}</p>{/if}
{#if busy}<p role="status">{words.loading}</p>{/if}
{#if pending}<section class="panel management-confirm" role="alert"><h2>{words.reason}：{pending.label}</h2><p>{pending.object}</p><p>{pending.action.endsWith('/delete')?words.deleteNotice:words.confirmNotice}</p>{#if pending.action.endsWith('/delete') && detail}<strong>当前预计删除 {detail.deleteCount} 条（提交前仍可能变化）</strong>{/if}<div class="editor-actions"><button class="danger" disabled={busy} onclick={()=>void submit()}>{busy?words.saving:words.confirm}</button><button disabled={busy} onclick={()=>pending=null}>{words.cancel}</button></div></section>{/if}
{#if unknown}<div class="panel management-confirm"><p>{words.unknown}</p><button disabled={busy} onclick={()=>void reconcile()}>{words.refresh}</button><button disabled={busy || !refreshedUnknown} onclick={()=>{unknown=false;refreshedUnknown=false;}}>{words.resultUnknown}</button></div>{/if}
{#if mode!=="account"}
<section class="panel"><form class="toolbar" onsubmit={event=>{event.preventDefault();filter();}}><label>{mode==="users"?words.userSearch:words.search}<input bind:value={search} maxlength="150" /></label>{#if mode==="comments"}<label>{words.path}<input bind:value={path} maxlength="500" /></label><select aria-label={words.state} bind:value={status}><option value="all">{words.all}</option><option value="approved">{words.approved}</option><option value="waiting">{words.waiting}</option><option value="spam">{words.spam}</option></select>{/if}<button disabled={busy} type="submit">{words.check}</button></form>
{#if userId}<p>关联用户 #{userId} <button disabled={busy} onclick={()=>{userId="";filter();}}>清除筛选</button></p>{/if}
{#if rows}<p class="muted">{rows.total} {words.total}</p>{#each rows.items as item (item.objectId)}<article class="row"><div class="row-main">{#if "comment" in item}<strong>{item.nick || "匿名"} · #{item.objectId} · {words[item.status]}</strong><p class="comment-snippet">{item.comment}</p><small>{item.article || item.url}{item.user_id?` · 用户 #${item.user_id}`:""}</small>{:else}<strong>{item.display_name} · #{item.objectId}</strong><p>{item.email}</p><small>{userType(item.type)}</small>{/if}</div><button disabled={busy} onclick={()=>void open(item.objectId)}>{words.detail}</button></article>{/each}{#if !rows.items.length}<p class="feedback">{words.empty}</p>{/if}<footer class="pagination"><span>{rows.page} / {Math.max(1,rows.pages)}</span><div><button disabled={busy || page<=1} onclick={()=>turnPage(page-1)}>{words.prev}</button><button disabled={busy || page>=rows.pages} onclick={()=>turnPage(page+1)}>{words.next}</button></div></footer>{/if}</section>
{/if}
{#if mode==="comments" && detail}
<section class="panel management-detail"><h2>#{detail.item.objectId} · {detail.item.nick}</h2><p>{detail.item.url} · {words[detail.item.status]}</p><p class="muted">{words.concurrency}</p><p class="muted">{words.notifications}</p><h3>{words.original}</h3><pre class="comment-text">{detail.item.comment}</pre><label>编辑正文<textarea bind:value={editText} maxlength="20000" rows="5"></textarea></label><div class="editor-actions"><button disabled={busy || unknown || editText===detail.item.comment || !editText.trim()} onclick={()=>commentAction('edit',words.edit,{comment:editText})}>{words.edit}</button>{#each ['approved','waiting','spam'] as state}<button disabled={busy || unknown || detail.item.status===state} onclick={()=>commentAction('status',words[state as keyof typeof words],{status:state})}>{words[state as keyof typeof words]}</button>{/each}<button class="danger" disabled={busy || unknown} onclick={()=>commentAction('delete',words.remove)}>{words.remove}</button></div>
<h3>{words.context}</h3>{#each detail.thread as item (item.objectId)}<article class="thread-row"><strong>#{item.objectId} · {item.nick} · {words[item.status]}</strong><small>回复 #{item.pid || '—'} · 根 #{item.rid || item.objectId}</small><pre class="comment-text">{item.comment}</pre><button disabled={busy || unknown} onclick={()=>void open(item.objectId)}>{words.detail}</button></article>{/each}<div class="pagination"><span>{words.threadPage} {detail.page}/{Math.max(1,detail.pages)}</span><div><button disabled={busy || detail.page<=1} onclick={()=>detail && void open(detail.item.objectId,detail.page-1,true)}>{words.prev}</button><button disabled={busy || detail.page>=detail.pages} onclick={()=>detail && void open(detail.item.objectId,detail.page+1,true)}>{words.next}</button></div></div>
<label>以当前博主身份回复 #{detail.item.objectId}<textarea bind:value={replyText} maxlength="20000" rows="4"></textarea></label><p class="muted">{words.keep}</p><button class="primary" disabled={busy || unknown || !replyText.trim()} onclick={()=>commentAction('reply',words.reply,{comment:replyText})}>{words.reply}</button></section>
{:else if mode==="users" && selectedUser}
<section class="panel management-detail"><h2>{selectedUser.display_name} · #{selectedUser.objectId}</h2><p>{selectedUser.email}</p><p>{selectedUser.url}</p><p>{words.state}：{userType(selectedUser.type)}</p><div class="editor-actions"><button disabled={busy} onclick={()=>void linked()}>{words.linked}</button>{#if ['guest','banned'].includes(selectedUser.type)}<button class="danger" disabled={busy} onclick={()=>selectedUser && prepare(`/api/manage/users/${selectedUser.objectId}/state`,selectedUser.type==='guest'?words.ban:words.unban,`${selectedUser.display_name} · #${selectedUser.objectId}`,{fingerprint:selectedUser.fingerprint,type:selectedUser.type==='guest'?'banned':'guest'})}>{selectedUser.type==='guest'?words.ban:words.unban}</button>{:else}<p class="muted">管理员及未验证账号不提供状态操作；不开放注册、角色授予或删除。</p>{/if}</div></section>
{:else if mode==="account"}
{#if account}<section class="panel management-detail"><h2>#{account.objectId} · {account.display_name}</h2><p>{account.email}</p><p class="muted">{words.profileScope}</p><label>{words.nickname}<input bind:value={nickname} maxlength="100" /></label><label>{words.website}<input bind:value={website} maxlength="500" /></label><button disabled={busy || !nickname.trim()} onclick={()=>account && prepare('/api/manage/account/profile',words.profile,`#${account.objectId}`,{fingerprint:account.fingerprint,display_name:nickname,url:website})}>{words.profile}</button><h3>安全</h3><p>二步验证：{account.twoFactorEnabled?'已启用':'未启用'}</p><p class="muted">{words.security}</p>{#if info?.securityUrl}<a href={info.securityUrl} target="_blank" rel="noopener noreferrer">打开 Waline 安全页</a>{:else}<p class="muted">{words.securityUnavailable}</p>{/if}<form onsubmit={event=>{event.preventDefault();prepare('/api/manage/account/password',words.password,`#${account?.objectId} · 成功或写入结果未知后退出当前后台会话`,{currentPassword,password:newPassword,code});}}><label>{words.currentPassword}<input type="password" autocomplete="current-password" bind:value={currentPassword} required maxlength="1024" /></label><label>{words.newPassword}<input type="password" autocomplete="new-password" bind:value={newPassword} required minlength="8" maxlength="128" /></label><label>{words.code}<input bind:value={code} autocomplete="one-time-code" maxlength="16" /></label><button disabled={busy || unknown} type="submit">{words.password}</button></form></section>{/if}
<section class="panel management-detail"><h2>{words.sessions}</h2><p class="muted">{words.sessionsScope}</p>{#each sessions as session (session.id)}<article class="row"><div class="row-main"><strong>{session.current?words.current:session.id.slice(0,8)}</strong><p>创建 {new Date(session.created).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</p><small>过期 {new Date(session.expires).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</small></div><button disabled={busy} onclick={()=>prepare('/api/manage/sessions/revoke',words.revoke,session.current?words.current:session.id.slice(0,8),{id:session.id})}>{words.revoke}</button></article>{/each}</section>
{/if}
</section>
