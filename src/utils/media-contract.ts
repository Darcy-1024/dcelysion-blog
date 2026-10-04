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
export function dualReady(entry: PublicMedia): boolean {
	return (
		/^[a-f0-9]{64}$/.test(entry.sha256) &&
		entry.size > 0 &&
		Boolean(entry.sources.r2 && entry.sources.tencent) &&
		Object.values(entry.sources).includes(entry.defaultUrl)
	);
}
