import distribution from "../config/manifests/media-distribution.json";
import settings from "../config/manifests/settings.json";
import { type MediaDistribution, parseMediaPolicy } from "./media-contract";
import { type MediaAttempt, MediaRouter } from "./media-routing";

let singleton: MediaRouter | undefined;
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
		);
		void singleton.start();
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
		for (const source of element
			.closest("picture")
			?.querySelectorAll<HTMLSourceElement>("source[data-media-srcset]") || [])
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
export function managedMedia(element: HTMLMediaElement): boolean {
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
		const activate = () => {
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
