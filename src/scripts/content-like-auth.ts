const USER_KEY = "WALINE_USER";
export const LIKE_AUTH_EVENT = "content-like-auth";

export function getLikeToken(): string {
	// Waline's live userInfo is localStorage-backed, including account switches.
	for (const name of ["localStorage", "sessionStorage"] as const) {
		try {
			const user = JSON.parse(window[name].getItem(USER_KEY) || "null");
			if (typeof user?.token === "string" && user.token) return user.token;
		} catch {
			/* Storage can be unavailable. */
		}
	}
	return "";
}
export function clearLikeToken(token: string): void {
	for (const name of ["sessionStorage", "localStorage"] as const) {
		try {
			const storage = window[name];
			if (JSON.parse(storage.getItem(USER_KEY) || "null")?.token === token)
				storage.removeItem(USER_KEY);
		} catch {
			/* Storage can be unavailable. */
		}
	}
	window.dispatchEvent(new Event(LIKE_AUTH_EVENT));
}
// Only the configured server and the popup we opened may supply a login result.
export function loginForLike(
	server: string,
	lang: string,
	signal: AbortSignal,
): Promise<boolean> {
	const url = new URL(`${server.replace(/\/$/, "")}/ui/login`);
	url.searchParams.set("lng", lang);
	const popup = window.open(
		url.href,
		"_blank",
		"width=800,height=640,scrollbars=yes,resizable=yes",
	);
	if (!popup) return Promise.resolve(false);
	return new Promise((resolve) => {
		let finished = false;
		const finish = (success: boolean) => {
			if (finished) return;
			finished = true;
			window.removeEventListener("message", onMessage);
			signal.removeEventListener("abort", onAbort);
			clearInterval(closedTimer);
			clearTimeout(expiryTimer);
			resolve(success);
		};
		const onAbort = () => finish(false);
		const onMessage = (event: MessageEvent) => {
			if (
				event.origin !== url.origin ||
				event.source !== popup ||
				event.data?.type !== "userInfo"
			)
				return;
			const user = event.data.data;
			if (
				typeof user?.token !== "string" ||
				!user.token ||
				user.token.length > 16384
			)
				return;
			try {
				localStorage.removeItem(USER_KEY);
				sessionStorage.removeItem(USER_KEY);
				const storage = user.remember ? localStorage : sessionStorage;
				const value = JSON.stringify(user);
				storage.setItem(USER_KEY, value);
				window.dispatchEvent(
					new StorageEvent("storage", {
						key: USER_KEY,
						newValue: value,
						storageArea: storage,
					}),
				);
				window.dispatchEvent(new Event(LIKE_AUTH_EVENT));
				popup.close();
				finish(true);
			} catch {
				finish(false);
			}
		};
		const closedTimer = setInterval(() => {
			if (popup.closed) finish(false);
		}, 500);
		const expiryTimer = setTimeout(() => finish(false), 300000);
		window.addEventListener("message", onMessage);
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) finish(false);
	});
}
