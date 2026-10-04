import { lstat } from "node:fs/promises";
import { posix } from "node:path";
import {
	configurationReferences,
	isConfiguration,
	parseConfiguration,
} from "../shared/configuration.js";
import type { Draft } from "../shared/contracts.js";
import { frontmatter, images, inspect } from "../shared/editor.js";
import { contentIdentity } from "../shared/identity.js";
import { mediaSourceWithoutCode } from "../shared/media.js";
import { normalizeConfiguration } from "./configuration.js";
import { DraftError } from "./drafts.js";
import { safeFile } from "./executor.js";

export function validateSnapshot(draft: Draft) {
	if (isConfiguration(draft.kind)) {
		normalizeConfiguration(
			draft.kind,
			draft.source,
			draft.baseSource || undefined,
		);
		if (draft.contentId !== draft.kind)
			throw new DraftError(422, "PUBLISH_INVALID");
		return { values: {}, errors: [], editable: [] };
	}
	const metadata = inspect(draft.source, draft.kind);
	const identity = contentIdentity(draft.path, draft.source);
	if (
		metadata.errors.length ||
		!identity.reliable ||
		identity.id !== draft.contentId
	)
		throw new DraftError(422, "PUBLISH_INVALID", {
			errors: metadata.errors,
			identity: identity.id,
		});
	// Keeping draft:true is intentional; publishing a commit does not imply public visibility.
	return metadata;
}
export async function validateMedia(
	draft: Draft,
	input: string,
	allowedOrigins: string[],
	verifiedUrls: string[] = [],
) {
	if (isConfiguration(draft.kind)) {
		// URL schemes and field roles were checked at save/snapshot time. Historical
		// external URLs are retained; do not probe the entire existing playlist/gallery.
		for (const ref of configurationReferences(
			draft.kind,
			parseConfiguration(draft.kind, draft.source),
		)) {
			if (
				ref.value.includes("/__managed-media/") ||
				ref.value.startsWith("/api/")
			)
				throw new DraftError(422, "MEDIA_REFERENCE");
			if (ref.value.startsWith("/") && !verifiedUrls.includes(ref.value)) {
				try {
					await safeFile(
						input,
						`public/${ref.value.slice(1).split(/[?#]/u)[0]}`,
					);
				} catch {
					throw new DraftError(422, "MEDIA_INVALID");
				}
			}
		}
		return;
	}
	const refs = new Set(images(draft.source).items.map((image) => image.url));
	const cover = inspect(draft.source, draft.kind).values.image;
	if (typeof cover === "string" && cover) refs.add(cover);
	const body = mediaSourceWithoutCode(
		draft.source.slice(frontmatter(draft.source)?.bodyStart || 0),
	);
	// Covers inline HTML/MDX media and markdown images beyond editor's sortable subset.
	for (const match of body.matchAll(
		/(?:\b(?:src|poster)\s*=\s*["']([^"']+)["']|!\[[^\]]*\]\(<?([^\s)>]+))/gu,
	))
		refs.add(match[1] || match[2]);
	for (const ref of refs) {
		if (verifiedUrls.includes(ref)) continue;
		if (/^https?:/u.test(ref)) {
			const url = new URL(ref);
			if (
				url.protocol !== "https:" ||
				url.username ||
				url.password ||
				!allowedOrigins.includes(url.origin)
			)
				throw new DraftError(422, "MEDIA_INVALID");
			try {
				const result = await fetch(url, {
					method: "HEAD",
					redirect: "error",
					signal: AbortSignal.timeout(5000),
				});
				if (
					!result.ok ||
					!/^(?:image|audio|video)\//u.test(
						result.headers.get("content-type") || "",
					)
				)
					throw new Error("media");
			} catch {
				throw new DraftError(422, "MEDIA_INVALID");
			}
		} else {
			if (/^[a-zA-Z][a-zA-Z0-9+.-]*:|^\/\//u.test(ref))
				throw new DraftError(422, "MEDIA_INVALID");
			const name = ref.startsWith("/")
				? `public/${ref.slice(1)}`
				: posix.join(
						`src/content/${draft.kind}`,
						posix.dirname(draft.path),
						ref,
					);
			try {
				if (!(await lstat(await safeFile(input, name))).size)
					throw new Error("empty");
			} catch {
				throw new DraftError(422, "MEDIA_INVALID");
			}
		}
	}
}
