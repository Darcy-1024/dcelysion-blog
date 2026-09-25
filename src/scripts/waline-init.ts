import {
	init,
	type WalineInitOptions,
	type WalineInstance,
} from "@waline/client";
import "@waline/client/style";

type WalineOptions = Omit<WalineInitOptions, "el">;

let instance: WalineInstance | null = null;
let instanceElement: HTMLElement | null = null;
let listenersInstalled = false;
let hookedSwup: Window["swup"] | null = null;
let scheduleToken = 0;
let currentOptionsKey: string | null = null;

function normalizePath(path: string): string {
	return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
}

function getCurrentPath(configuredPath: string | undefined): string {
	const requestedPath = new URLSearchParams(window.location.search).get("path");
	if (requestedPath) return requestedPath;
	return normalizePath(configuredPath || window.location.pathname);
}

function getMountOptions(mountElement: HTMLElement): WalineOptions | null {
	const serializedConfig = mountElement.dataset.walineConfig;
	if (!serializedConfig) return null;

	try {
		const config = JSON.parse(serializedConfig) as WalineOptions;
		return { ...config, path: getCurrentPath(config.path) };
	} catch (error) {
		console.error("[Waline] Failed to parse configuration:", error);
		return null;
	}
}

function destroyWaline(): void {
	scheduleToken += 1;
	instance?.destroy();
	instance = null;
	instanceElement = null;
	currentOptionsKey = null;
}

function mountWaline(): void {
	const mountElement = document.querySelector<HTMLElement>(
		"#waline[data-waline-config]",
	);

	if (!mountElement) {
		destroyWaline();
		return;
	}

	const options = getMountOptions(mountElement);
	if (!options) {
		destroyWaline();
		return;
	}

	try {
		const optionsKey = JSON.stringify(options);
		if (instance && instanceElement === mountElement) {
			if (currentOptionsKey !== optionsKey) {
				instance.update(options);
				currentOptionsKey = optionsKey;
			}
			return;
		}

		destroyWaline();
		instance = init({ ...options, el: mountElement });
		if (instance) {
			instanceElement = mountElement;
			currentOptionsKey = optionsKey;
		}
	} catch (error) {
		instance = null;
		instanceElement = null;
		currentOptionsKey = null;
		console.error("[Waline] Failed to initialize:", error);
	}
}

function scheduleMount(): void {
	const token = ++scheduleToken;
	queueMicrotask(() => {
		if (token === scheduleToken) mountWaline();
	});
}

function attachSwupHooks(): void {
	const { swup } = window;
	if (!swup?.hooks || swup === hookedSwup) return;

	hookedSwup = swup;
	swup.hooks.before("content:replace", destroyWaline);
	swup.hooks.on("page:view", scheduleMount);
}

function handleSwupEnable(): void {
	attachSwupHooks();
	scheduleMount();
}

export function registerWaline(): void {
	if (!listenersInstalled) {
		listenersInstalled = true;
		document.addEventListener("swup:enable", handleSwupEnable);
		document.addEventListener("astro:page-load", scheduleMount);
		window.addEventListener("pagehide", destroyWaline);
		window.addEventListener("pageshow", scheduleMount);
	}

	attachSwupHooks();
	scheduleMount();
}
