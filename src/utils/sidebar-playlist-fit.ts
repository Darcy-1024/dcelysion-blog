let observer: ResizeObserver | undefined;
let frame = 0;
let registered = false;

function scheduleFit(): void {
	if (frame) return;
	frame = requestAnimationFrame(() => {
		frame = 0;
		fitPlaylists();
	});
}

function fitPlaylists(): void {
	const rem = Number.parseFloat(
		getComputedStyle(document.documentElement).fontSize,
	);
	for (const side of ["left", "right"]) {
		const sticky = document.getElementById(`${side}-sidebar-sticky`);
		const list = sticky?.querySelector<HTMLElement>(".playlist-container");
		const drawer = list?.closest<HTMLElement>(".playlist-drawer");
		if (!sticky || !list || !drawer) continue;
		if (!sticky.offsetHeight || window.innerWidth <= 768) {
			list.style.removeProperty("max-height");
			sticky.style.removeProperty("position");
			continue;
		}
		// Wait for accordion animations: intermediate heights are not the space budget.
		if (
			sticky
				.getAnimations({ subtree: true })
				.some(
					(animation) =>
						animation instanceof CSSTransition &&
						animation.playState === "running",
				)
		)
			continue;
		const top = Math.max(
			rem,
			Number.parseFloat(getComputedStyle(sticky).top) || 0,
		);
		const available = document.documentElement.clientHeight - top - rem;
		const open = drawer.style.gridTemplateRows === "1fr";
		const height = sticky.getBoundingClientRect().height;
		const currentListHeight = list.getBoundingClientRect().height;
		const otherHeight = height - (open ? currentListHeight : 0);
		// Reserve roughly two songs, with the existing 12rem maximum.
		const maximum = 12 * rem;
		const minimum = Math.min(96, maximum);
		const target = open
			? Math.min(
					maximum,
					Math.max(minimum, Math.floor(available - otherHeight)),
				)
			: maximum;
		const value = `${target}px`;
		if (list.style.maxHeight !== value) {
			list.style.maxHeight = value;
			// The existing virtual list listens for scroll to refresh its visible range.
			list.dispatchEvent(new Event("scroll"));
		}
		const fittedHeight =
			otherHeight + (open ? Math.min(currentListHeight, target) : 0);
		if (fittedHeight > available + 1) sticky.style.position = "static";
		else sticky.style.removeProperty("position");
	}
}

/** Rebind after Swup replacement; global listeners are registered only once. */
export function refreshSidebarPlaylistFit(): void {
	observer?.disconnect();
	observer ??= new ResizeObserver(scheduleFit);
	for (const side of ["left", "right"]) {
		const sticky = document.getElementById(`${side}-sidebar-sticky`);
		if (sticky) observer.observe(sticky);
	}
	if (!registered) {
		registered = true;
		window.addEventListener("resize", scheduleFit, { passive: true });
		document.addEventListener("transitionend", scheduleFit);
		document.addEventListener("transitioncancel", scheduleFit);
		new MutationObserver(scheduleFit).observe(document.body, {
			attributes: true,
			attributeFilter: ["class"],
		});
	}
	scheduleFit();
}
