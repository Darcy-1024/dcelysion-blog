export type DataState =
	| "not_configured"
	| "success"
	| "partial"
	| "stale"
	| "error";
export type Section<T> = {
	state: DataState;
	data: T | null;
	sampledAt: string | null;
	reason: string | null;
	interval?: { startAt: number; endAt: number };
};
export type AnalyticsRange = {
	preset: "today" | "7d" | "30d" | "custom";
	startAt: number;
	endAt: number;
	previousStart: number;
	previousEnd: number;
	unit: "hour" | "day";
	timezone: "Asia/Shanghai";
};
export type Stats = { pageviews: number; visitors: number; visits: number };
export type Point = { x: string; y: number };
export type Rank = { x: string | null; y: number; title?: string };
export const dimensions = [
	"path",
	"referrer",
	"device",
	"browser",
	"country",
	"region",
] as const;
export type Dimension = (typeof dimensions)[number];
export type AnalyticsReport = {
	state: DataState;
	source: string;
	websiteId: string;
	range: AnalyticsRange;
	refreshedAt: string;
	retryAt: string | null;
	stats: Section<Stats>;
	previous: Section<Stats>;
	trend: Section<{ pageviews: Point[]; visitors: Point[] }>;
	ranks: Record<Dimension, Section<Rank[]>>;
};
export type HostMetrics = {
	platform: string;
	cores: number;
	cpuPercent: number | null;
	cpuIntervalMs: number | null;
	systemMemory: { total: number; free: number };
	processMemory: { rss: number; heapUsed: number };
	processUptime: number;
	disk: Section<{ total: number; available: number }>;
};
export type TaskSummary = {
	id: string;
	kind: string;
	status: string;
	stage: string;
	createdAt: string;
	error: string | null;
	effects: {
		commit?: string;
		release?: string;
		pushed?: boolean;
		installed?: boolean;
	};
};
export type Overview = {
	refreshedAt: string;
	content: Section<{
		posts: { public: number; draft: number };
		dynamic: { public: number; draft: number };
	}>;
	drafts: Section<Record<string, number>>;
	comments: Section<{ total: number; waiting: number; users: number }>;
	commentSource: string;
	jobs: Section<{ counts: Record<string, number>; recent: TaskSummary[] }>;
	host: Section<HostMetrics>;
};

export function change(current: number, previous: number): string {
	if (previous === 0) return current === 0 ? "no_comparison" : "new";
	return `${(((current - previous) / previous) * 100).toFixed(1)}%`;
}
