<script lang="ts">
import Icon from "@iconify/svelte";
import { onMount } from "svelte";
import {
	type AnalyticsReport,
	change,
	dimensions,
	type HostMetrics,
	type Overview,
	type Point,
	type Section,
} from "../shared/analytics.js";
import { bytes, time, words } from "./analytics-words.js";
import DataStatus from "./DataStatus.svelte";
import ResourceGauge from "./ResourceGauge.svelte";
import { apiMessage, connectionMessage } from "./i18n.js";
export let mode: "overview" | "analytics";
export let filters = { range: "today", start: "", end: "" };
export let onexpired: () => void;
export let onnavigate: (target: {
	view: string;
	kind?: "posts" | "dynamic";
	status?: string;
	private?: boolean;
	jobId?: string;
}) => void;
let report: AnalyticsReport | null = null;
let overview: Overview | null = null;
let analyticsLoading = false;
let overviewLoading = false;
let analyticsError = "";
let overviewError = "";
let version = 0;
let hostVersion = 0;
let overviewVersion = 0;
let overviewController: AbortController | null = null;
let controller: AbortController | null = null;
let hostController: AbortController | null = null;
let alive = true;
async function call<T>(url: string, signal?: AbortSignal): Promise<T> {
	const response = await fetch(url, {
		credentials: "same-origin",
		cache: "no-store",
		signal,
	});
	const result = await response.json();
	if (!result.ok) {
		if (result.error.code === "UNAUTHORIZED") onexpired();
		throw new Error(apiMessage(result.error));
	}
	return result.data;
}
function failure(cause: unknown) {
 return cause instanceof Error && cause.message !== "Failed to fetch"
  ? cause.message : connectionMessage();
}
async function loadAnalytics() {
 const current = ++version;
 controller?.abort();
 controller = new AbortController();
 analyticsLoading = true;
 analyticsError = "";
 report = null;
 const params = new URLSearchParams({ range: filters.range });
 if (filters.range === "custom") {
  params.set("start", filters.start);
  params.set("end", filters.end);
 }
 try {
  const result = await call<AnalyticsReport>(`/api/analytics?${params}`, controller.signal);
  if (alive && current === version) report = result;
 } catch (cause) {
  if (alive && current === version) analyticsError = failure(cause);
 } finally {
  if (alive && current === version) analyticsLoading = false;
 }
}
async function loadOverview() {
 const current = ++overviewVersion;
 overviewController?.abort();
 overviewController = new AbortController();
 // A host sample from the previous summary must not replace fresh summary data.
 hostVersion++;
 hostController?.abort();
 overviewLoading = true;
 overviewError = "";
 try {
  const result = await call<Overview>("/api/overview", overviewController.signal);
  if (alive && current === overviewVersion) overview = result;
 } catch (cause) {
  if (alive && current === overviewVersion) {
   overview = null;
   overviewError = failure(cause);
  }
 } finally {
  if (alive && current === overviewVersion) overviewLoading = false;
 }
}
function load() {
 void loadAnalytics();
 if (mode === "overview") void loadOverview();
}
async function sampleHost() {
	if (document.hidden || mode !== "overview" || overviewLoading) return;
	const current = ++hostVersion;
	hostController?.abort();
	hostController = new AbortController();
	try {
		const host = await call<Section<HostMetrics>>(
			"/api/overview/host",
			hostController.signal,
		);
		if (alive && current === hostVersion && overview)
			overview = { ...overview, host };
	} catch {
		if (alive && current === hostVersion && overview)
			overview = {
				...overview,
				host: {
					state: "error",
					data: null,
					sampledAt: null,
					reason: "HOST_UNAVAILABLE",
				},
			};
	}
}
function choose(range: string) {
	filters = { ...filters, range };
	if (range !== "custom") void loadAnalytics();
	else {
		report = null;
		version++;
		controller?.abort();
		analyticsLoading = false;
		analyticsError = "";
	}
}
function comparison(metric: "pageviews" | "visitors" | "visits") {
	if (
		!report?.stats.data ||
		!report.previous.data ||
		report.stats.state !== "success" ||
		report.previous.state !== "success"
	)
		return words.missing;
	const value = change(report.stats.data[metric], report.previous.data[metric]);
	return value === "new" || value === "no_comparison" ? words[value] : value;
}
function chartX(point: Point) {
	if (!report) return 0;
	const interval = report.trend.interval || report.range;
	const start =
		report.range.unit === "hour"
			? interval.startAt
			: Math.floor((interval.startAt + 28800000) / 86400000) * 86400000 -
				28800000;
	const stamp = Date.parse(`${point.x.replace(" ", "T")}+08:00`);
	return (
		12 +
		((stamp - start) / Math.max(3600000, interval.endAt - start)) * (570 - 12)
	);
}
function axis(edge: "startAt" | "endAt") {
	if (!report) return "";
	const interval = report.trend.interval || report.range;
	return new Date(interval[edge] + 28800000)
		.toISOString()
		.slice(5, report.range.unit === "hour" ? 16 : 10)
		.replace("T", " ");
}
function maximum(points: Point[]) {
	return Math.max(1, ...points.map((point) => point.y));
}
onMount(() => {
	void load();
	const interval = setInterval(() => void sampleHost(), 30000);
	const visible = () => {
		if (!document.hidden) void sampleHost();
	};
	document.addEventListener("visibilitychange", visible);
	return () => {
		alive = false;
		version++;
		hostVersion++;
		overviewVersion++;
		overviewController?.abort();
		controller?.abort();
		hostController?.abort();
		clearInterval(interval);
		document.removeEventListener("visibilitychange", visible);
	};
});
</script>

