/** Keep the embedded document independent of the parent-controlled viewport. */
export function initDynamicCommentEmbed(): () => void {
	const main = document.querySelector<HTMLElement>(".page-comment-embed");
	if (!main || window.parent === window) return () => {};

	let active = false;
	let pending: number | undefined;
	let lastHeight: number | undefined;
	const reportHeight = () => {
		pending = undefined;
		if (!active) return;
		const height = Math.ceil(
			Math.max(main.getBoundingClientRect().height, main.scrollHeight),
		);
		if (!Number.isFinite(height) || height <= 0 || height === lastHeight)
			return;
		lastHeight = height;
		window.parent.postMessage(
			{ type: "dynamic-comment-height", height },
			window.location.origin,
		);
	};
	const scheduleHeight = () => {
		if (active && pending === undefined) {
			pending = requestAnimationFrame(reportHeight);
		}
	};
	const syncTheme = (event: MessageEvent) => {
		if (
			event.origin !== window.location.origin ||
			event.source !== window.parent ||
			event.data?.type !== "dynamic-comment-theme" ||
			typeof event.data.dark !== "boolean"
		)
			return;
		document.documentElement.classList.toggle("dark", event.data.dark);
		document.documentElement.dataset.theme = event.data.dark ? "dark" : "light";
		const hue = event.data.hue;
		if (typeof hue === "number" && Number.isFinite(hue)) {
			document.documentElement.style.setProperty("--hue", String(hue));
		}
		scheduleHeight();
	};
	const observer = new ResizeObserver(scheduleHeight);
	const stop = () => {
		active = false;
		observer.disconnect();
		if (pending !== undefined) cancelAnimationFrame(pending);
		pending = undefined;
		window.removeEventListener("message", syncTheme);
		window.removeEventListener("load", scheduleHeight);
		document.removeEventListener("fontsLoaded", scheduleHeight);
	};
	const start = () => {
		if (active) return;
		active = true;
		lastHeight = undefined;
		observer.observe(main);
		window.addEventListener("message", syncTheme);
		window.addEventListener("load", scheduleHeight);
		document.addEventListener("fontsLoaded", scheduleHeight);
		scheduleHeight();
	};
	window.addEventListener("pagehide", stop);
	window.addEventListener("pageshow", start);
	start();
	return () => {
		stop();
		window.removeEventListener("pagehide", stop);
		window.removeEventListener("pageshow", start);
	};
}
