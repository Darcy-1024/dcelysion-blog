export type MediaSource = "r2" | "tencent";
export type MediaPolicy = {
	enabled: boolean;
	mode: "auto" | MediaSource;
	defaultSource: MediaSource;
	timeoutMs: number;
	probeBytes: number;
	minimumAdvantage: number;
};
export const defaultMediaPolicy: MediaPolicy = {
	enabled: false,
	mode: "auto",
	defaultSource: "r2",
	timeoutMs: 2500,
	probeBytes: 32768,
	minimumAdvantage: 0.2,
};
export function parseMediaPolicy(value: unknown): MediaPolicy {
	if (value === undefined) return { ...defaultMediaPolicy };
	const p = value as MediaPolicy;
	if (
		!p ||
		Object.keys(p).some((k) => !Object.keys(defaultMediaPolicy).includes(k)) ||
		typeof p.enabled !== "boolean" ||
		!["auto", "r2", "tencent"].includes(p.mode) ||
		!["r2", "tencent"].includes(p.defaultSource) ||
		!Number.isInteger(p.timeoutMs) ||
		p.timeoutMs < 500 ||
		p.timeoutMs > 5000 ||
		!Number.isInteger(p.probeBytes) ||
		p.probeBytes < 4096 ||
		p.probeBytes > 65536 ||
		!Number.isFinite(p.minimumAdvantage) ||
		p.minimumAdvantage < 0.1 ||
		p.minimumAdvantage > 0.5
	)
		throw new Error("媒体选路策略无效");
	return { ...p };
}
export type PublicMedia = {
	// Public build paths are version-bound; raw uploads never create aliases.
	aliases?: { url: string; revision: string }[];
	// Present only in the private edge index: a safe path relative to its public root.
	localKey?: string;
	id: string;
	variant: "original" | "preview";
	key: string;
	sha256: string;
	size: number;
	mime: string;
	defaultUrl: string;
	sources: Partial<Record<MediaSource, string>>;
};
export type MediaDistribution = {
	version: 1;
	snapshot: string;
	entries: PublicMedia[];
	// These addresses are deployment-owned, never accepted from the settings editor.
	capacityUrl?: string;
	probe?: { id: string; variant: "original" | "preview" };
};

export const publicMediaManifestUrl =
	"https://admin-media.dcelysion.cn/media-routing/distribution-v1.json";
const publicHosts = new Set([
	"admin-media.dcelysion.cn",
	"gallery.dcelysion.cn",
	"wallpapers.dcelysion.cn",
	"music.dcelysion.cn",
]);
export function parsePublicMediaManifest(value: unknown): MediaDistribution {
	const m = value as MediaDistribution;
	if (
		m?.version !== 1 ||
		typeof m.snapshot !== "string" ||
		m.snapshot.length > 256 ||
		!Array.isArray(m.entries) ||
		m.entries.length > 5000
	)
		throw new Error("Invalid public media manifest");
	const seen = new Map<string, string>();
	for (const e of m.entries) {
		if (
			!e ||
			Object.keys(e).some(
				(k) =>
					![
						"id",
						"variant",
						"key",
						"sha256",
						"size",
						"mime",
						"defaultUrl",
						"sources",
						"aliases",
					].includes(k),
			) ||
			!dualReady(e) ||
			!Number.isSafeInteger(e.size) ||
			e.size <= 0 ||
			typeof e.id !== "string" ||
			e.id.length > 128 ||
			typeof e.key !== "string" ||
			e.key.length > 1024 ||
			!["original", "preview"].includes(e.variant) ||
			typeof e.mime !== "string" ||
			e.mime.length > 128 ||
			(!e.mime.startsWith("image/") &&
				!e.mime.startsWith("audio/") &&
				!e.mime.startsWith("video/") &&
				e.mime !== "text/plain")
		)
			throw new Error("Invalid public media entry");
		for (const [source, url] of Object.entries(e.sources)) {
			const u = new URL(url);
			if (
				u.protocol !== "https:" ||
				u.username ||
				u.password ||
				u.search ||
				u.hash ||
				(source === "r2"
					? !publicHosts.has(u.hostname)
					: source !== "tencent" ||
						u.hostname !== "media-tx.dcelysion.cn" ||
						!u.pathname.startsWith("/media/objects/"))
			)
				throw new Error("Unapproved public media URL");
			if (seen.has(url) && seen.get(url) !== e.sha256)
				throw new Error("Ambiguous media URL");
			seen.set(url, e.sha256);
		}
		if (e.aliases) {
			if (!Array.isArray(e.aliases) || e.aliases.length > 100)
				throw new Error("Invalid aliases");
			for (const alias of e.aliases) {
				if (
					!alias ||
					!/^\/[A-Za-z0-9_./%-]+$/.test(alias.url) ||
					alias.url.startsWith("//") ||
					alias.url.includes("..") ||
					alias.url.length > 2048 ||
					!/^[a-f0-9]{40}$/.test(alias.revision)
				)
					throw new Error("Invalid build alias");
				const key = `${alias.revision}:${alias.url}`;
				if (seen.has(key) && seen.get(key) !== e.sha256)
					throw new Error("Ambiguous build alias");
				seen.set(key, e.sha256);
			}
		}
	}
	// Remote data grants object eligibility only, never routing policy or endpoints.
	return { version: 1, snapshot: m.snapshot, entries: m.entries };
}
export function dualReady(entry: PublicMedia): boolean {
	return (
		/^[a-f0-9]{64}$/.test(entry.sha256) &&
		entry.size > 0 &&
		Boolean(entry.sources.r2 && entry.sources.tencent) &&
		Object.values(entry.sources).includes(entry.defaultUrl)
	);
}
