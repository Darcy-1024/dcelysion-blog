import type {
	CarouselInstance,
	CarouselOptions,
	CarouselPlugin,
	CarouselSlide,
} from "@fancyapps/ui";
import { assignMedia, backupMedia } from "./media-client";

// Fancybox 6.1: replace Lazyload, since its load event fires after capturing the URL.
export type LightboxImageResolver = (
	src: string,
	image: HTMLImageElement,
	slide: CarouselSlide,
) => Promise<string | null> | undefined;

export function mediaLazyload(
	resolveImage?: LightboxImageResolver,
): ReturnType<CarouselPlugin> {
	let carousel: CarouselInstance | undefined;
	const attach = (
		_instance: CarouselInstance,
		slide: Parameters<CarouselInstance["showLoading"]>[0],
	) => {
		if (!carousel) return;
		for (const element of slide.el?.querySelectorAll<HTMLImageElement>(
			"img[data-lazy-src]",
		) || []) {
			const src = element.dataset.lazySrc || "";
			const srcset = element.dataset.lazySrcset;
			if (element.dataset.lazySizes) element.sizes = element.dataset.lazySizes;
			delete element.dataset.lazySrc;
			delete element.dataset.lazySrcset;
			carousel.showLoading(slide);
			element.addEventListener("load", () => carousel?.hideLoading(slide), {
				once: true,
			});
			element.addEventListener("error", () => {
				if (!backupMedia(element)) carousel?.hideLoading(slide);
			});
			const resolved = resolveImage?.(src, element, slide);
			if (!resolved) assignMedia(element, src, srcset);
			else {
				// Zoomable initializes after this handler, cloning the now src-less
				// image. Both images must receive the result: Panzoom waits for the
				// clone's load and decodes the original before becoming ready.
				const current = carousel;
				const apply = (url: string | null) => {
					if (carousel !== current || !slide.el?.contains(element)) return;
					assignMedia(element, url || src, url ? undefined : srcset);
					for (const clone of slide.el.querySelectorAll<HTMLImageElement>(
						"img.f-panzoom__content.is-clone",
					)) {
						assignMedia(clone, url || src, url ? undefined : srcset);
					}
				};
				void resolved.then(apply, () => apply(null));
			}
		}
	};
	return {
		init(instance: CarouselInstance): void {
			carousel = instance;
			// Registered before Zoomable's initPlugins handler: Panzoom must see the
			// selected URL before its own lazy loader starts the image request.
			instance.on("attachSlideEl", attach);
		},
		destroy(): void {
			carousel?.off("attachSlideEl", attach);
			carousel = undefined;
		},
	};
}
export const mediaCarousel = (
	resolveImage?: LightboxImageResolver,
): Partial<CarouselOptions> => ({
	Lazyload: false as const,
	plugins: { MediaLazyload: () => mediaLazyload(resolveImage) },
});
