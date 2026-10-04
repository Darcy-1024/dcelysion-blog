import type {
	CarouselInstance,
	CarouselOptions,
	CarouselPlugin,
} from "@fancyapps/ui";
import { assignMedia, backupMedia } from "./media-client";

// Fancybox 6.1: replace Lazyload, since its load event fires after capturing the URL.
export function mediaLazyload(): ReturnType<CarouselPlugin> {
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
			assignMedia(element, src, srcset);
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
export const mediaCarousel = (): Partial<CarouselOptions> => ({
	Lazyload: false as const,
	plugins: { MediaLazyload: mediaLazyload },
});
