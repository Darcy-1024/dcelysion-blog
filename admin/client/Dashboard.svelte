<script lang="ts">
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
let loading = false;
let error = "";
let version = 0;
let hostVersion = 0;
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
async function load() {
	const current = ++version;
	controller?.abort();
	controller = new AbortController();
	loading = true;
	error = "";
	report = null;
	const params = new URLSearchParams({ range: filters.range });
	if (filters.range === "custom") {
		params.set("start", filters.start);
		params.set("end", filters.end);
	}
	try {
		const [analytics, summary] = await Promise.allSettled([
			call<AnalyticsReport>(`/api/analytics?${params}`, controller.signal),
			mode === "overview"
				? call<Overview>("/api/overview", controller.signal)
				: Promise.resolve(null),
		]);
		if (!alive || current !== version) return;
		if (analytics.status === "fulfilled") report = analytics.value;
		else
			error =
				analytics.reason instanceof Error &&
				analytics.reason.message !== "Failed to fetch"
					? analytics.reason.message
					: connectionMessage();
		if (summary.status === "fulfilled") overview = summary.value;
		else {
			overview = null;
			error ||= connectionMessage();
		}
	} finally {
		if (alive && current === version) loading = false;
	}
}
async function sampleHost() {
	if (document.hidden || mode !== "overview" || loading) return;
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
	if (range !== "custom") void load();
	else {
		report = null;
		version++;
		controller?.abort();
		loading = false;
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
		controller?.abort();
		hostController?.abort();
		clearInterval(interval);
		document.removeEventListener("visibilitychange", visible);
	};
});
</script>

