import { statfs } from "node:fs/promises";
import { cpus, freemem, platform, totalmem } from "node:os";
import type { HostMetrics, Overview, Section } from "../shared/analytics.js";
import type { Owner } from "./auth.js";
import { contentInventory } from "./content.js";
import type { DraftService } from "./drafts.js";
import type { ManagementService } from "./management.js";

async function section<T>(
	action: () => Promise<T>,
	reason: string,
): Promise<Section<T>> {
	try {
		return {
			state: "success",
			data: await action(),
			sampledAt: new Date().toISOString(),
			reason: null,
		};
	} catch {
		return { state: "error", data: null, sampledAt: null, reason };
	}
}
function cpuTimes() {
	const rows = cpus();
	return {
		cores: rows.length,
		idle: rows.reduce((sum, cpu) => sum + cpu.times.idle, 0),
		total: rows.reduce(
			(sum, cpu) => sum + Object.values(cpu.times).reduce((a, b) => a + b, 0),
			0,
		),
	};
}
export class OverviewService {
	private previous = { ...cpuTimes(), at: Date.now() };
	private hostCache: Section<HostMetrics> | null = null;
	private hostPending: Promise<Section<HostMetrics>> | null = null;
	private inventoryCache: { until: number; data: Overview["content"] } | null =
		null;
	private inventoryPending: Promise<Overview["content"]> | null = null;
	constructor(
		private root: string,
		private drafts: DraftService | null,
		private management: ManagementService | null,
	) {}
	async host(): Promise<Section<HostMetrics>> {
		if (
			this.hostCache?.sampledAt &&
			Date.now() - Date.parse(this.hostCache.sampledAt) < 10000
		)
			return this.hostCache;
		if (this.hostPending) return this.hostPending;
		this.hostPending = section(async () => {
			const now = Date.now();
			const current = { ...cpuTimes(), at: now };
			const elapsed = now - this.previous.at;
			const delta = current.total - this.previous.total;
			const cpuPercent =
				elapsed >= 1000 && delta > 0 && current.cores === this.previous.cores
					? Math.max(
							0,
							Math.min(
								100,
								100 * (1 - (current.idle - this.previous.idle) / delta),
							),
						)
					: null;
			this.previous = current;
			const memory = process.memoryUsage();
			const disk = await section(async () => {
				const fs = await statfs(this.root, { bigint: true });
				const total = Number(fs.blocks * fs.bsize);
				const available = Number(fs.bavail * fs.bsize);
				if (
					!Number.isSafeInteger(total) ||
					total <= 0 ||
					!Number.isSafeInteger(available) ||
					available < 0 ||
					available > total
				)
					throw new Error();
				return { total, available };
			}, "DISK_UNAVAILABLE");
			return {
				platform: platform(),
				cores: current.cores,
				cpuPercent,
				cpuIntervalMs: cpuPercent === null ? null : elapsed,
				systemMemory: { total: totalmem(), free: freemem() },
				processMemory: { rss: memory.rss, heapUsed: memory.heapUsed },
				processUptime: process.uptime(),
				disk,
			};
		}, "HOST_UNAVAILABLE");
		try {
			this.hostCache = await this.hostPending;
			return this.hostCache;
		} finally {
			this.hostPending = null;
		}
	}
	private async content(): Promise<Overview["content"]> {
		if (this.inventoryCache && this.inventoryCache.until > Date.now())
			return this.inventoryCache.data;
		if (this.inventoryPending) return this.inventoryPending;
		this.inventoryPending = section(async () => {
			const [posts, dynamic] = await Promise.all([
				contentInventory(this.root, "posts"),
				contentInventory(this.root, "dynamic"),
			]);
			const counts = (rows: typeof posts) => ({
				public: rows.filter((row) => !row.draft).length,
				draft: rows.filter((row) => row.draft).length,
			});
			return { posts: counts(posts), dynamic: counts(dynamic) };
		}, "CONTENT_UNAVAILABLE");
		try {
			const data = await this.inventoryPending;
			this.inventoryCache = { until: Date.now() + 60000, data };
			return data;
		} finally {
			this.inventoryPending = null;
		}
	}
	async report(owner: Owner, token: string): Promise<Overview> {
		const [content, drafts, jobs, comments, host] = await Promise.all([
			this.content(),
			section(async () => {
				if (!this.drafts) throw new Error();
				return this.drafts.summary(owner.id);
			}, "DRAFTS_UNAVAILABLE"),
			section(async () => {
				if (!this.drafts) throw new Error();
				return this.drafts.taskSummary(owner.id);
			}, "JOBS_UNAVAILABLE"),
			section(async () => {
				if (!this.management) throw new Error();
				return this.management.summary(token, owner);
			}, "COMMENTS_UNAVAILABLE"),
			this.host(),
		]);
		return {
			content,
			drafts,
			jobs,
			comments,
			host,
			refreshedAt: new Date().toISOString(),
			commentSource: this.management?.info().source || "Waline（不可用）",
		};
	}
}
