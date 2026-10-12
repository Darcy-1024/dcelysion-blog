import distribution from "../config/manifests/media-distribution.json";
import settings from "../config/manifests/settings.json";
import {
	type MediaDistribution,
	parseMediaPolicy,
	parsePublicMediaManifest,
	publicMediaManifestUrl,
} from "./media-contract";
import { type MediaAttempt, MediaRouter } from "./media-routing";

let singleton: MediaRouter | undefined;
let initialized: Promise<void> | undefined;
export function initializeMedia(): Promise<void> {
	if (!initialized)
		initialized = (async () => {
			const router = mediaRouter();
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 2500);
			try {
				const response = await fetch(publicMediaManifestUrl, {
					signal: controller.signal,
					credentials: "omit",
					redirect: "error",
					cache: "no-store",
				});
				if (
					!response.ok ||
					!response.body ||
					response.headers.get("content-type")?.split(";")[0] !==
						"application/json" ||
					Number(response.headers.get("content-length")) > 1048576
				)
					throw new Error("media manifest response");
				const reader = response.body.getReader();
				const chunks: Uint8Array[] = [];
				let size = 0;
				try {
					for (;;) {
						const part = await reader.read();
						if (part.done) break;
						size += part.value.byteLength;
						if (size > 1048576) throw new Error("media manifest limit");
						chunks.push(part.value);
					}
				} finally {
					await reader.cancel();
				}
				const bytes = new Uint8Array(size);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.length;
				}
				router.updateEntries(
					parsePublicMediaManifest(JSON.parse(new TextDecoder().decode(bytes)))
						.entries,
				);
			} catch {
				/* Build snapshot remains valid. Unknown media retains its URL. */
			} finally {
				clearTimeout(timer);
			}
			await router.start();
		})();
	return initialized;
}
export function mediaRouter(): MediaRouter {
	if (!singleton) {
		let storage: Storage | undefined;
		try {
			storage = sessionStorage;
		} catch {
			/* Memory only. */
		}
		singleton = new MediaRouter(
			distribution as MediaDistribution,
			parseMediaPolicy((settings as Record<string, unknown>).mediaRouting),
			storage,
			fetch.bind(globalThis),
			import.meta.env.PUBLIC_BUILD_REVISION || "",
		);
		queueMicrotask(() => void initializeMedia());
	}
	return singleton;
}
export const resolveMedia = (url: string): string =>
	mediaRouter().attempt(url).url;
const imageListeners = new WeakSet<HTMLImageElement>();
const deferred = new WeakSet<HTMLImageElement>();
const observers = new Set<IntersectionObserver>();
export function clearDeferredImages(): void {
	for (const observer of observers) observer.disconnect();
	observers.clear();
}
const attempts = new WeakMap<
	HTMLMediaElement | HTMLImageElement,
	MediaAttempt