<section class="dashboard">
 {#if mode === 'overview'}
 <section class="workspace-welcome">
  <div class="welcome-copy"><p class="eyebrow">DCELYSION · CREATIVE SPACE</p><h1>你的创作工作台</h1><p>记录生活里的灵感，也照顾好每一份热爱。</p><div class="welcome-actions"><button class="primary" onclick={()=>onnavigate({view:'content',kind:'posts'})}><Icon icon="material-symbols:edit-square-outline-rounded" />管理文章</button><button onclick={()=>onnavigate({view:'memos'})}>记录动态 <span aria-hidden="true">↗</span></button></div></div>
  <div class="welcome-note" aria-hidden="true"><span class="note-star">✦</span><span>WRITE · COLLECT · SHARE</span><div class="note-lines"><i></i><i></i><i></i></div></div>
 </section>
 <div class="workspace-shortcuts"><button onclick={()=>onnavigate({view:'media'})}><Icon icon="material-symbols:perm-media-outline-rounded" /><span><strong>素材收藏</strong><small>管理图片、音频与视频</small></span><span aria-hidden="true">↗</span></button><button onclick={()=>onnavigate({view:'comments',status:'waiting'})}><Icon icon="material-symbols:forum-outline-rounded" /><span><strong>评论收件箱</strong><small>查看交流与待审核评论</small></span><span aria-hidden="true">↗</span></button></div>
 <div class="section-heading"><div><p class="eyebrow">YOUR LIBRARY</p><h2>内容与待办</h2></div><button disabled={overviewLoading} onclick={()=>void load()}>{words.refresh}</button></div>
 {:else}
 <div class="heading"><div><p class="eyebrow">INSIGHTS</p><h1>{words[mode]}</h1><p class="muted">了解阅读趋势，发现更受欢迎的内容。</p></div><button disabled={analyticsLoading} onclick={()=>void load()}>{words.refresh}</button></div>
 {/if}
 {#if mode==='overview' && overviewError}<div role="alert"><p class="error">{overviewError}</p><button onclick={()=>void loadOverview()}>重试</button></div>{/if}
 {#if mode==='overview' && overviewLoading}<p role="status">{words.loading}</p>{/if}
 {#if mode==='overview' && overview}
  <div class="metric-grid">
   {#each ['posts','dynamic'] as kind}<article class="panel metric"><h2>{kind==='posts'?'仓库文章':'仓库动态'}</h2><DataStatus section={overview.content}/>{#if overview.content.data}{@const counts=overview.content.data[kind as 'posts'|'dynamic']}<button onclick={()=>onnavigate({view:'content',kind:kind as 'posts'|'dynamic',status:'published'})}><b>{counts.public}</b> 非草稿</button><button onclick={()=>onnavigate({view:'content',kind:kind as 'posts'|'dynamic',status:'draft'})}>{counts.draft} 仓库草稿</button>{/if}<p class="muted">来源：当前仓库；非草稿不等于线上 release 数量。</p></article>{/each}
   <article class="panel metric"><h2>私有草稿与配置修订</h2><DataStatus section={overview.drafts}/>{#if overview.drafts.data}{#each ['posts','dynamic','music','gallery'] as kind}<button onclick={()=>onnavigate({view:['posts','dynamic'].includes(kind)?'content':kind,kind:kind as 'posts'|'dynamic',private:true})}>{{posts:'文章',dynamic:'动态',music:'歌单',gallery:'相册',settings:'站点设置'}[kind]}<span>{overview.drafts.data[kind] ?? 0}</span></button>{/each}{/if}<p class="muted">后台数据库当前库存；与仓库草稿独立。</p></article>
   <article class="panel metric"><h2>评论与用户</h2><DataStatus section={overview.comments}/>{#if overview.comments.data}<button onclick={()=>onnavigate({view:'comments'})}><b>{overview.comments.data.total}</b> 评论</button><button onclick={()=>onnavigate({view:'comments',status:'waiting'})}>{overview.comments.data.waiting} 待审核</button><button onclick={()=>onnavigate({view:'users'})}>{overview.comments.data.users} 用户</button>{/if}<p class="muted">来源：{overview.commentSource}；分页接口 total，非本页条数。</p></article>
  </div>
 {/if}
 {#if mode==='overview'}<div class="section-heading"><div><p class="eyebrow">READING & REACH</p><h2>博客访问</h2></div><button onclick={()=>onnavigate({view:'analytics'})}>查看分析 ↗</button></div>{/if}
 <div class="range-controls" aria-label="统计日期范围">
  {#each ['today','7d','30d','custom'] as range}<button aria-pressed={filters.range===range} class:primary={filters.range===range} onclick={()=>choose(range)}>{words[range as 'today'|'7d'|'30d'|'custom']}</button>{/each}
  {#if filters.range==='custom'}<form onsubmit={(event)=>{event.preventDefault();void loadAnalytics();}}><label>开始日期<input type="date" required bind:value={filters.start}/></label><label>结束日期<input type="date" required bind:value={filters.end}/></label><button type="submit" disabled={analyticsLoading}>应用（最多90天）</button></form>{/if}
 </div>
 {#if analyticsError}<div role="alert"><p class="error">{analyticsError}</p><button onclick={()=>void loadAnalytics()}>重试</button></div>{/if}
 {#if analyticsLoading}<p role="status">{words.loading}</p>{/if}
 {#if report}
  <details class="panel report-meta"><summary>统计来源与时间范围</summary><strong>{words.source}：{report.source} · {words.states[report.state]}</strong><p>站点 {report.websiteId}</p><p>{words.timezone} · {time(report.range.startAt)} — {time(report.range.endAt)}</p><p>对比：{report.range.preset==='today'?'昨日同期':'上一连续等长区间'} · {time(report.range.previousStart)} — {time(report.range.previousEnd)}</p><p class="muted">近7/30天含今日及前6/29天；今日截止当前分钟（部分日）。刷新 {time(report.refreshedAt)}{report.retryAt?` · 可重试于 ${time(report.retryAt)}`:''}</p></details>
  <div class="metric-grid analytics-metrics">{#each ['pageviews','visitors','visits'] as metric}<article class="panel metric"><h2>{words[metric as 'pageviews'|'visitors'|'visits']}</h2><DataStatus section={report.stats}/>{#if report.stats.data}<b class="number">{report.stats.data[metric as 'pageviews'|'visitors'|'visits']}</b><p>对比 {comparison(metric as 'pageviews'|'visitors'|'visits')}</p>{/if}</article>{/each}</div>
  <DataStatus section={report.previous}/>
  {#if mode==='analytics'}
   <section class="panel"><h2>PV 与桶内 UV 趋势</h2><DataStatus section={report.trend}/><p class="muted">仅绘制上游返回的时间桶；缺桶不填零，空响应表示没有记录。区间截至今日时，末桶未结束。</p>{#if report.trend.data}{#each ['pageviews','visitors'] as series}{@const points=report.trend.data[series as 'pageviews'|'visitors']}<h3>{series==='pageviews'?'PV 浏览量':'桶内 UV（不是访问次数）'}</h3>{#if points.length}<svg class="trend-chart" viewBox="0 0 600 150" role="img" aria-label={`${series} 趋势；明细见下表`}><line x1="10" y1="130" x2="590" y2="130" stroke="var(--border)"/>{#each points as point}<line x1={chartX(point)} x2={chartX(point)} y1="130" y2={130-110*point.y/maximum(points)} stroke={series==='pageviews'?'var(--accent)':'var(--success)'} stroke-width={report.range.unit==='hour'?10:5}><title>{point.x}：{point.y}</title></line>{/each}</svg><div class="chart-axis"><span>{axis("startAt")}</span><span>最高 {Math.max(0,...points.map(point=>point.y))}</span><span>{axis("endAt")}</span></div><details><summary>查看 {points.length} 个时间桶的数字</summary><div class="table-scroll"><table><thead><tr><th>北京时间</th><th>{series==='pageviews'?'PV':'桶内 UV'}</th></tr></thead><tbody>{#each points as point}<tr><td>{point.x}</td><td>{point.y}</td></tr>{/each}</tbody></table></div></details>{:else}<p>{words.empty}</p>{/if}{/each}{/if}</section>
   <div class="breakdown-grid">{#each dimensions as dimension}<section class="panel"><h2>{words[dimension]}</h2><DataStatus section={report.ranks[dimension]}/><p class="muted">所选区间 · 前10项（不是全部总数）</p>{#if report.ranks[dimension].data}{#if !report.ranks[dimension].data?.length}<p>{words.empty}</p>{:else}<table><thead><tr><th>维度值</th><th>数量</th></tr></thead><tbody>{#each report.ranks[dimension].data || [] as row}<tr><td>{#if row.title}<strong>{row.title}</strong><br/>{/if}{row.x || words.unknown}</td><td>{row.y}</td></tr>{/each}</tbody></table>{/if}{/if}</section>{/each}</div>
  {/if}
 {/if}
 {#if mode==='overview' && overview}
 <details class="panel host-details"><summary>后台所在主机 · 运行状态</summary>
 <div class="host-topline"><span class="host-eyebrow">SYSTEM RESOURCES</span><DataStatus section={overview.host}/></div>
 {#if overview.host.data}{@const host=overview.host.data}
 <div class="resource-grid">
 <ResourceGauge label="CPU 使用率" value={host.cpuPercent} detail={host.cores+' 核 · '+host.platform}/>
 <ResourceGauge label="系统内存" value={host.systemMemory.total>0 ? (1-host.systemMemory.free/host.systemMemory.total)*100 : null} detail={'空闲 '+bytes(host.systemMemory.free)+' / 总量 '+bytes(host.systemMemory.total)}/>
 <ResourceGauge label="磁盘空间" value={host.disk.data && host.disk.data.total>0 ? (1-host.disk.data.available/host.disk.data.total)*100 : null} detail={host.disk.data ? '可用 '+bytes(host.disk.data.available)+' / 总量 '+bytes(host.disk.data.total) : '磁盘数据暂不可用'}/>
 </div>
 <div class="process-strip"><div><span>进程运行</span><strong>{(host.processUptime/3600).toFixed(2)} <small>小时</small></strong></div><div><span>进程内存 RSS</span><strong>{bytes(host.processMemory.rss)}</strong></div><div><span>堆内存使用</span><strong>{bytes(host.processMemory.heapUsed)}</strong></div><div><span>CPU 采样间隔</span><strong>{host.cpuIntervalMs===null?'—':(host.cpuIntervalMs/1000).toFixed(1)+' 秒'}</strong></div></div>
 <details class="host-notes"><summary>采样范围与说明</summary><p class="muted">数据来自后台当前运行的 Node 主机；页面可见时每 30 秒采样，服务端缓存 10 秒。CPU 为两次采样间全核非空闲占比；磁盘为配置内容目录所在文件系统，可用空间可能受系统预留影响。</p><DataStatus section={host.disk}/><p class="muted">未采集网络吞吐、Nginx 错误率或响应时间。</p></details>
 {/if}</details>{/if}
</section>

<style>
.dashboard{display:grid;gap:18px;min-width:0}.dashboard .heading{margin-bottom:0}.range-controls{display:flex;flex-wrap:wrap;gap:8px}.range-controls form{display:flex;flex-wrap:wrap;gap:10px;align-items:end;width:100%}.range-controls label{display:grid;gap:6px}.metric-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.analytics-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.dashboard .panel{padding:20px;min-width:0}.dashboard h2{font-size:16px;margin:0 0 12px}.dashboard h3{font-size:14px;margin:16px 0 8px}.metric{display:flex;flex-direction:column;align-items:start;gap:8px}.metric button{max-width:100%;text-align:left}.metric b,.number{font-size:28px}.dashboard p{font-size:13px;line-height:1.6;margin:6px 0;overflow-wrap:anywhere}.report-meta{border-left:4px solid var(--accent)}.breakdown-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.dashboard table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}.dashboard th,.dashboard td{padding:9px 5px;text-align:left;border-bottom:1px solid var(--border);overflow-wrap:anywhere}.dashboard td:last-child,.dashboard th:last-child{width:78px;text-align:right;font-variant-numeric:tabular-nums}.trend-chart{display:block;width:100%;height:auto;min-height:115px}.chart-axis{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--text-muted)}.table-scroll{max-height:260px;overflow:auto}.dashboard :global(.data-status){font-size:12px;color:var(--text-muted);line-height:1.5;overflow-wrap:anywhere}.dashboard :global(.data-status span){display:block;color:var(--danger)}.dashboard :global(.data-status strong){font-size:12px}details summary{cursor:pointer;margin:10px 0}@media(max-width:650px){.metric-grid,.analytics-metrics,.breakdown-grid{grid-template-columns:minmax(0,1fr)}.dashboard .panel{padding:16px}.range-controls form{flex-direction:column;align-items:stretch}.range-controls input{width:100%;box-sizing:border-box}}
.range-controls{background:var(--surface);padding:6px;border:1px solid var(--border);border-radius:14px;justify-self:start}.range-controls>button{border:0;background:transparent}.range-controls>button.primary{background:var(--accent);color:var(--surface)}.range-controls form{padding:10px}.metric{position:relative;gap:10px;box-shadow:var(--shadow)}.metric b,.number{font-size:38px;letter-spacing:-.05em;color:var(--accent);font-variant-numeric:tabular-nums}.metric button{border:0;background:var(--surface-soft);width:100%;border-radius:10px;padding:10px 14px}.metric h2{color:var(--text-muted);font-weight:550}.metric>p:last-child{margin-top:auto;padding-top:12px}.report-meta summary,.host-details summary{font-weight:650;color:var(--text);margin:0;cursor:pointer}.report-meta[open] summary,.host-details[open] summary{margin-bottom:16px}.report-meta{border-left:1px solid var(--border)}.dashboard th{color:var(--text-muted);font-weight:550}.chart-axis{color:var(--text-muted)}
.workspace-welcome{display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:240px;padding:36px 40px;background:linear-gradient(120deg,var(--accent-soft),var(--surface));border-radius:24px;position:relative;overflow:hidden}.welcome-copy{position:relative;z-index:1}.welcome-copy .eyebrow{margin:0 0 12px}.welcome-copy h1{font-size:34px;line-height:1.3;margin-bottom:12px}.welcome-copy>p{color:var(--text-muted)}.welcome-actions{display:flex;gap:10px;margin-top:24px;flex-wrap:wrap}.welcome-actions button{display:flex;align-items:center;gap:8px;padding:11px 18px}.welcome-note{width:205px;height:170px;flex-shrink:0;background:var(--surface);border:1px solid var(--border);border-radius:16px;transform:rotate(8deg);padding:22px;box-shadow:var(--shadow);color:var(--accent)}.note-star{display:block;font-size:34px;line-height:1.3}.welcome-note>span:last-of-type{font-size:8px;letter-spacing:.12em}.note-lines{display:grid;gap:9px;margin-top:16px}.note-lines i{display:block;height:5px;border-radius:3px;background:var(--accent-soft)}.note-lines i:last-child{width:65%}.workspace-shortcuts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.workspace-shortcuts button{display:flex;align-items:center;gap:14px;text-align:left;padding:20px;border-radius:16px;min-width:0}.workspace-shortcuts button>span:nth-child(2){flex:1}.workspace-shortcuts strong,.workspace-shortcuts small{display:block}.workspace-shortcuts strong{font-size:14px}.workspace-shortcuts small{font-size:11px;color:var(--text-muted);margin-top:4px}.workspace-shortcuts :global(svg){font-size:24px;color:var(--accent);flex-shrink:0}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-top:14px;gap:16px}.section-heading .eyebrow{margin:0 0 4px;font-size:9px}.section-heading h2{margin:0;font-size:20px}.metric-grid:not(.analytics-metrics){grid-template-columns:repeat(4,minmax(0,1fr))}.metric button{display:flex;align-items:center;justify-content:space-between;gap:8px}.metric-grid:not(.analytics-metrics) .metric{padding:20px 16px}.metric-grid:not(.analytics-metrics) .metric p{font-size:11px}@media(max-width:1250px){.metric-grid:not(.analytics-metrics){grid-template-columns:repeat(2,minmax(0,1fr))}.workspace-shortcuts button{padding:16px;gap:10px}}@media(max-width:1000px){.welcome-note{display:none}.workspace-shortcuts{grid-template-columns:1fr}.workspace-shortcuts button{padding:14px 18px}.workspace-shortcuts small{display:inline;margin-left:10px}.workspace-welcome{padding:28px}}@media(max-width:650px){.workspace-welcome{min-height:0;padding:24px}.welcome-copy h1{font-size:27px}.workspace-shortcuts small{display:block;margin-left:0}.metric-grid:not(.analytics-metrics){grid-template-columns:minmax(0,1fr)}}
.host-topline{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:20px 0}.host-eyebrow{font-size:11px;letter-spacing:.14em;color:var(--accent);font-weight:650}.resource-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.process-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;padding:24px 4px}.process-strip>div{display:grid;gap:8px}.process-strip span{font-size:12px;color:var(--text-muted)}.process-strip strong{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}.process-strip small{font-size:12px;font-weight:400}.host-notes{border-top:1px solid var(--border);padding-top:16px}.host-notes summary{font-size:12px;color:var(--text-muted);font-weight:400}@media(max-width:1000px){.resource-grid{grid-template-columns:1fr}.process-strip{grid-template-columns:repeat(2,minmax(0,1fr))}}
/* Keep narrow cards and date controls inside the available content column. */
.dashboard > *, .welcome-copy, .workspace-shortcuts button > span, .range-controls label, .process-strip > div { min-width: 0; }
.dashboard h1, .dashboard h2, .dashboard h3, .dashboard strong, .dashboard summary, .metric b, .metric button, .process-strip strong { overflow-wrap: anywhere; }
.range-controls { max-width: 100%; box-sizing: border-box; }
.range-controls form { min-width: 0; box-sizing: border-box; }
.range-controls label { flex: 1 1 150px; }
.range-controls input { min-width: 0; max-width: 100%; }
.chart-axis { flex-wrap: wrap; }
.chart-axis span { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 900px) {
 .analytics-metrics, .breakdown-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 760px) {
 .dashboard button, .dashboard summary { min-height: 44px; }
 .dashboard summary { align-content: center; }
 .dashboard .heading, .section-heading { flex-wrap: wrap; gap: 12px; }
 .welcome-actions button { flex: 1 1 auto; justify-content: center; }
 .range-controls { justify-self: stretch; }
 .range-controls > button { flex: 1 1 90px; }
 .range-controls form { padding: 8px 4px; }
 .range-controls label { flex: auto; width: 100%; }
 .range-controls input { font-size: 16px; min-height: 44px; }
 .workspace-welcome { padding: 22px 18px; }
 .workspace-shortcuts button { padding: 14px; }
 .process-strip { gap: 16px 12px; padding: 20px 0; }
 .process-strip strong { font-size: 16px; }
 .chart-axis span:nth-child(2) { order: 1; flex-basis: 100%; text-align: center; }
 .chart-axis span:last-child { margin-left: auto; text-align: right; }
}
</style>
