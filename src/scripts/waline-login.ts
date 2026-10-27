import { loginForLike } from "./content-like-auth";

// Waline 3.15.2 navigates the current frame on mobile. Use the existing
// origin/source-checked popup flow so a comment iframe stays on the blog.
export function bindWalineLogin(
	mount: HTMLElement,
	server: string,
	lang: string,
): () => void {
	let pending: AbortController | null = null;
	const handleClick = (event: MouseEvent) => {
		if (!(event.target instanceof Element)) return;
		const button = event.target.closest<HTMLButtonElement>(
			'.wl-footer .wl-info > button.wl-btn[type="button"]',
		);
		if (!button || !mount.contains(button)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (pending) return;
		const controller = new AbortController();
		pending = controller;
		void loginForLike(server, lang, controller.signal)
			.catch((error) => console.error("[Waline] Login failed:", error))
			.finally(() => {
				if (pending === controller) pending = null;
			});
	};
	mount.addEventListener("click", handleClick, true);
	return () => {
		mount.removeEventListener("click", handleClick, true);
		pending?.abort();
	};
}
