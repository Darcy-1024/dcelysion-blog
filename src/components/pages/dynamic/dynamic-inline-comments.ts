export function registerDynamicInlineComments(): void {
	if (customElements.get("dynamic-inline-comments")) return;

	class DynamicInlineComments extends HTMLElement {
		private frame?: HTMLIFrameElement;
		private label = "";
		private static countTimer: ReturnType<typeof setTimeout> | undefined;
		private static countRequest?: AbortController;

		private static scheduleCounts() {
			clearTimeout(DynamicInlineComments.countTimer);
			DynamicInlineComments.countRequest?.abort();
			DynamicInlineComments.countTimer = setTimeout(
				() => void DynamicInlineComments.loadCounts(),
				50,
			);
		}

		private static async loadCounts() {
			const elements = Array.from(
				document.querySelectorAll<DynamicInlineComments>(
					"dynamic-inline-comments[data-count-server]",
				),
			).filter((element) => element.dataset.src);
			if (!elements.length) return;
			const paths = elements.map((element) =>
				new URL(element.dataset.src as string, location.href).searchParams.get(
					"path",
				),
			);
			const controller = new AbortController();
			DynamicInlineComments.countRequest = controller;
			try {
				const server = elements[0].dataset.countServer;
				const url = new URL(`${server?.replace(/\/$/, "")}/api/comment`);
				url.searchParams.set("type", "count");
				url.searchParams.set("url", paths.join(","));
				const response = await fetch(url, { signal: controller.signal });
				if (!response.ok) return;
				const result = await response.json();
				if (result.errno || !Array.isArray(result.data)) return;
				elements.forEach((element, index) => {
					const count = result.data[index];
					const label = element.querySelector("[data-comment-label]");
					if (
						!element.isConnected ||
						!label ||
						!Number.isSafeInteger(count) ||
						count < 0
					)
						return;
					label.textContent = count > 0 ? String(count) : element.label;
					element
						.querySelector("[data-comment-toggle]")
						?.setAttribute(
							"aria-label",
							count > 0 ? `${element.label} ${count}` : element.label,
						);
				});
			} catch {
				// Keep the normal comment entry available when counts cannot be loaded.
			}
		}

		connectedCallback() {
			this.frame?.addEventListener("load", this.syncTheme);
			if (this.frame) this.syncTheme();
			this.label ||=
				this.querySelector("[data-comment-label]")?.textContent || "Comments";
			this.querySelector("[data-comment-toggle]")?.addEventListener(
				"click",
				this.handleToggle,
			);
			window.addEventListener("message", this.handleMessage);
			window.addEventListener("dynamic-theme-change", this.syncTheme);
			DynamicInlineComments.observeTheme();
			if (this.dataset.defaultOpen === "true" && !this.frame) {
				this.handleToggle();
			}
			DynamicInlineComments.scheduleCounts();
		}

		disconnectedCallback() {
			this.frame?.removeEventListener("load", this.syncTheme);
			this.querySelector("[data-comment-toggle]")?.removeEventListener(
				"click",
				this.handleToggle,
			);
			window.removeEventListener("message", this.handleMessage);
			window.removeEventListener("dynamic-theme-change", this.syncTheme);
			DynamicInlineComments.scheduleCounts();
		}

		private static observeTheme() {
			if (document.documentElement.dataset.dynamicThemeObserver) return;
			new MutationObserver(() => {
				window.dispatchEvent(new Event("dynamic-theme-change"));
			}).observe(document.documentElement, {
				attributes: true,
				attributeFilter: ["class"],
			});
			document.documentElement.dataset.dynamicThemeObserver = "true";
		}

		private syncTheme = () => {
			this.frame?.contentWindow?.postMessage(
				{
					type: "dynamic-comment-theme",
					dark: document.documentElement.classList.contains("dark"),
					hue: Number(
						getComputedStyle(document.documentElement)
							.getPropertyValue("--hue")
							.trim(),
					),
				},
				window.location.origin,
			);
		};

		private handleMessage = (event: MessageEvent) => {
			if (
				event.origin !== window.location.origin ||
				event.source !== this.frame?.contentWindow ||
				event.data?.type !== "dynamic-comment-height"
			)
				return;
			if (this.frame) {
				const height = event.data.height;
				if (
					typeof height !== "number" ||
					!Number.isFinite(height) ||
					height <= 0
				)
					return;
				const nextHeight = `${Math.max(240, Math.ceil(height))}px`;
				if (this.frame.style.height !== nextHeight)
					this.frame.style.height = nextHeight;
			}
		};

		private handleToggle = () => {
			const panel = this.querySelector<HTMLElement>("[data-comment-panel]");
			if (!panel) return;
			const willOpen = panel.hidden;
			panel.hidden = !willOpen;
			this.dataset.expanded = String(willOpen);
			this.querySelector("[data-comment-toggle]")?.setAttribute(
				"aria-expanded",
				String(willOpen),
			);
			if (willOpen && !this.frame) this.load(panel);
			DynamicInlineComments.scheduleCounts();
		};

		private load(panel: HTMLElement) {
			const frame = document.createElement("iframe");
			frame.className = "page-comment-frame";
			frame.src = this.dataset.src || "";
			frame.title = this.label;
			frame.loading = "lazy";
			frame.addEventListener("load", this.syncTheme);
			panel.append(frame);
			this.frame = frame;
		}
	}

	customElements.define("dynamic-inline-comments", DynamicInlineComments);
}
