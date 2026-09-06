import { computeTocItems, type TocInput } from "@/utils/toc-shared";
import { getVisibleHeadingIds } from "@/utils/toc-utils";

const TRACK_MARGIN = 4;
const MIN_THUMB_HEIGHT = 40;
const SCROLL_OFFSET = 80;
const AUTO_HIDE_DELAY = 3000;

interface RailItem {
	headingId: string;
	label: string;
	depthLevel: number;
}

interface RailGeometry {
	maxScroll: number;
	thumbHeight: number;
	thumbTop: number;
	thumbTravel: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getScrollHeight(): number {
	return Math.max(
		document.documentElement.scrollHeight,
		document.body.scrollHeight,
	);
}

function getHeadingText(heading: HTMLElement): string {
	const clone = heading.cloneNode(true) as HTMLElement;
	clone.querySelectorAll("script, style, .anchor-icon").forEach((element) => {
		element.remove();
	});
	return clone.textContent?.replace(/#+\s*$/, "").trim() || heading.id;
}

export class ImmersiveScrollRailManager {
	private root: HTMLElement | null = null;
	private track: HTMLElement | null = null;
	private thumb: HTMLElement | null = null;
	private markerContainer: HTMLElement | null = null;
	private markerButtons: HTMLButtonElement[] = [];
	private headings = new Map<string, HTMLElement>();
	private contentHeadings: HTMLElement[] = [];
	private activeHeadingIds = new Set<string>();
	private resizeObserver: ResizeObserver | null = null;
	private animationFrame: number | null = null;
	private hideTimeout: number | null = null;
	private active = false;
	private pointerInside = false;
	private dragging = false;
	private dragPointerId: number | null = null;
	private dragOffset = 0;
	private geometry: RailGeometry = {
		maxScroll: 0,
		thumbHeight: MIN_THUMB_HEIGHT,
		thumbTop: TRACK_MARGIN,
		thumbTravel: 0,
	};

	private bindElements(): boolean {
		this.root = document.getElementById("immersive-scroll-rail");
		this.track = document.getElementById("immersive-scroll-track");
		this.thumb = document.getElementById("immersive-scroll-thumb");
		this.markerContainer = document.getElementById("immersive-scroll-markers");
		return Boolean(
			this.root && this.track && this.thumb && this.markerContainer,
		);
	}

	private getContentHeadings(): HTMLElement[] {
		const content =
			document.querySelector<HTMLElement>(".custom-md") ??
			document.querySelector<HTMLElement>(".prose") ??
			document.querySelector<HTMLElement>(".markdown-content");
		if (!content) return [];

		return Array.from(
			content.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
		);
	}

	private getFallbackItems(): RailItem[] {
		const headings = this.getContentHeadings();
		const inputs: TocInput[] = headings.map((heading) => ({
			depth: Number.parseInt(heading.tagName.charAt(1), 10),
			slug: heading.id,
			text: getHeadingText(heading),
		}));

		return computeTocItems(inputs, { maxLevel: 3 }).map((item) => ({
			headingId: item.headingId,
			label: item.text,
			depthLevel: item.depthLevel,
		}));
	}

	private getRailItems(): RailItem[] {
		const tocItems = Array.from(
			document.querySelectorAll<HTMLElement>(
				"#immersive-toc-content a[data-heading-id]",
			),
		);
		if (tocItems.length === 0) return this.getFallbackItems();

		return tocItems.flatMap((item) => {
			const headingId = item.dataset.headingId;
			if (!headingId) return [];
			const label =
				item.querySelector<HTMLElement>(".toc-label")?.textContent?.trim() ||
				item.getAttribute("aria-label") ||
				headingId;
			const depthClass = Array.from(item.classList).find((className) =>
				className.startsWith("toc-level-"),
			);
			const depthLevel = Number.parseInt(
				depthClass?.replace("toc-level-", "") ?? "0",
				10,
			);
			return [{ headingId, label, depthLevel }];
		});
	}

	private createMarker(item: RailItem): HTMLButtonElement | null {
		const heading = document.getElementById(item.headingId);
		if (!(heading instanceof HTMLElement)) return null;

		this.headings.set(item.headingId, heading);
		const marker = document.createElement("button");
		marker.type = "button";
		marker.className = "immersive-scroll-marker";
		marker.dataset.headingId = item.headingId;
		marker.dataset.depthLevel = String(item.depthLevel);
		marker.setAttribute("aria-label", item.label);

		const tooltip = document.createElement("span");
		tooltip.className = "immersive-scroll-marker-label";
		tooltip.setAttribute("aria-hidden", "true");
		tooltip.textContent = item.label;
		marker.append(tooltip);
		return marker;
	}

	private applyActiveState(): void {
		this.markerButtons.forEach((marker) => {
			const isActive = this.activeHeadingIds.has(
				marker.dataset.headingId ?? "",
			);
			marker.classList.toggle("is-active", isActive);
			if (isActive) marker.setAttribute("aria-current", "location");
			else marker.removeAttribute("aria-current");
		});
	}

	private updateGeometry(): void {
		this.animationFrame = null;
		if (!this.active || !this.root || !this.track || !this.thumb) return;

		const viewportHeight = window.innerHeight;
		const scrollHeight = getScrollHeight();
		const trackHeight = Math.max(0, viewportHeight - TRACK_MARGIN * 2);
		const maxScroll = Math.max(0, scrollHeight - viewportHeight);
		const thumbHeight = Math.min(
			trackHeight,
			Math.max(
				MIN_THUMB_HEIGHT,
				(scrollHeight > 0 ? viewportHeight / scrollHeight : 1) * trackHeight,
			),
		);
		const thumbTravel = Math.max(0, trackHeight - thumbHeight);
		const progress =
			maxScroll > 0 ? clamp(window.scrollY / maxScroll, 0, 1) : 0;
		const thumbTop = TRACK_MARGIN + progress * thumbTravel;

		this.geometry = { maxScroll, thumbHeight, thumbTop, thumbTravel };
		this.root.classList.toggle("is-scrollable", maxScroll > 0);
		this.thumb.style.setProperty("--immersive-thumb-top", `${thumbTop}px`);
		this.thumb.style.setProperty(
			"--immersive-thumb-height",
			`${thumbHeight}px`,
		);

		const percent = Math.round(progress * 100);
		this.track.setAttribute("aria-valuenow", String(percent));
		this.track.setAttribute("aria-valuetext", `${percent}%`);
		this.setActiveHeadingIds(getVisibleHeadingIds(this.contentHeadings));

		this.markerButtons.forEach((marker) => {
			const headingId = marker.dataset.headingId;
			const heading = headingId ? this.headings.get(headingId) : null;
			if (!heading) return;

			const headingTop = heading.getBoundingClientRect().top + window.scrollY;
			const rawMarkerY =
				maxScroll > 0
					? ((headingTop - viewportHeight / 2) / maxScroll) * thumbTravel +
						TRACK_MARGIN +
						thumbHeight / 2
					: viewportHeight / 2;
			const markerY = clamp(
				rawMarkerY,
				TRACK_MARGIN,
				Math.max(TRACK_MARGIN, viewportHeight - TRACK_MARGIN),
			);
			marker.style.setProperty("--immersive-marker-y", `${markerY}px`);
			marker.classList.toggle(
				"is-on-thumb",
				markerY >= thumbTop && markerY <= thumbTop + thumbHeight,
			);
		});
	}

	private scheduleGeometry(): void {
		if (this.animationFrame !== null) return;
		this.animationFrame = window.requestAnimationFrame(() => {
			this.updateGeometry();
		});
	}

	private clearHideTimeout(): void {
		if (this.hideTimeout === null) return;
		window.clearTimeout(this.hideTimeout);
		this.hideTimeout = null;
	}

	private queueHide(): void {
		this.clearHideTimeout();
		if (!this.root || this.pointerInside || this.dragging) return;
		this.hideTimeout = window.setTimeout(() => {
			this.root?.classList.remove("is-visible");
			this.hideTimeout = null;
		}, AUTO_HIDE_DELAY);
	}

	private showTemporarily(): void {
		this.root?.classList.add("is-visible");
		this.queueHide();
	}

	private scrollTo(top: number, smooth = false): void {
		window.scrollTo({
			top: clamp(top, 0, this.geometry.maxScroll),
			behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
		});
	}

	private handleScroll = (): void => {
		this.showTemporarily();
		this.scheduleGeometry();
	};

	private handleResize = (): void => {
		this.refresh();
	};

	private handlePointerEnter = (): void => {
		this.pointerInside = true;
		this.clearHideTimeout();
		this.root?.classList.add("is-visible");
	};

	private handlePointerLeave = (): void => {
		this.pointerInside = false;
		this.queueHide();
	};

	private handleTrackPointerDown = (event: PointerEvent): void => {
		if (event.button !== 0 || !this.track) return;
		event.preventDefault();
		this.showTemporarily();

		const { thumbTop, thumbHeight, thumbTravel, maxScroll } = this.geometry;
		if (event.clientY >= thumbTop && event.clientY <= thumbTop + thumbHeight) {
			this.dragging = true;
			this.dragPointerId = event.pointerId;
			this.dragOffset = event.clientY - thumbTop;
			this.root?.classList.add("is-dragging");
			this.track.setPointerCapture(event.pointerId);
			return;
		}

		const targetProgress =
			thumbTravel > 0
				? clamp(
						(event.clientY - TRACK_MARGIN - thumbHeight / 2) / thumbTravel,
						0,
						1,
					)
				: 0;
		this.scrollTo(targetProgress * maxScroll, true);
	};

	private handleTrackPointerMove = (event: PointerEvent): void => {
		if (!this.dragging || event.pointerId !== this.dragPointerId) return;
		const { thumbTravel, maxScroll } = this.geometry;
		const nextThumbTop = clamp(
			event.clientY - this.dragOffset,
			TRACK_MARGIN,
			TRACK_MARGIN + thumbTravel,
		);
		const progress =
			thumbTravel > 0 ? (nextThumbTop - TRACK_MARGIN) / thumbTravel : 0;
		this.scrollTo(progress * maxScroll);
	};

	private handleTrackPointerUp = (event: PointerEvent): void => {
		if (!this.dragging || event.pointerId !== this.dragPointerId) return;
		this.dragging = false;
		this.dragPointerId = null;
		this.root?.classList.remove("is-dragging");
		if (this.track?.hasPointerCapture(event.pointerId)) {
			this.track.releasePointerCapture(event.pointerId);
		}
		this.queueHide();
	};

	private handleTrackKeyDown = (event: KeyboardEvent): void => {
		let target: number | null = null;
		switch (event.key) {
			case "ArrowUp":
				target = window.scrollY - 48;
				break;
			case "ArrowDown":
				target = window.scrollY + 48;
				break;
			case "PageUp":
				target = window.scrollY - window.innerHeight * 0.8;
				break;
			case "PageDown":
				target = window.scrollY + window.innerHeight * 0.8;
				break;
			case "Home":
				target = 0;
				break;
			case "End":
				target = this.geometry.maxScroll;
				break;
		}

		if (target === null) return;
		event.preventDefault();
		this.showTemporarily();
		this.scrollTo(target, true);
	};

	private handleMarkerClick = (event: MouseEvent): void => {
		const target = event.target as Element | null;
		const marker = target?.closest<HTMLButtonElement>(
			".immersive-scroll-marker",
		);
		if (!marker) return;
		const headingId = marker.dataset.headingId;
		const heading = headingId ? this.headings.get(headingId) : null;
		if (!heading) return;

		const targetTop =
			heading.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
		this.scrollTo(targetTop, true);
	};

	public activate(): void {
		if (
			!this.bindElements() ||
			!this.root ||
			!this.track ||
			!this.markerContainer
		)
			return;

		this.root.hidden = false;
		document.documentElement.classList.add("immersive-scroll-rail-active");
		if (!this.active) {
			this.active = true;
			window.addEventListener("scroll", this.handleScroll, { passive: true });
			window.addEventListener("resize", this.handleResize, { passive: true });
			this.root.addEventListener("pointerenter", this.handlePointerEnter);
			this.root.addEventListener("pointerleave", this.handlePointerLeave);
			this.track.addEventListener("pointerdown", this.handleTrackPointerDown);
			this.track.addEventListener("pointermove", this.handleTrackPointerMove);
			this.track.addEventListener("pointerup", this.handleTrackPointerUp);
			this.track.addEventListener("pointercancel", this.handleTrackPointerUp);
			this.track.addEventListener("keydown", this.handleTrackKeyDown);
			this.markerContainer.addEventListener("click", this.handleMarkerClick);
		}

		this.resizeObserver?.disconnect();
		this.resizeObserver = new ResizeObserver(() => this.scheduleGeometry());
		const content = document.querySelector<HTMLElement>(".custom-md");
		if (content) this.resizeObserver.observe(content);
		this.resizeObserver.observe(document.body);
		this.refresh();
		this.showTemporarily();
	}

	public refresh(): void {
		if (!this.active || !this.markerContainer) return;
		this.headings.clear();
		this.contentHeadings = this.getContentHeadings();
		const fragment = document.createDocumentFragment();
		const markers: HTMLButtonElement[] = [];

		this.getRailItems().forEach((item) => {
			const marker = this.createMarker(item);
			if (!marker) return;
			markers.push(marker);
			fragment.append(marker);
		});

		this.markerContainer.replaceChildren(fragment);
		this.markerButtons = markers;
		this.applyActiveState();
		this.scheduleGeometry();
	}

	public setActiveHeadingIds(headingIds: string[]): void {
		this.activeHeadingIds = new Set(headingIds);
		this.applyActiveState();
	}

	public deactivate(): void {
		document.documentElement.classList.remove("immersive-scroll-rail-active");
		this.clearHideTimeout();
		if (this.animationFrame !== null) {
			window.cancelAnimationFrame(this.animationFrame);
			this.animationFrame = null;
		}
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;

		if (this.active) {
			window.removeEventListener("scroll", this.handleScroll);
			window.removeEventListener("resize", this.handleResize);
			this.root?.removeEventListener("pointerenter", this.handlePointerEnter);
			this.root?.removeEventListener("pointerleave", this.handlePointerLeave);
			this.track?.removeEventListener(
				"pointerdown",
				this.handleTrackPointerDown,
			);
			this.track?.removeEventListener(
				"pointermove",
				this.handleTrackPointerMove,
			);
			this.track?.removeEventListener("pointerup", this.handleTrackPointerUp);
			this.track?.removeEventListener(
				"pointercancel",
				this.handleTrackPointerUp,
			);
			this.track?.removeEventListener("keydown", this.handleTrackKeyDown);
			this.markerContainer?.removeEventListener(
				"click",
				this.handleMarkerClick,
			);
		}

		this.active = false;
		this.pointerInside = false;
		this.dragging = false;
		this.dragPointerId = null;
		this.activeHeadingIds.clear();
		this.contentHeadings = [];
		this.root?.classList.remove("is-visible", "is-dragging", "is-scrollable");
		if (this.root) this.root.hidden = true;
	}
}