<section class="dashboard">
 <div class="heading"><div><p class="eyebrow">{mode==='overview'?'OVERVIEW':'UMAMI'}</p><h1>{words[mode]}</h1><p class="muted">{mode==='overview'?'当前库存与任务状态；访问数据按下方所选区间。':'区间独立访客由平台去重，趋势中的桶内 UV 不相加。'}</p></div><button disabled={loading} onclick={()=>void load()}>{words.refresh}</button></div>
 <div class="range-controls" aria-label="统计日期范围">
  {#each ['today','7d','30d','custom'] as range}<button aria-pressed={filters.range===range} class:primary={filters.range===range} onclick={()=>choose(range)}>{words[range as 'today'|'7d'|'30d'|'custom']}</button>{/each}
  {#if filters.range==='custom'}<form onsubmit={(event)=>{event.preventDefault();void load();}}><label>开始日期<input type="date" required bind:value={filters.start}/></label><label>结束日期<input type="date" required bind:value={filters.end}/></label><button type="submit" disabled={loading}>应用（最多90天）</button></form>{/if}
 </div>
 {#if error}<p class="error" role="alert">{error}</p>{/if}
 {#if loading}<p role="status">{words.loading}</p>{/if}
 {#if mode==='overview' && overview}
  <div class="metric-grid">
   {#each ['posts','dynamic'] as kind}<article class="panel metric"><h2>{kind==='posts'?'仓库文章':'仓库动态'}</h2><DataStatus section={overview.content}/>{#if overview.content.data}{@const counts=overview.content.data[kind as 'posts'|'dynamic']}<button onclick={()=>onnavigate({view:'content',kind:kind as 'posts'|'dynamic',status:'published'})}><b>{counts.public}</b> 非草稿</button><button onclick={()=>onnavigate({view:'content',kind:kind as 'posts'|'dynamic',status:'draft'})}>{counts.draft} 仓库草稿</button>{/if}<p class="muted">来源：当前仓库；非草稿不等于线上 release 数量。</p></article>{/each}
   <article class="panel metric"><h2>私有草稿与配置修订</h2><DataStatus section={overview.drafts}/>{#if overview.drafts.data}{#each ['posts','dynamic','music','gallery','settings'] as kind}<button onclick={()=>onnavigate({view:['posts','dynamic'].includes(kind)?'content':kind,kind:kind as 'posts'|'dynamic',private:true})}>{kind}：{overview.drafts.data[kind] ?? 0}</button>{/each}{/if}<p class="muted">后台数据库当前库存；与仓库草稿独立。</p></article>
   <article class="panel metric"><h2>评论与用户</h2><DataStatus section={overview.comments}/>{#if overview.comments.data}<button onclick={()=>onnavigate({view:'comments'})}><b>{overview.comments.data.total}</b> 评论</button><button onclick={()=>onnavigate({view:'comments',status:'waiting'})}>{overview.comments.data.waiting} 待审核</button><button onclick={()=>onnavigate({view:'users'})}>{overview.comments.data.users} 用户</button>{/if}<p class="muted">来源：{overview.commentSource}；分页接口 total，非本页条数。</p></article>
  </div>
  <section class="panel"><h2>近期发布与异常状态</h2><DataStatus section={overview.jobs}/>{#if overview.jobs.data}<p>持久化任务全量状态：{Object.entries(overview.jobs.data.counts).map(([state,total])=>`${state} ${total}`).join(' · ') || '暂无任务'}</p><p class="muted">最近6项任务，包含预览；推送与安装分别记录。</p>{#each overview.jobs.data.recent as job}<article class="task-row"><div><strong>{job.kind} · {job.status} · {job.stage}</strong><p>{time(job.createdAt)} · {job.error || '无异常记录'}</p><p>commit {job.effects.commit || '—'} · release {job.effects.release || '—'} · 推送 {job.effects.pushed?'成功':'未确认'} · 安装 {job.effects.installed?'成功':'未确认'}</p></div><button onclick={()=>onnavigate({view:'publishing',jobId:job.id})}>任务与日志</button></article>{/each}<button onclick={()=>onnavigate({view:'publishing'})}>查看发布队列</button>{/if}</section>
 {/if}
 {#if report}
  <section class="panel report-meta"><strong>{words.source}：{report.source} · {words.states[report.state]}</strong><p>站点 {report.websiteId}</p><p>{words.timezone} · {time(report.range.startAt)} — {time(report.range.endAt)}</p><p>对比：{report.range.preset==='today'?'昨日同期':'上一连续等长区间'} · {time(report.range.previousStart)} — {time(report.range.previousEnd)}</p><p class="muted">近7/30天含今日及前6/29天；今日截止当前分钟（部分日）。刷新 {time(report.refreshedAt)}{report.retryAt?` · 可重试于 ${time(report.retryAt)}`:''}</p></section>
  <div class="metric-grid analytics-metrics">{#each ['pageviews','visitors','visits'] as metric}<article class="panel metric"><h2>{words[metric as 'pageviews'|'visitors'|'visits']}</h2><DataStatus section={report.stats}/>{#if report.stats.data}<b class="number">{report.stats.data[metric as 'pageviews'|'visitors'|'visits']}</b><p>对比 {comparison(metric as 'pageviews'|'visitors'|'visits')}</p>{/if}</article>{/each}</div>
  <DataStatus section={report.previous}/>
  {#if mode==='overview'}<button onclick={()=>onnavigate({view:'analytics'})}>查看趋势、页面与来源分析</button>{:else}
   <section class="panel"><h2>PV 与桶内 UV 趋势</h2><DataStatus section={report.trend}/><p class="muted">仅绘制上游返回的时间桶；缺桶不填零，空响应表示没有记录。区间截至今日时，末桶未结束。</p>{#if report.trend.data}{#each ['pageviews','visitors'] as series}{@const points=report.trend.data[series as 'pageviews'|'visitors']}<h3>{series==='pageviews'?'PV 浏览量':'桶内 UV（不是访问次数）'}</h3>{#if points.length}<svg class="trend-chart" viewBox="0 0 600 150" role="img" aria-label={`${series} 趋势；明细见下表`}><line x1="10" y1="130" x2="590" y2="130" stroke="#ccd5e3"/>{#each points as point}<line x1={chartX(point)} x2={chartX(point)} y1="130" y2={130-110*point.y/maximum(points)} stroke={series==='pageviews'?'#376be5':'#187565'} stroke-width={report.range.unit==='hour'?10:5}><title>{point.x}：{point.y}</title></line>{/each}</svg><div class="chart-axis"><span>{axis("startAt")}</span><span>最高 {Math.max(0,...points.map(point=>point.y))}</span><span>{axis("endAt")}</span></div><details><summary>查看 {points.length} 个时间桶的数字</summary><div class="table-scroll"><table><thead><tr><th>北京时间</th><th>{series==='pageviews'?'PV':'桶内 UV'}</th></tr></thead><tbody>{#each points as point}<tr><td>{point.x}</td><td>{point.y}</td></tr>{/each}</tbody></table></div></details>{:else}<p>{words.empty}</p>{/if}{/each}{/if}</section>
   <div class="breakdown-grid">{#each dimensions as dimension}<section class="panel"><h2>{words[dimension]}</h2><DataStatus section={report.ranks[dimension]}/><p class="muted">所选区间 · 前10项（不是全部总数）</p>{#if report.ranks[dimension].data}{#if !report.ranks[dimension].data?.length}<p>{words.empty}</p>{:else}<table><thead><tr><th>维度值</th><th>数量</th></tr></thead><tbody>{#each report.ranks[dimension].data || [] as row}<tr><td>{#if row.title}<strong>{row.title}</strong><br/>{/if}{row.x || words.unknown}</td><td>{row.y}</td></tr>{/each}</tbody></table>{/if}{/if}</section>{/each}</div>
  {/if}
 {/if}
 {#if mode==='overview' && overview}<section class="panel"><h2>后台所在主机</h2><DataStatus section={overview.host}/><p class="muted">当前 Node 主机，不代表腾讯生产服务器；页面可见时每30秒采样，服务端10秒缓存。</p>{#if overview.host.data}{@const host=overview.host.data}<div class="host-grid"><p>平台 <b>{host.platform}</b> · {host.cores} CPU</p><p>系统 CPU <b>{host.cpuPercent===null?'等待第二次有效采样':`${host.cpuPercent.toFixed(1)}%`}</b></p><p>CPU 为两次采样间全核非空闲占比，间隔 {host.cpuIntervalMs===null?'—':`${(host.cpuIntervalMs/1000).toFixed(1)}秒`}</p><p>系统内存 总量 {bytes(host.systemMemory.total)} · 空闲 {bytes(host.systemMemory.free)}</p><p>后台进程 RSS {bytes(host.processMemory.rss)} · 堆使用 {bytes(host.processMemory.heapUsed)}</p><p>后台进程运行 {(host.processUptime/3600).toFixed(2)} 小时</p></div><h3>配置内容目录所在文件系统</h3><DataStatus section={host.disk}/>{#if host.disk.data}<p>总容量 {bytes(host.disk.data.total)} · 可用 {bytes(host.disk.data.available)}</p>{/if}<p class="muted">未采集网络吞吐、Nginx错误率或响应时间。</p>{/if}</section>{/if}
</section>

<style>
.dashboard{display:grid;gap:18px;min-width:0}.dashboard .heading{margin-bottom:0}.range-controls{display:flex;flex-wrap:wrap;gap:8px}.range-controls form{display:flex;flex-wrap:wrap;gap:10px;align-items:end;width:100%}.range-controls label{display:grid;gap:6px}.metric-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.analytics-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.dashboard .panel{padding:20px;min-width:0}.dashboard h2{font-size:16px;margin:0 0 12px}.dashboard h3{font-size:14px;margin:16px 0 8px}.metric{display:flex;flex-direction:column;align-items:start;gap:8px}.metric button{max-width:100%;text-align:left}.metric b,.number{font-size:28px}.dashboard p{font-size:13px;line-height:1.6;margin:6px 0;overflow-wrap:anywhere}.report-meta{border-left:4px solid #376be5}.breakdown-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.dashboard table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}.dashboard th,.dashboard td{padding:9px 5px;text-align:left;border-bottom:1px solid #edf0f4;overflow-wrap:anywhere}.dashboard td:last-child,.dashboard th:last-child{width:78px;text-align:right;font-variant-numeric:tabular-nums}.trend-chart{display:block;width:100%;height:auto;min-height:115px}.chart-axis{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#556479}.task-row{display:flex;align-items:center;gap:12px;border-bottom:1px solid #edf0f4;padding:12px 0}.task-row>div{min-width:0;flex:1}.table-scroll{max-height:260px;overflow:auto}.host-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dashboard :global(.data-status){font-size:12px;color:#66758c;line-height:1.5;overflow-wrap:anywhere}.dashboard :global(.data-status span){display:block;color:#9b442c}.dashboard :global(.data-status strong){font-size:12px}details summary{cursor:pointer;margin:10px 0}@media(max-width:650px){.metric-grid,.analytics-metrics,.breakdown-grid,.host-grid{grid-template-columns:minmax(0,1fr)}.task-row{align-items:start;flex-direction:column}.dashboard .panel{padding:16px}.range-controls form{flex-direction:column;align-items:stretch}.range-controls input{width:100%;box-sizing:border-box}}
</style>
