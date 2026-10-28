<script lang="ts">
import Icon from "@iconify/svelte";
import logoLight from "../../cache/admin-assets/logo-light.webp";
import logoDark from "../../cache/admin-assets/logo-dark.webp";
import { onMount } from "svelte";
import type { ConfigurationKind } from "../shared/configuration.js";
import type { DraftDetail } from "../shared/contracts";
import { words as analyticsWords } from "./analytics-words.js";
import Dashboard from "./Dashboard.svelte";
import LazyPage from "./LazyPage.svelte";
import { apiMessage, connectionMessage } from "./i18n";
import UserAvatar from "./UserAvatar.svelte";
import { memosWords } from "./memos-words.js";
import { words as managementWords } from "./management-words.js";

type Entry = {
	id: string;
	title: string;
	published: string;
	publishedDate: string;
	draft: boolean;
	url: string;
	description: string;
	tags: string[];
	category: string;
	format: string;
};
type Page = {
	items: Entry[];
	total: number;
	page: number;
	pageSize: number;
	pages: number;
};
type Result<T> =
	| { ok: true; data: T }
	| { ok: false; error: { code: string; message: string } };
type Kind = "posts" | "dynamic";
type Status = "all" | "published" | "draft";
const words = {
	title: "管理后台",
	posts: "文章",
	dynamic: "动态",
	login: "登录",
	logout: "退出登录",
	search: "搜索标题、正文摘要或标签",
	all: "全部",
	published: "已发布",
	draft: "仓库草稿",
	loading: "正在加载…",
	empty: "没有符合条件的内容",
	retry: "重试",
	prev: "上一页",
	next: "下一页",
	username: "邮箱或昵称",
	password: "密码",
	code: "二步验证码（如已启用）",
	menu: "打开导航",
	close: "关闭导航",
};
let editor: DraftDetail | null = null;
let publishing = false;
let dashboardMode: "overview" | "analytics" | null = "overview";
let analyticsFilters = { range: "today", start: "", end: "" };
let overviewCommentStatus = "all";
let overviewJobId: string | null = null;
let managementMode: "comments" | "users" | "account" | null = null;
let managementRef: { canLeave(): boolean } | undefined;
let mediaLibrary = false;
let memosMode = false;
let memosVisited = false;
let memosRef: { canLeave(): boolean } | undefined;
let configurationKind: ConfigurationKind | null = null;
let configurationRef: { canLeave(): boolean } | undefined;
let editorRef: { canLeave(): boolean } | undefined;
let expired = false;
let reauthDialog: HTMLDialogElement;
$: if (expired && reauthDialog && !reauthDialog.open) reauthDialog.showModal();
let privateMode = false;
let draftPage: {
	items: {
		id: string;
		path: string;
		revision: number;
		updated_at: string;
		snapshot: boolean;
	}[];
	total: number;
	page: number;
} | null = null;
let newPath = "";
let creating = false;
let editorBusy = false;
let editorRequestVersion = 0;
let createRequest: Record<string, unknown> | null = null;
function leaveEditor() {
	if (memosMode && memosRef && !memosRef.canLeave()) return false;
	if (managementRef && !managementRef.canLeave()) return false;
	managementMode = null;
	managementRef = undefined;
	if (editorRef && !editorRef.canLeave()) return false;
	if (configurationRef && !configurationRef.canLeave()) return false;
	dashboardMode = null;
	overviewCommentStatus = "all";
	overviewJobId = null;
	configurationKind = null;
	configurationRef = undefined;
	editor = null;
	editorRef = undefined;
	memosMode = false;
	editorRequestVersion++;
	editorBusy = false;
	return true;
}
function changeMemos() {
	if (!leaveEditor()) return;
	memosMode = true;
	publishing = mediaLibrary = false;
	if (drawer) closeDrawer();
}
function changeConfiguration(next: ConfigurationKind) {
	if (!leaveEditor()) return;
	configurationKind = next;
	publishing = mediaLibrary = false;
	if (drawer) closeDrawer();
}
function dashboardNavigate(target: {
	view: string;
	kind?: Kind;
	status?: string;
	private?: boolean;
	jobId?: string;
}) {
	if (target.view === "memos") {
		changeMemos();
	} else if (target.view === "content") {
		changeKind(target.kind || "posts", false);
		privateMode = !!target.private;
		status =
			target.status === "draft"
				? "draft"
				: target.status === "published"
					? "published"
					: "all";
		void load();
	} else if (["comments", "users"].includes(target.view)) {
		changeManagement(target.view as "comments" | "users");
		overviewCommentStatus = target.status || "all";
	} else if (["music", "gallery", "settings"].includes(target.view))
		changeConfiguration(target.view as ConfigurationKind);
	else if (leaveEditor()) {
		publishing = mediaLibrary = false;
		if (target.view === "media") {
			mediaLibrary = true;
		} else if (target.view === "publishing") {
			publishing = true;
			overviewJobId = target.jobId || null;
		} else
			dashboardMode = target.view === "analytics" ? "analytics" : "overview";
		if (drawer) closeDrawer();
	}
}
function changeManagement(next: "comments" | "users" | "account") {
	if (!leaveEditor()) return;
	managementMode = next;
	publishing = mediaLibrary = false;
	if (drawer) closeDrawer();
}
async function openDraft(id: string) {
	if (!leaveEditor()) return;
	const current = ++editorRequestVersion;
	editorBusy = true;
	errorText = "";
	try {
		const result = await request<DraftDetail>(`/api/drafts/${id}`);
		if (current !== editorRequestVersion) return;
		if (result.ok) editor = result.data;
		else {
			errorText = apiMessage(result.error);
			if (result.error.code === "UNAUTHORIZED") owner = null;
		}
	} catch (cause) {
		if (current === editorRequestVersion) errorText = message(cause);
	} finally {
		if (current === editorRequestVersion) editorBusy = false;
	}
}
async function createDraft(path: string, fromSource = false) {
	const current = ++editorRequestVersion;
	editorBusy = true;
	errorText = "";
	createRequest ||= { requestId: crypto.randomUUID(), kind, path, fromSource };
	try {
		const result = await request<DraftDetail>("/api/drafts", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(createRequest),
		});
		if (current !== editorRequestVersion) return;
		if (result.ok) {
			editor = result.data;
			creating = false;
			createRequest = null;
		} else {
			errorText = apiMessage(result.error);
			if (result.error.code === "UNAUTHORIZED") owner = null;
		}
	} catch (cause) {
		if (current === editorRequestVersion) errorText = message(cause);
	} finally {
		if (current === editorRequestVersion) editorBusy = false;
	}
}
function switchPrivate() {
	if (!leaveEditor()) return;
	privateMode = !privateMode;
	page = 1;
	void load();
}
let testEnvironment = "";
let configured = false;
let blogOrigin = "";
let missing: string[] = [];
let booting = true;
let owner: { id: number; name: string } | null = null;
$: if (!owner) memosVisited = false;
$: if (owner && memosMode) memosVisited = true;
let ownerAvatar = "";
async function loadOwnerAvatar() {
 const current = owner;
 ownerAvatar = "";
 if (!current) return;
 try {
  const result = await request<{avatar: string}>("/api/manage/account");
  if (owner === current && result.ok) ownerAvatar = result.data.avatar || "";
 } catch { /* Keep the initials when the profile service is unavailable. */ }
}
$: if (!owner) ownerAvatar = "";
let identity = "";
let password = "";
let code = "";
let errorText = "";
let loginBusy = false;
let kind: Kind = "posts";
let status: Status = "all";
let search = "";
let page = 1;
let data: Page | null = null;
let loading = false;
let drawer = false;
let mobile = false;
let dark = false;
let themeOverride: boolean | null = null;
let navigation: HTMLElement;
function toggleTheme() {
 dark = !dark;
 themeOverride = dark;
 document.documentElement.dataset.theme = dark ? 'dark' : 'light';
 try { localStorage.setItem('dc-admin-theme', dark ? 'dark' : 'light'); } catch {}
}
let drawerTrigger: HTMLElement | null = null;
function openDrawer(event?: MouseEvent) {
 drawerTrigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : menuButton;
 drawer = true;
 requestAnimationFrame(() => navigation?.querySelector<HTMLButtonElement>('button')?.focus());
}
function trapDrawer(event: KeyboardEvent) {
 if (!drawer || event.key !== 'Tab') return;
 const buttons = Array.from(navigation.querySelectorAll<HTMLButtonElement>('button:not(:disabled), a[href]'));
 const first = buttons[0], last = buttons[buttons.length - 1];
 if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
 else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
$: pageTitle = memosMode ? memosWords.nav : dashboardMode ? analyticsWords[dashboardMode] : managementMode ? managementWords[managementMode] : configurationKind === 'music' ? 'BGM 歌单' : configurationKind === 'gallery' ? '相册' : configurationKind === 'settings' ? '站点设置' : mediaLibrary ? '统一媒体库' : publishing ? '改动与发布' : kind === 'posts' ? words.posts : words.dynamic;
$: sectionTitle = dashboardMode ? '概览与数据' : managementMode ? '评论与账号' : configurationKind || mediaLibrary ? '媒体与站点' : '内容创作';
let menuButton: HTMLButtonElement;
let requestVersion = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

async function request<T>(url: string, init?: RequestInit): Promise<Result<T>> {
	const response = await fetch(url, {
		credentials: "same-origin",
		cache: "no-store",
		...init,
	});
	return response.json() as Promise<Result<T>>;
}
function message(_cause: unknown) {
	return connectionMessage();
}
async function initialize() {
	try {
		const state = await request<{
			configured: boolean;
			missing: string[];
			blogOrigin: string;
			testEnvironment?: string;
		}>("/api/status");
		if (!state.ok) {
			errorText = apiMessage(state.error);
			return;
		}
		configured = state.data.configured;
		testEnvironment = state.data.testEnvironment || "";
		blogOrigin = state.data.blogOrigin;
		missing = state.data.missing;
		if (configured) {
			const me = await request<{ id: number; name: string }>("/api/me");
			if (me.ok) {
				owner = me.data;
				void loadOwnerAvatar();
				if (isContentView()) await load();
			} else if (me.error.code !== "UNAUTHORIZED")
				errorText = apiMessage(me.error);
		}
	} catch (cause) {
		errorText = message(cause);
	} finally {
		booting = false;
	}
}
onMount(() => {
	void initialize();
 const colorQuery = matchMedia('(prefers-color-scheme: dark)');
 const mobileQuery = matchMedia('(max-width: 760px)');
 try { const saved = localStorage.getItem('dc-admin-theme'); if (saved === 'dark' || saved === 'light') themeOverride = saved === 'dark'; } catch {}
 const syncColor = () => { if (themeOverride === null) { dark = colorQuery.matches; document.documentElement.dataset.theme = dark ? 'dark' : 'light'; } };
 dark = themeOverride ?? colorQuery.matches;
 document.documentElement.dataset.theme = dark ? 'dark' : 'light';
 const syncMobile = () => { mobile = mobileQuery.matches; if (!mobile) drawer = false; };
 syncMobile();
 colorQuery.addEventListener('change', syncColor);
 mobileQuery.addEventListener('change', syncMobile);
 return () => {
 colorQuery.removeEventListener('change', syncColor);
 mobileQuery.removeEventListener('change', syncMobile);
		clearTimeout(timer);
	};
});
async function login() {
	loginBusy = true;
	errorText = "";
	try {
		const result = await request<{ id: number; name: string }>("/api/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ identity, password, code }),
		});
		if (!result.ok) {
			errorText = apiMessage(result.error);
			return;
		}
		owner = result.data;
		void loadOwnerAvatar();
		password = "";
		code = "";
		expired = false;
		if (isContentView()) await load();
	} catch (cause) {
		errorText = message(cause);
	} finally {
		loginBusy = false;
	}
}
async function logout() {
	if (!leaveEditor()) return;
	try {
		const result = await request<null>("/api/logout", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		if (!result.ok) {
			errorText = apiMessage(result.error);
			return;
		}
		owner = null;
		data = null;
		drawer = false;
		errorText = "";
	} catch (cause) {
		errorText = message(cause);
	}
}
function isContentView() {
 return !memosMode && !dashboardMode && !managementMode && !configurationKind && !mediaLibrary && !publishing && !editor;
}
async function load() {
	if (!owner || !isContentView()) return;
	if (privateMode) {
		const current = ++requestVersion;
		loading = true;
		errorText = "";
		try {
			const result = await request<NonNullable<typeof draftPage>>(
				`/api/drafts?kind=${kind}&page=${page}`,
			);
			if (current !== requestVersion) return;
			if (result.ok) draftPage = result.data;
			else {
				errorText = apiMessage(result.error);
				if (result.error.code === "UNAUTHORIZED") owner = null;
			}
		} catch (cause) {
			if (current === requestVersion) errorText = message(cause);
		} finally {
			if (current === requestVersion) loading = false;
		}
		return;
	}
	const current = ++requestVersion;
	loading = true;
	errorText = "";
	const params = new URLSearchParams({
		status,
		search,
		page: String(page),
		pageSize: "15",
	});
	try {
		const result = await request<Page>(`/api/content/${kind}?${params}`);
		if (current !== requestVersion) return;
		if (!result.ok) {
			if (result.error.code === "UNAUTHORIZED") {
				owner = null;
				data = null;
			}
			errorText = apiMessage(result.error);
			return;
		}
		data = result.data;
	} catch (cause) {
		if (current === requestVersion) errorText = message(cause);
	} finally {
		if (current === requestVersion) loading = false;
	}
}
function changeKind(next: Kind, shouldLoad = true) {
	if (!leaveEditor()) return;
	publishing = false;
	mediaLibrary = false;
	creating = false;
	createRequest = null;
	draftPage = null;
	kind = next;
	status = "all";
	search = "";
	page = 1;
	if (drawer) closeDrawer();
	data = null;
	if (shouldLoad) void load();
}
function closeDrawer() {
	drawer = false;
	requestAnimationFrame(() => (drawerTrigger || menuButton)?.focus());
}
function changeFilter() {
	page = 1;
	void load();
}
function changeSearch() {
	clearTimeout(timer);
	timer = setTimeout(changeFilter, 300);
}
function changePage(next: number) {
	page = next;
	void load();
}
</script>

{#if testEnvironment}<div class="test-banner" role="status">{testEnvironment}</div>{/if}
<svelte:window onkeydown={(event) => { if (event.key === "Escape" && drawer) closeDrawer(); trapDrawer(event); }} />

{#if booting}
  <main class="center"><div class="loader" aria-label={words.loading}></div><p>{words.loading}</p></main>
{:else if !configured}
  <main class="center"><section class="notice"><img class="brand-logo" src={dark ? logoDark : logoLight} alt="DcElysion" /><h1>{missing.length ? "后台尚未配置" : "无法连接后台"}</h1>{#if missing.length}<p>请在服务端配置以下字段，然后重启后台服务。</p><code>{missing.join(" · ")}</code><p class="muted">页面可查看，登录及内容接口当前不可用。</p>{:else}<p class="error" role="alert">{errorText || "请检查服务状态并刷新页面。"}</p>{/if}</section></main>
{:else if !owner}
  <main class="center login-layout"><div class="login-story"><p class="eyebrow">DCELYSION / WORKSPACE</p><h2>让灵感，<br />在这里生长。</h2><p>写下生活，收藏热爱。<br />从一篇文章、一张照片开始。</p><div class="login-orbit" aria-hidden="true"><span>✦</span></div><small>你的博客，你的创作空间。</small></div><section class="login-card"><img class="brand-logo" src={dark ? logoDark : logoLight} alt="DcElysion" /><p class="eyebrow">DCELYSION · ADMIN</p><h1>欢迎回来</h1><p class="muted">使用现有 Waline 管理账号登录。</p>
    <form onsubmit={(event) => { event.preventDefault(); void login(); }}>
      <label>{words.username}<input name="identity" autocomplete="username" bind:value={identity} required /></label>
      <label>{words.password}<input name="password" type="password" autocomplete="current-password" bind:value={password} required /></label>
      <label>{words.code}<input name="code" inputmode="numeric" autocomplete="one-time-code" bind:value={code} /></label>
      {#if errorText}<p class="error" role="alert">{errorText}</p>{/if}
      <button class="primary" type="submit" disabled={loginBusy}>{loginBusy ? words.loading : words.login}<Icon icon="material-symbols:arrow-forward-rounded" /></button>
    </form>
  </section></main>
{:else}
  <div class="shell with-comment-nav">
    {#if drawer}<button class="scrim" aria-label={words.close} onclick={closeDrawer}></button>{/if}
    <aside bind:this={navigation} class:open={drawer} aria-label="主导航" inert={mobile && !drawer}>
      <div class="brand"><img class="brand-logo" src={dark ? logoDark : logoLight} alt="DcElysion" /><button class="drawer-close icon-button" aria-label={words.close} onclick={closeDrawer}>×</button></div><nav class="side-nav" aria-label="后台功能">
      <div class="nav-group"><span class="nav-label">概览与数据</span>{#each ['overview','analytics'] as view}<button class:active={dashboardMode===view} onclick={()=>dashboardNavigate({view})}><Icon icon={view === 'overview' ? 'material-symbols:space-dashboard-outline-rounded' : 'material-symbols:monitoring-rounded'} />{analyticsWords[view as 'overview'|'analytics']}</button>{/each}</div>
      <div class="nav-group"><span class="nav-label">内容创作</span>
        <button class:active={kind === "posts" && !memosMode && !dashboardMode && !publishing && !mediaLibrary && !configurationKind && !managementMode} disabled={editorBusy} onclick={() => changeKind("posts")}><Icon icon="material-symbols:article-outline-rounded" />{words.posts}</button>
        <button class:active={kind === "dynamic" && !memosMode && !dashboardMode && !publishing && !mediaLibrary && !configurationKind && !managementMode} disabled={editorBusy} onclick={() => changeKind("dynamic")}><Icon icon="material-symbols:dynamic-feed-outline-rounded" />动态归档</button>
        <button class:active={memosMode} disabled={editorBusy} onclick={changeMemos}><Icon icon="material-symbols:edit-note-rounded" />{memosWords.nav}</button>
      </div>
      <div class="nav-group"><span class="nav-label">媒体与站点</span>
        <button class:active={mediaLibrary} disabled={editorBusy} onclick={()=>{if(leaveEditor()){mediaLibrary=true;publishing=false;if(drawer)closeDrawer();}}}><Icon icon="material-symbols:perm-media-outline-rounded" />统一媒体库</button>
        <button class:active={configurationKind==='music'} onclick={() => changeConfiguration('music')}><Icon icon="material-symbols:music-note-rounded" />BGM 歌单</button>
        <button class:active={configurationKind==='gallery'} onclick={() => changeConfiguration('gallery')}><Icon icon="material-symbols:photo-library-outline-rounded" />相册</button>
      </div>
      <div class="nav-group"><span class="nav-label">评论与账号</span>{#each ['comments','users','account'] as item}<button class:active={managementMode===item} onclick={()=>changeManagement(item as 'comments'|'users'|'account')}><Icon icon={item === 'comments' ? 'material-symbols:forum-outline-rounded' : item === 'users' ? 'material-symbols:group-outline-rounded' : 'material-symbols:shield-person-outline-rounded'} />{managementWords[item as 'comments'|'users'|'account']}</button>{/each}</div>
      </nav><div class="side-bottom"><UserAvatar src={ownerAvatar} name={owner.name}/><div class="account"><strong>{owner.name}</strong><small>站点管理员</small></div><button class="icon-button" title={words.logout} aria-label={words.logout} onclick={() => void logout()}><Icon icon="material-symbols:logout-rounded" /></button></div>
    </aside>
    <main class="content" inert={mobile && drawer}>
      <header class="topbar"><button bind:this={menuButton} class="menu-button" aria-label={words.menu} aria-expanded={drawer} onclick={openDrawer}><Icon icon="material-symbols:menu-rounded" /></button><div class="breadcrumb"><span class="breadcrumb-section">{sectionTitle} /</span> <strong>{pageTitle}</strong></div><div class="top-tools"><button class="icon-button" onclick={toggleTheme} aria-label={dark ? '切换浅色模式' : '切换深色模式'} title={dark ? '切换浅色模式' : '切换深色模式'}><Icon icon={dark ? 'material-symbols:light-mode-outline-rounded' : 'material-symbols:dark-mode-outline-rounded'} /></button>{#if blogOrigin}<a class="blog-link" href={blogOrigin} target="_blank" rel="noopener noreferrer">查看博客 <Icon icon="material-symbols:open-in-new-rounded" /></a>{/if}</div></header>
      <div class="page-body">
       {#if memosVisited}
        <div hidden={!memosMode} inert={!memosMode}><LazyPage loader={() => import("./MemosEmbed.svelte")} let:value><svelte:component this={value.default} bind:this={memosRef} onexpired={() => expired = true}/></LazyPage></div>
       {/if}
       {#if !memosMode}
       {#if dashboardMode}
        {#key dashboardMode}<Dashboard mode={dashboardMode} bind:filters={analyticsFilters} onexpired={()=>expired=true} onnavigate={dashboardNavigate}/>{/key}
       {:else if managementMode}
        <LazyPage loader={() => import("./Management.svelte")} let:value><svelte:component this={value.default} {blogOrigin} bind:this={managementRef} bind:mode={managementMode} initialStatus={overviewCommentStatus} onexpired={()=>expired=true} onsignout={()=>{owner=null;managementMode=null;managementRef=undefined;}} /></LazyPage>
       {:else if configurationKind}
        {#key configurationKind}<LazyPage loader={() => import("./ConfigurationEditor.svelte")} let:value><svelte:component this={value.default} bind:this={configurationRef} kind={configurationKind} onexpired={() => expired=true}/></LazyPage>{/key}
       {:else if mediaLibrary}
        <LazyPage loader={() => import("./MediaLibrary.svelte")} let:value><svelte:component this={value.default} onexpired={()=>expired=true}/></LazyPage>
       {:else if publishing}
        <LazyPage loader={() => import("./Publishing.svelte")} let:value><svelte:component this={value.default} initialJobId={overviewJobId} onexpired={()=>expired=true}/></LazyPage>
       {:else if editor}
        {#key editor}<LazyPage loader={() => import("./Editor.svelte")} let:value><svelte:component this={value.default} bind:this={editorRef} initial={editor} onback={() => { if (leaveEditor()) void load(); }} onexpired={() => expired = true} onreplace={(detail) => editor = detail} /></LazyPage>{/key}
       {:else}
       <div class="heading library-heading"><div><p class="eyebrow">CONTENT LIBRARY</p><h1>{kind === "posts" ? '文章书架' : '动态归档'} <span class="count">{privateMode ? draftPage?.total ?? 0 : data?.total ?? '—'}</span></h1><p class="muted">{kind === 'posts' ? '让想法成为文字，慢慢积累自己的作品。' : '管理保存在博客仓库中的动态与图片。'}</p></div><button class="primary" disabled={editorBusy} onclick={() => { creating = !creating; newPath = ""; createRequest = null; }}><Icon icon="material-symbols:add-rounded" />新建私有草稿</button></div>
       <div class="library-tabs" aria-label="内容来源"><button class:active={!privateMode} aria-pressed={!privateMode} disabled={editorBusy} onclick={()=>{if(privateMode)switchPrivate();}}>仓库内容</button><button class:active={privateMode} aria-pressed={privateMode} disabled={editorBusy} onclick={()=>{if(!privateMode)switchPrivate();}}>私有草稿</button><span>私有保存不会更改公开内容</span></div>
        {#if creating}<form class="new-draft panel" onsubmit={(event) => { event.preventDefault(); void createDraft(newPath); }}><label>拟用文件路径（含 .md / 文章可用 .mdx）<input bind:value={newPath} oninput={() => createRequest = null} placeholder={kind === "posts" ? "my-post.md" : "2026-09-30-120000.md"} required disabled={editorBusy} /></label><button disabled={editorBusy} type="submit">创建并编辑</button><p class="muted">仅预留受控内容路径，现有 URL 和文件不会变动。</p></form>{/if}
        {#if privateMode}
         <section class="panel"><h2 class="private-title">私有草稿 · {draftPage?.total ?? 0} 条</h2>{#if errorText}<div class="feedback error" role="alert"><p>{errorText}</p><button onclick={() => void load()}>重试</button></div>{:else if loading}<p class="feedback">正在加载…</p>{:else if !draftPage?.items.length}<p class="feedback">还没有私有草稿</p>{:else}{#each draftPage.items as draft}<article class="row"><div class="row-main"><strong>{draft.path}</strong><p>r{draft.revision} · {new Date(draft.updated_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}{draft.snapshot ? " · 私有副本" : ""}</p></div><button disabled={editorBusy} onclick={() => void openDraft(draft.id)}>继续编辑</button></article>{/each}{/if}{#if draftPage && draftPage.total > 30}<footer class="pagination"><span>第 {page} 页</span><div><button disabled={page <= 1 || loading} onclick={() => changePage(page - 1)}>上一页</button><button disabled={page * 30 >= draftPage.total || loading} onclick={() => changePage(page + 1)}>下一页</button></div></footer>{/if}</section>
        {:else}
        <section class="panel"><div class="toolbar"><div class="search"><Icon icon="material-symbols:search-rounded" /><input aria-label={words.search} placeholder={words.search} bind:value={search} oninput={changeSearch} /></div><select aria-label="发布状态" bind:value={status} onchange={changeFilter}><option value="all">{words.all}</option><option value="published">{words.published}</option><option value="draft">{words.draft}</option></select></div>
          {#if errorText}<div class="feedback error" role="alert"><p>{errorText}</p><button onclick={() => void load()}>{words.retry}</button></div>
          {:else if loading}<div class="feedback"><div class="loader"></div><p>{words.loading}</p></div>
          {:else if !data || data.items.length === 0}<div class="feedback"><Icon icon="material-symbols:inbox-outline-rounded" /><h2>{words.empty}</h2><p>试试其他关键词或状态筛选。</p></div>
          {:else}<div class="list" aria-busy={loading}>
            {#each data.items as item (item.id)}<article class="row"><div class="file-icon"><Icon icon={kind === "posts" ? "material-symbols:article-outline-rounded" : "material-symbols:chat-bubble-outline-rounded"} /></div><div class="row-main"><div class="row-title"><strong title={item.title}>{item.title}</strong><span class:draft={item.draft} class="badge">{item.draft ? words.draft : words.published}</span></div><p>{item.description || item.id}</p><div class="meta"><span>{item.publishedDate}</span><span>·</span><span>{item.format.toUpperCase()}</span>{#if item.category}<span>·</span><span>{item.category}</span>{/if}</div></div><button disabled={editorBusy} onclick={() => { createRequest = null; void createDraft(item.id, true); }}>编辑</button>{#if !item.draft}<a class="view-link" href={`${blogOrigin}${item.url}`} target="_blank" rel="noopener noreferrer" aria-label={`查看 ${item.title}`}><Icon icon="material-symbols:open-in-new-rounded" /></a>{/if}</article>{/each}
          </div>{/if}
          {#if data && data.pages > 1 && !errorText}<footer class="pagination"><span>第 {data.page} / {data.pages} 页</span><div><button disabled={page <= 1 || loading} onclick={() => changePage(page - 1)}>{words.prev}</button><button disabled={page >= data.pages || loading} onclick={() => changePage(page + 1)}>{words.next}</button></div></footer>{/if}
        </section>
        {/if}
        {/if}
       {/if}
      </div>
    </main>
    <nav class="mobile-tabs" aria-label={words.menu} inert={mobile && drawer}>
      <button class:active={dashboardMode === 'overview'} aria-current={dashboardMode === 'overview' ? 'page' : undefined} disabled={editorBusy} onclick={() => dashboardNavigate({view: 'overview'})}><Icon icon="material-symbols:space-dashboard-outline-rounded" /><span>{analyticsWords.overview}</span></button>
      <button class:active={kind === 'posts' && !memosMode && !dashboardMode && !publishing && !mediaLibrary && !configurationKind && !managementMode} disabled={editorBusy} onclick={() => changeKind('posts')}><Icon icon="material-symbols:article-outline-rounded" /><span>{words.posts}</span></button>
      <button class:active={memosMode} aria-current={memosMode ? 'page' : undefined} disabled={editorBusy} onclick={changeMemos}><Icon icon="material-symbols:edit-note-rounded" /><span>{memosWords.nav}</span></button>
      <button class:active={managementMode === 'comments'} aria-current={managementMode === 'comments' ? 'page' : undefined} disabled={editorBusy} onclick={() => changeManagement('comments')}><Icon icon="material-symbols:forum-outline-rounded" /><span>{managementWords.comments}</span></button>
    </nav>
  </div>
{/if}

{#if expired}<dialog bind:this={reauthDialog} class="login-card reauth-dialog" aria-label="重新登录" oncancel={() => expired = false}><h2>会话已过期</h2><p>编辑内容保留在当前页面内存中，请重新登录后重试保存。</p><form onsubmit={(event) => { event.preventDefault(); void login(); }}><label>邮箱或昵称<input bind:value={identity} autocomplete="username" required /></label><label>密码<input type="password" bind:value={password} autocomplete="current-password" required /></label><label>二步验证码<input bind:value={code} autocomplete="one-time-code" /></label>{#if errorText}<p role="alert" class="error">{errorText}</p>{/if}<button class="primary" disabled={loginBusy}>重新登录</button><button type="button" onclick={() => expired = false}>保留输入，继续查看</button></form></dialog>{/if}
