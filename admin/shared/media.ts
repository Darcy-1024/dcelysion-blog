export const mediaPurposes = [
	"article",
	"gallery",
	"wallpaper",
	"music",
] as const;
export type MediaPurpose = (typeof mediaPurposes)[number];
// Immutable operator-selected destination. Never accepted from the browser.
export type MediaDestination = {
	purpose?: MediaPurpose;
	version: 1;
	bucket: string;
	prefix: string;
	publicBase: string;
	tencentRoot: string;
	tencentBase?: string;
};
export type MediaVariant = {
	key: string;
	sha256: string;
	size: number;
	mime: string;
	ext: string;
};
export type Media = {
	purpose?: MediaPurpose;
	version?: number;
	destination?: MediaDestination;
	id: string;
	name: string;
	kind: "image" | "audio" | "video" | "text";
	original: MediaVariant;
	preview?: MediaVariant;
	width?: number;
	height?: number;
	local: "uploading" | "ready" | "failed";
	privateCopy: "queued" | "running" | "ready" | "failed";
	publicCopy: "absent" | "partial" | "ready";
	publicKeys?: string[];
	// Each key is recorded only after Tencent public HTTP verification.
	tencentKeys?: string[];
	deliveryReceipts?: Record<
		string,
		{ sha256: string; size: number; mime: string }
	>;
	stage: string;
	error: string | null;
	attempt: number;
	deleted: boolean;
	createdAt: string;
};
export type MediaDependency = {
	destination?: MediaDestination;
	version?: number;
	id: string;
	variant: "original" | "preview";
	object: MediaVariant;
	url: string;
};
export type MediaPlan = {
	source: string;
	dependencies: MediaDependency[];
	fingerprint: string;
};
export const mediaMarker = (id: string, variant = "original") =>
	`/__managed-media/${id}/${variant}`;

// Keep offsets intact and avoid rewriting examples in fenced/inline code.
export function mediaSourceWithoutCode(source: string) {
	return source
		.replace(/^(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^\1[^\r\n]*$/gm, (s) =>
			" ".repeat(s.length),
		)
		.replace(/`+[^`\r\n]*`+/g, (s) => " ".repeat(s.length));
}
export function mediaPositions(source: string) {
	const masked = mediaSourceWithoutCode(source);
	const result: { start: number; end: number; url: string }[] = [];
	const expression =
		/(?:\]\(<?([^\s)>]+)|\b(?:src|poster)\s*=\s*["']([^"']+)["']|^image:\s*["']?([^\s"'\r\n]+))/gm;
	for (const match of masked.matchAll(expression)) {
		const url = match[1] || match[2] || match[3];
		const start = match.index + match[0].lastIndexOf(url);
		result.push({ start, end: start + url.length, url });
	}
	return result;
}
