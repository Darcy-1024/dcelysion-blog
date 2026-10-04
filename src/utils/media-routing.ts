import type {
	MediaDistribution,
	MediaPolicy,
	MediaSource,
	PublicMedia,
} from "./media-contract";
import { dualReady } from "./media-contract";

type RouteState = {
	version: 1;
	phase: "pending" | "ready";
	preferred: MediaSource;
	tencentAllowed?: boolean;
};
const storageKey = "dcelysion.media.route.v1";
export class MediaRouter {
	private state: RouteState;
	private pending?: Promise<MediaSource>;

	storageAvailable = true;
	constructor(
		readonly manifest: MediaDistribution,
		readonly policy: MediaPolicy,
		private storage:
			| Pick<Storage, "getItem" | "setItem">
			| undefined = undefined,
		private request: typeof fetch = fetch.bind(globalThis),
	) {
		this.state = { version: 1, phase: "ready", preferred: "r2" };
		try {
			const cached = JSON.parse(storage?.getItem(storageKey) || "null");
			if (
				cached?.version === 1 &&
				["r2", "tencent"].includes(cached.preferred) &&
				["ready", "pending"].includes(cached.phase)
			) {
				// Interrupted probes are consumed rounds too; refresh never starts another round.
				this.state = { ...cached, phase: "ready" };
				this.persist();
				return;
			}
		} catch {
			this.storageAvailable = false;
		}
		this.state.phase = "pending";
	}
	get preferred(): MediaSource {
		return this.state.preferred;
	}
	get phase(): "pending" | "ready" {
		return this.state.phase;
	}
	private persist() {
		try {
			if (!this.storage) throw new Error("storage unavailable");
			this.storage.setItem(storageKey, JSON.stringify(this.state));
		} catch {
			this.storageAvailable = false;
		}
	}
	start(manual = false): Promise<MediaSource> {
		if (this.pending) return this.pending;
		if (!manual && this.state.phase === "ready")
			return Promise.resolve(this.preferred);
		this.state.phase = "pending";
		this.persist();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.policy.timeoutMs);
		this.pending = this.choose(controller.signal)
			.catch(() => this.safeDefault())
			.then((source) => {
				this.state = {
					version: 1,
					phase: "ready",
					preferred: source,
					tencentAllowed: this.state.tencentAllowed,
				};
				this.persist();
				return source;
			})
			.finally(() => {
				clearTimeout(timer);
				this.pending = undefined;
			});
		return this.pending;
	}
	private safeDefault(): MediaSource {
		// Without a fresh capacity permit, never allocate a new Tencent session.
		return this.state.tencentAllowed ? this.policy.defaultSource : "r2";
	}
	private async choose(signal: AbortSignal): Promise<MediaSource> {
		this.state.tencentAllowed = false;
		if (
			!this.policy.enabled ||
			!this.manifest.capacityUrl ||
			!this.manifest.entries.some(dualReady)
		)
			return this.safeDefault();
		if (this.policy.mode === "r2") return "r2";
		const capacity = await this.request(this.manifest.capacityUrl, {
			signal,
			cache: "no-store",
			credentials: "omit",
			redirect: "error",
		});
		if (!capacity.ok || Number(capacity.headers.get("content-length")) > 1024)
			return "r2";
		if (!capacity.body) return "r2";
		const reader = capacity.body.getReader();
		let bytes = new Uint8Array(0);
		try {
			for (;;) {
				const chunk = await reader.read();
				if (chunk.done) break;
				if (bytes.length + chunk.value.length > 1024)
					throw new Error("capacity budget");
				const combined = new Uint8Array(bytes.length + chunk.value.length);
				combined.set(bytes);
				combined.set(chunk.value, bytes.length);
				bytes = combined;
			}
		} finally {
			await reader.cancel();
		}
		const permit = JSON.parse(new TextDecoder().decode(bytes));
		if (
			permit.allowed !== true ||
			!Number.isFinite(permit.expiresAt) ||
			permit.expiresAt <= Date.now() ||
			permit.expiresAt > Date.now() + 30000
		)
			return "r2";
		this.state.tencentAllowed = true;
		if (this.policy.mode === "tencent") return "tencent";
		const entry = this.manifest.entries.find(
			(e) =>
				e.id === this.manifest.probe?.id &&
				e.variant === this.manifest.probe?.variant,
		);
		if (!entry || !dualReady(entry) || entry.size > this.policy.probeBytes)
			return "r2";
		const results = await Promise.allSettled(
			(["r2", "tencent"] as const).map(async (source) => {
				const before = performance.now();
				const response = await this.request(entry.sources[source] as string, {
					signal,
					cache: "no-store",
					credentials: "omit",
					redirect: "error",
				});
				if (
					response.status !== 200 ||
					Number(response.headers.get("content-length")) !== entry.size ||
					response.headers.get("content-type")?.split(";")[0] !== entry.mime ||
					!response.body
				)
					throw new Error("probe headers");
				const reader = response.body.getReader();
				const chunks: Uint8Array[] = [];
				let size = 0;
				try {
					for (;;) {
						const part = await reader.read();
						if (part.done) break;
						size += part.value.byteLength;
						if (size > entry.size) throw new Error("probe budget");
						chunks.push(part.value);
					}
				} finally {
					await reader.cancel();
				}
				if (size !== entry.size) throw new Error("probe incomplete");
				const bytes = new Uint8Array(size);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.length;
				}
				const checksum = Array.from(
					new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
					(b) => b.toString(16).padStart(2, "0"),
				).join("");
				if (checksum !== entry.sha256) throw new Error("probe version");
				return performance.now() - before;
			}),
		);
		if (results[0].status !== "fulfilled" || results[1].status !== "fulfilled")
			return this.safeDefault();
		return results[1].value <
			results[0].value * (1 - this.policy.minimumAdvantage)
			? "tencent"
			: "r2";
	}
	entry(url: string): PublicMedia | undefined {
		return this.manifest.entries.find(
			(e) => dualReady(e) && Object.values(e.sources).includes(url),
		);
	}
	attempt(url: string): MediaAttempt {
		const entry = this.policy.enabled ? this.entry(url) : undefined;
		const source = entry?.sources[this.preferred] ? this.preferred : "r2";
		return new MediaAttempt(
			entry?.sources[source] || url,
			entry,
			source,
			this.state.tencentAllowed === true,
		);
	}
	startedAttempt(url: string): MediaAttempt {
		const entry = this.policy.enabled ? this.entry(url) : undefined;
		return new MediaAttempt(
			url,
			entry,
			entry?.sources.tencent === url ? "tencent" : "r2",
			this.state.tencentAllowed === true,
		);
	}
}
export class MediaAttempt {
	private retried = false;
	played = false;
	constructor(
		public url: string,
		readonly entry: PublicMedia | undefined = undefined,
		private source: MediaSource | undefined = undefined,
		private tencentAllowed = true,
	) {}
	backup(): string | undefined {
		if (
			this.retried ||
			this.played ||
			!this.entry ||
			(this.source === "r2" && !this.tencentAllowed)
		)
			return undefined;
		this.retried = true;
		const next = this.entry.sources[this.source === "r2" ? "tencent" : "r2"];
		if (next === this.url) return undefined;
		if (next) this.url = next;
		return next;
	}
}