>();
export function assignMedia(
	element: HTMLMediaElement | HTMLImageElement,
	url: string,
	srcset?: string,
): void {
	const attempt = mediaRouter().attempt(url);
	attempts.set(element, attempt);
	if (element instanceof HTMLImageElement) {
		if (!imageListeners.has(element)) {
			imageListeners.add(element);
			element.addEventListener(
				"error",
				(event) => {
					if (backupMedia(element)) event.stopImmediatePropagation();
				},
				{ capture: true },
			);
		}
		const pictureSources = [
			...(element
				.closest("picture")
				?.querySelectorAll<HTMLSourceElement>("source[data-media-srcset]") ||
				[]),
		];
		const candidates = [
			url,
			...(srcset ? srcset.split(",").map((v) => v.trim().split(/\s+/)[0]) : []),
			...pictureSources.flatMap((source) =>
				(source.dataset.mediaSrcset || "")
					.split(",")
					.map((v) => v.trim().split(/\s+/)[0]),
			),
		];
		if (
			pictureSources.length &&
			!candidates.every((candidate) => mediaRouter().entry(candidate))
		) {
			for (const source of pictureSources)
				source.srcset = source.dataset.mediaSrcset || "";
			if (srcset) element.srcset = srcset;
			attempts.set(element, mediaRouter().attempt(""));
			element.src = url;
			return;
		}
		for (const source of pictureSources)
			source.srcset = (source.dataset.mediaSrcset || "")
				.split(",")
				.map((candidate) => {
					const [url, ...descriptor] = candidate.trim().split(/\s+/);
					return [resolveMedia(url), ...descriptor].join(" ");
				})
				.join(", ");
		// Only switch a complete candidate set; transformed/unmapped candidates keep their defaults.
		if (srcset) {
			const candidates = srcset.split(",").map((v) => v.trim().split(/\s+/));
			const allReady = candidates.every(([candidate]) =>
				mediaRouter().entry(candidate),
			);
			element.srcset = allReady
				? candidates
						.map(([candidate, ...descriptor]) =>
							[resolveMedia(candidate), ...descriptor].join(" "),
						)
						.join(", ")
				: srcset;
			if (!allReady) {
				attempts.set(element, mediaRouter().attempt(""));
				element.src = url;
				return;
			}
		}
	}
	element.src = attempt.url;
}
export function backupMedia(
	element: HTMLMediaElement | HTMLImageElement,
): boolean {
	const url = attempts.get(element)?.backup();
	if (!url) return false;
	if (element instanceof HTMLImageElement) {
		element.removeAttribute("srcset");
		for (const source of element
			.closest("picture")
			?.querySelectorAll("source") || [])
			source.removeAttribute("srcset");
	}
	element.src = url;
	return true;
}
export function markMediaPlayed(element: HTMLMediaElement): void {
	const attempt = attempts.get(element);
	if (attempt) attempt.played = true;
}
export function managedMedia(
	element: HTMLMediaElement | HTMLImageElement,
): boolean {
	return Boolean(attempts.get(element)?.entry);
}
export async function fetchMedia(url: string): Promise<Response> {
	const attempt = mediaRouter().attempt(url);
	try {
		const response = await fetch(attempt.url);
		if (!response.ok) throw new Error("media response");
		return response;
	} catch (cause) {
		const backup = attempt.backup();
		if (!backup) throw cause;
		const response = await fetch(backup);
		if (!response.ok) throw new Error("media backup");
		return response;
	}
}
export function activateDeferredImages(root: ParentNode = document): void {
	// SSR/eager/src-bearing images are already started. Only attach their own error
	// budget; never rewrite their src or responsive candidates when selection ends.
	for (const element of root.querySelectorAll<HTMLImageElement>(
		"img[src]:not([data-media-src])",
	)) {
		const current = element.currentSrc || element.getAttribute("src") || "";
		if (imageListeners.has(element) || !mediaRouter().entry(current)) continue;
		attempts.set(element, mediaRouter().startedAttempt(current));
		imageListeners.add(element);
		element.addEventListener(
			"error",
			(event) => {
				if (backupMedia(element)) event.stopImmediatePropagation();
			},
			{ capture: true },
		);
	}
	for (const element of root.querySelectorAll<HTMLImageElement>(
		"img[data-media-src]",
	)) {
		if (element.dataset.mediaActive || deferred.has(element)) continue;
		deferred.add(element);
		const activate = async () => {
			if (element.loading === "lazy") await initializeMedia();
			if (!element.isConnected || element.dataset.mediaActive) return;
			element.dataset.mediaActive = "true";
			assignMedia(
				element,
				element.dataset.mediaSrc || "",
				element.dataset.mediaSrcset,
			);
		};
		if (element.loading !== "lazy") activate();
		else {
			const observer = new IntersectionObserver(
				(entries) => {
					if (entries.some((e) => e.isIntersecting)) {
						observer.disconnect();
						observers.delete(observer);
						activate();
					}
				},
				{ rootMargin: "300px" },
			);
			observers.add(observer);
			observer.observe(element);
		}
	}
}
