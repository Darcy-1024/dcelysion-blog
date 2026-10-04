import { createHash } from "node:crypto";
import { analyticsConfig } from "../../src/config/analyticsConfig.js";
import {
	type AnalyticsRange,
	type AnalyticsReport,
	dimensions,
	type Point,
	type Rank,
	type Section,
	type Stats,
} from "../shared/analytics.js";
import { contentInventory } from "./content.js";

const DAY = 86400000;
const OFFSET = 8 * 3600000;
export class AnalyticsInputError extends Error {}
export type AnalyticsConfig = {
	key: string;
	websiteId: string;
	region: "" | "us" | "eu";
	source?: "cloud" | "self-hosted";
	endpoint?: string;
};
export function analyticsSettings(
	env: NodeJS.ProcessEnv = process.env,
): AnalyticsConfig {
	const source = env.ADMIN_UMAMI_SOURCE || "cloud";
	if (!["cloud", "self-hosted"].includes(source))
		throw new Error("ADMIN_UMAMI_SOURCE 配置无效");
	const websiteId =
		env.ADMIN_UMAMI_WEBSITE_ID ||
		(source === "cloud"
			? analyticsConfig.umamiAnalytics?.cloudWebsiteId ||
				analyticsConfig.umamiAnalytics?.websiteId
			: "") ||
		"";
	const region = env.ADMIN_UMAMI_REGION || "";
	if (
		!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(websiteId) ||
		!["", "us", "eu"].includes(region)
	)
		throw new Error("ADMIN_UMAMI 配置无效");
	let endpoint: string | undefined;
	if (source === "self-hosted") {
		const url = new URL(env.ADMIN_UMAMI_ENDPOINT || "");
		const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
		const internalDocker =
			env.ADMIN_UMAMI_ALLOW_INTERNAL_HTTP === "1" &&
			url.hostname === "dc-umami";
		if (
			(url.protocol !== "https:" &&
				!(url.protocol === "http:" && (loopback || internalDocker))) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			url.pathname !== "/api" ||
			region
		)
			throw new Error(
				"ADMIN_UMAMI_ENDPOINT 必须为 HTTPS /api、回环 HTTP 或明确启用的 dc-umami 内网接口",
			);
		endpoint = url.href.replace(/\/$/u, "");
	} else if (env.ADMIN_UMAMI_ENDPOINT) {
		throw new Error("Cloud 数据源不接受 ADMIN_UMAMI_ENDPOINT");
	}
	return {
		key: env.ADMIN_UMAMI_API_KEY || "",
		websiteId,
		region: region as AnalyticsConfig["region"],
		source: source as AnalyticsConfig["source"],
		endpoint,
	};
}
function date(value: string | null) {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
		throw new AnalyticsInputError();
	const stamp = Date.parse(`${value}T00:00:00+08:00`);
	if (
		!Number.isFinite(stamp) ||
		new Date(stamp + OFFSET).toISOString().slice(0, 10) !== value
	)
		throw new AnalyticsInputError();
	return stamp;
}
export function analyticsRange(
	params: URLSearchParams,
	now = Date.now(),
): AnalyticsRange {
	for (const key of params.keys())
		if (
			!["range", "start", "end"].includes(key) ||
			params.getAll(key).length !== 1
		)
			throw new AnalyticsInputError();
	const preset = params.get("range") || "today";
	if (!["today", "7d", "30d", "custom"].includes(preset))
		throw new AnalyticsInputError();
	const midnight = Math.floor((now + OFFSET) / DAY) * DAY - OFFSET;
	// One shared minute snapshot makes current-period cache hits possible.
	let endAt = Math.floor(now / 60000) * 60000;
	let startAt =
		midnight - (preset === "7d" ? 6 : preset === "30d" ? 29 : 0) * DAY;
	if (preset === "custom") {
		startAt = date(params.get("start"));
		const endDay = date(params.get("end"));
		if (endDay < startAt || endDay > midnight || endDay - startAt >= 90 * DAY)
			throw new AnalyticsInputError();
		endAt = Math.min(endDay + DAY - 1, endAt);
	} else if (params.has("start") || params.has("end"))
		throw new AnalyticsInputError();
	if (startAt > endAt || startAt < Date.UTC(2000, 0, 1))
		throw new AnalyticsInputError();
	const duration = endAt - startAt + 1;
	const previousStart = preset === "today" ? startAt - DAY : startAt - duration;
	return {
		preset: preset as AnalyticsRange["preset"],
		startAt,
		endAt,
		previousStart,
		previousEnd: previousStart + duration - 1,
		unit: preset === "today" ? "hour" : "day",
		timezone: "Asia/Shanghai",
	};
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("RESPONSE");
	return value as Record<string, unknown>;
}
function count(value: unknown) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw new Error("RESPONSE");
	return value;
}
export function mapStats(value: unknown): Stats {
	const row = record(value);
	return {
		pageviews: count(row.pageviews),
		visitors: count(row.visitors),
		visits: count(row.visits),
	};
}
function points(
	value: unknown,
	range: AnalyticsRange,
	selfHosted = false,
): Point[] {
	if (!Array.isArray(value) || value.length > 2200) throw new Error("RESPONSE");
	const seen = new Set<string>();
	return value
		.map((entry) => {
			const row = record(entry);
			if (
				typeof row.x !== "string" ||
				!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/u.test(
					row.x,
				)
			)
				throw new Error("RESPONSE");
			// Umami 3.4.0 PostgreSQL formats the requested timezone with a literal Z.
			// Cloud retains its existing timestamp contract.
			const label = selfHosted ? row.x.replace(/Z$/u, "") : row.x;
			const local = !/(?:Z|[+-]\d{2}:?\d{2})$/u.test(label);
			const stamp = Date.parse(
				label.replace(" ", "T") + (local ? "+08:00" : ""),
			);
			const floor = range.unit === "hour" ? 3600000 : DAY;
			const first =
				Math.floor((range.startAt + OFFSET) / floor) * floor - OFFSET;
			const last = Math.floor((range.endAt + OFFSET) / floor) * floor - OFFSET;
			if (
				!Number.isFinite(stamp) ||
				stamp < first ||
				stamp > last ||
				(stamp + OFFSET) % floor !== 0
			)
				throw new Error("RESPONSE");
			const x = new Date(stamp + OFFSET)
				.toISOString()
				.slice(0, 19)
				.replace("T", " ");
			if (seen.has(x)) throw new Error("RESPONSE");
			seen.add(x);
			return { x, y: count(row.y) };
		})
		.sort((a, b) => a.x.localeCompare(b.x));
}
export function mapTrend(
	value: unknown,
	range: AnalyticsRange,
	selfHosted = false,
) {
	const row = record(value);
	// Preserve absent buckets: no documented Cloud completeness guarantee.
	return {
		pageviews: points(row.pageviews, range, selfHosted),
		visitors: points(row.sessions, range, selfHosted),
	};
}
export function mapRanks(value: unknown): Rank[] {
	if (!Array.isArray(value) || value.length > 100) throw new Error("RESPONSE");
	return value.slice(0, 10).map((value) => {
		const row = record(value);
		if (row.x !== null && (typeof row.x !== "string" || row.x.length > 2000))
			throw new Error("RESPONSE");
		return { x: row.x as string | null, y: count(row.y) };
	});
}
class UpstreamError extends Error {
	constructor(
		public code: string,
		public transient = false,
	) {
		super(code);
	}
}
type Cached = { expires: number; successAt: number; section: Section<unknown> };
export class AnalyticsService {
	private cache = new Map<string, Cached>();
	private pending = new Map<string, Promise<Section<unknown>>>();
	private successful = new Map<string, Cached>();
	private calls: number[] = [];
	private blockedUntil = 0;
	private fingerprint: string;
	constructor(
		private config: AnalyticsConfig,
		private root: string,
		private fetcher: typeof fetch = fetch,
		private clock: () => number = Date.now,
		private timeoutMs = 5000,
		private mock = false,
	) {
		this.fingerprint = createHash("sha256")
			.update(JSON.stringify(config))
			.digest("hex");
	}
	private async request(
		path: string,
		params: URLSearchParams,
	): Promise<unknown> {
		const now = this.clock();
		this.calls = this.calls.filter((time) => time > now - 15000);
		if (now < this.blockedUntil || this.calls.length >= 40) {
			if (this.calls.length >= 40)
				this.blockedUntil = Math.max(this.blockedUntil, this.calls[0] + 15000);
			throw new UpstreamError("RATE_LIMIT", true);
		}
		this.calls.push(now);
		let response: Response;
		const signal = AbortSignal.timeout(this.timeoutMs);
		try {
			response = await this.fetcher(
				`${this.config.source === "self-hosted" ? this.config.endpoint : `https://api.umami.is/v1${this.config.region ? `/${this.config.region}` : ""}`}/websites/${this.config.websiteId}/${path}?${params}`,
				{
					headers: {
						Authorization: `Bearer ${this.config.key}`,
						Accept: "application/json",
					},
					redirect: "error",
					signal,
				},
			);
		} catch {
			throw new UpstreamError("TIMEOUT", true);
		}
		if (response.status === 429) {
			const retry = response.headers.get("retry-after");
			const delay =
				retry && /^\d+(?:\.\d+)?$/u.test(retry)
					? Number(retry) * 1000
					: retry
						? Date.parse(retry) - now
						: 15000;
			this.blockedUntil = Math.max(
				this.blockedUntil,
				now + Math.max(15000, Number.isFinite(delay) ? delay : 15000),
			);
			throw new UpstreamError("RATE_LIMIT", true);
		}
		if (response.status === 401 || response.status === 403) {
			this.cache.clear();
			this.successful.clear();
			throw new UpstreamError("CREDENTIALS");
		}
		if (!response.ok)
			throw new UpstreamError("UPSTREAM", response.status >= 500);
		try {
			const reader = response.body?.getReader();
			if (!reader) throw new Error();
			const chunks: Uint8Array[] = [];
			let length = 0;
			while (true) {
				const part = await reader.read();
				if (part.done) break;
				length += part.value.length;
				if (length > 1024 * 1024) {
					await reader.cancel();
					throw new Error();
				}
				chunks.push(part.value);
			}
			return JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			throw new UpstreamError(
				signal.aborted ? "TIMEOUT" : "RESPONSE",
				signal.aborted,
			);
		}
	}
	private section<T>(
		path: string,
		params: URLSearchParams,
		mapper: (value: unknown) => T,
		scope: string,
	): Promise<Section<T>> {
		if (!this.config.key)
			return Promise.resolve({
				state: "not_configured",
				data: null,
				sampledAt: null,
				reason: "NOT_CONFIGURED",
			});
		const key = `${this.fingerprint}:${path}:${params}`;
		const fallbackKey = `${this.fingerprint}:${scope}:${path}:${params.get("type") || ""}`;
		const now = this.clock();
		const old = this.cache.get(key);
		if (old && old.expires > now)
			return Promise.resolve(old.section as Section<T>);
		const pending = this.pending.get(key);
		if (pending) return pending as Promise<Section<T>>;
		const work = (async (): Promise<Section<T>> => {
			try {
				const data = mapper(await this.request(path, params));
				const sampledAt = new Date(this.clock()).toISOString();
				const section: Section<T> = {
					state: "success",
					data,
					sampledAt,
					reason: null,
					interval: {
						startAt: Number(params.get("startAt")),
						endAt: Number(params.get("endAt")),
					},
				};
				this.cache.set(key, {
					expires: this.clock() + 60000,
					successAt: this.clock(),
					section,
				});
				this.successful.set(fallbackKey, {
					expires: 0,
					successAt: this.clock(),
					section,
				});
				if (this.successful.size > 80)
					this.successful.delete(this.successful.keys().next().value as string);
				if (this.cache.size > 200)
					this.cache.delete(this.cache.keys().next().value as string);
				return section;
			} catch (cause) {
				const reason = cause instanceof UpstreamError ? cause.code : "RESPONSE";
				const last = this.successful.get(fallbackKey);
				const fallback =
					cause instanceof UpstreamError &&
					cause.transient &&
					last &&
					now - last.successAt <= 600000;
				const section: Section<T> = fallback
					? { ...(last.section as Section<T>), state: "stale", reason }
					: { state: "error", data: null, sampledAt: null, reason };
				// Short negative cache also prevents repeated manual retries exhausting quota.
				this.cache.set(key, {
					expires: this.clock() + 15000,
					successAt: fallback ? last.successAt : 0,
					section,
				});
				if (this.cache.size > 200)
					this.cache.delete(this.cache.keys().next().value as string);
				return section;
			}
		})();
		this.pending.set(key, work as Promise<Section<unknown>>);
		void work.finally(() => this.pending.delete(key));
		return work;
	}
	async report(params: URLSearchParams): Promise<AnalyticsReport> {
		const range = analyticsRange(params, this.clock());
		const scope = `${range.preset}:${range.startAt}:${new Date(range.endAt + OFFSET).toISOString().slice(0, 10)}`;
		const query = (startAt = range.startAt, endAt = range.endAt) =>
			new URLSearchParams({
				startAt: String(startAt),
				endAt: String(endAt),
				timezone: range.timezone,
				unit: range.unit,
			});
		const [stats, previous, trend, ...rows] = await Promise.all([
			this.section("stats", query(), mapStats, scope),
			this.section(
				"stats",
				query(range.previousStart, range.previousEnd),
				mapStats,
				`${scope}:previous`,
			),
			this.section(
				"pageviews",
				query(),
				(value) => mapTrend(value, range, this.config.source === "self-hosted"),
				scope,
			),
			...dimensions.map((dimension) => {
				const params = query();
				params.set("type", dimension);
				params.set("limit", "10");
				return this.section("metrics", params, mapRanks, scope);
			}),
		]);
		const ranks = Object.fromEntries(
			dimensions.map((dimension, index) => [dimension, rows[index]]),
		) as AnalyticsReport["ranks"];
		// Exact paths only. Query/case/trailing slash differences remain distinct.
		if (ranks.path.data) {
			try {
				const inventory = (
					await Promise.all([
						contentInventory(this.root, "posts"),
						contentInventory(this.root, "dynamic"),
					])
				).flat();
				const titles = new Map(inventory.map((item) => [item.url, item.title]));
				ranks.path = {
					...ranks.path,
					data: ranks.path.data.map((row) => ({
						...row,
						title: row.x ? titles.get(row.x) : undefined,
					})),
				};
			} catch {
				/* Optional title enrichment does not replace the original path. */
			}
		}
		const sections = [stats, previous, trend, ...rows];
		const state = !this.config.key
			? "not_configured"
			: sections.every((part) => part.state === "success")
				? "success"
				: sections.every((part) => part.state === "error")
					? "error"
					: sections.some((part) => part.state === "stale")
						? "stale"
						: "partial";
		return {
			state,
			source: this.mock
				? "隔离模拟 Umami Cloud（非真实访问数据）"
				: this.config.source === "self-hosted"
					? "Umami 自建"
					: "Umami Cloud",
			websiteId: this.config.websiteId,
			range,
			refreshedAt: new Date(this.clock()).toISOString(),
			retryAt:
				this.blockedUntil > this.clock()
					? new Date(this.blockedUntil).toISOString()
					: null,
			stats,
			previous,
			trend,
			ranks,
		};
	}
}
