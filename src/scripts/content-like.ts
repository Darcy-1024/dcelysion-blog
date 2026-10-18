import {
	clearLikeToken,
	getLikeToken,
	LIKE_AUTH_EVENT,
	loginForLike,
} from "./content-like-auth";

interface LikeUser {
	id: string | number;
	nick: string;
	avatar: string;
}
interface LikeState {
	count: number;
	liked: boolean;
	users: LikeUser[];
	hasMore: boolean;
	nextOffset: number | null;
}
export function registerContentLike(): void {
	if (customElements.get("content-like")) return;
	class ContentLike extends HTMLElement {
		private lifetime?: AbortController;
		private requestController?: AbortController;
		private busy = false;
		private loading = false;
		private token = "";
		private state: LikeState | null = null;
		private get path() {
			return (this.dataset.path || "").replace(/\/$/, "");
		}
		connectedCallback() {
			queueMicrotask(() => {
				if (!this.isConnected || !this.path) return;
				this.lifetime?.abort();
				this.lifetime = new AbortController();
				const options = { signal: this.lifetime.signal };
				this.querySelector("[data-like-toggle]")?.addEventListener(
					"click",
					this.toggle,
					options,
				);
				this.querySelector("[data-like-more]")?.addEventListener(
					"click",
					this.more,
					options,
				);
				const dialog =
					this.querySelector<HTMLDialogElement>("[data-like-dialog]");
				this.querySelector("[data-like-login]")?.addEventListener(
					"click",
					() => {
						dialog?.close();
						void this.login();
					},
					options,
				);
				this.querySelector("[data-like-cancel]")?.addEventListener(
					"click",
					() => dialog?.close(),
					options,
				);
				dialog?.addEventListener(
					"click",
					(event) => {
						if (event.target !== dialog) return;
						const rect = dialog.getBoundingClientRect();
						if (
							event.clientX < rect.left ||
							event.clientX > rect.right ||
							event.clientY < rect.top ||
							event.clientY > rect.bottom
						)
							dialog.close();
					},
					options,
				);
				for (const event of [
					"storage",
					"vueuse-storage",
					"focus",
					LIKE_AUTH_EVENT,
				])
					window.addEventListener(event, this.syncAuth, options);
				this.token = getLikeToken();
				void this.load();
			});
		}
		disconnectedCallback() {
			this.querySelector<HTMLDialogElement>("[data-like-dialog]")?.close();
			this.lifetime?.abort();
			this.requestController?.abort();
		}
		private syncAuth = () => {
			const token = getLikeToken();
			if (token === this.token) return;
			this.token = token;
			this.state = null;
			void this.load();
		};
		private async request(
			liked?: boolean,
			offset = 0,
			signal?: AbortSignal,
		): Promise<LikeState> {
			const endpoint = new URL(
				`${this.dataset.server?.replace(/\/$/, "")}/api/content-like`,
			);
			const token = getLikeToken();
			const headers: Record<string, string> = {};
			if (token) headers.Authorization = `Bearer ${token}`;
			if (liked === undefined) {
				endpoint.searchParams.set("path", this.path);
				endpoint.searchParams.set("offset", String(offset));
			} else headers["Content-Type"] = "application/json";
			const response = await fetch(endpoint, {
				method: liked === undefined ? "GET" : "POST",
				headers,
				cache: "no-store",
				signal: signal ?? AbortSignal.timeout(10000),
				...(liked === undefined
					? {}
					: { body: JSON.stringify({ path: this.path, liked }) }),
			});
			if (response.status === 401) {
				clearLikeToken(token);
				throw new Error("LOGIN_REQUIRED");
			}
			if (!response.ok) throw new Error("REQUEST_FAILED");
			const result = await response.json();
			const data = result.data;
			if (
				result.errno ||
				!data ||
				!Number.isSafeInteger(data.count) ||
				data.count < 0 ||
				typeof data.liked !== "boolean" ||
				!Array.isArray(data.users) ||
				typeof data.hasMore !== "boolean" ||
				!(
					data.nextOffset === null ||
					(Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset)
				)
			)
				throw new Error("INVALID_RESPONSE");
			if (
				!data.users.every(
					(user: LikeUser) =>
						user &&
						["string", "number"].includes(typeof user.id) &&
						typeof user.nick === "string" &&
						typeof user.avatar === "string",
				)
			)
				throw new Error("INVALID_RESPONSE");
			return data;
		}
		private async load(offset = 0) {
			this.requestController?.abort();
			const controller = new AbortController();
			this.requestController = controller;
			this.loading = true;
			this.render();
			try {
				const data = await this.request(
					undefined,
					offset,
					AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
				);
				if (controller !== this.requestController || !this.isConnected) return;
				if (offset && this.state)
					data.users = [...this.state.users, ...data.users].filter(
						(user, index, users) =>
							users.findIndex((item) => item.id === user.id) === index,
					);
				this.state = data;
				this.status("");
			} catch (error) {
				if (
					controller === this.requestController &&
					this.isConnected &&
					!controller.signal.aborted
				)
					this.status(
						error instanceof Error && error.message === "LOGIN_REQUIRED"
							? this.dataset.loginRequired || ""
							: this.dataset.error || "",
					);
			} finally {
				if (controller === this.requestController) {
					this.loading = false;
					if (this.isConnected) this.render();
				}
			}
		}
		private more = () => {
			if (!this.busy && !this.loading && this.state?.nextOffset != null)
				void this.load(this.state.nextOffset);
		};
		private login = async () => {
			if (this.busy || !this.lifetime) return;
			this.busy = true;
			this.render();
			try {
				if (
					await loginForLike(
						this.dataset.server || "",
						this.dataset.lang || "zh-CN",
						this.lifetime.signal,
					)
				) {
					this.token = getLikeToken();
					await this.load();
				} else if (this.isConnected)
					this.status(this.dataset.loginRequired || "");
			} finally {
				this.busy = false;
				if (this.isConnected) this.render();
			}
		};
		private toggle = async () => {
			if (this.busy || !this.lifetime) return;
			// Show login guidance even when the backend is unavailable or still loading.
			if (!getLikeToken()) {
				this.querySelector<HTMLDialogElement>(
					"[data-like-dialog]",
				)?.showModal();
				return;
			}
			if (this.loading) return;
			if (!this.state || this.token !== getLikeToken()) {
				this.token = getLikeToken();
				await this.load();
				return;
			}
			this.busy = true;
			this.render();
			this.status("");
			const token = getLikeToken();
			try {
				const state = await this.request(!this.state.liked);
				if (getLikeToken() === token) this.state = state;
			} catch (error) {
				this.status(
					error instanceof Error && error.message === "LOGIN_REQUIRED"
						? this.dataset.loginRequired || ""
						: this.dataset.error || "",
				);
			} finally {
				this.busy = false;
				if (this.isConnected) this.render();
			}
		};
		private status(text: string) {
			const status = this.querySelector("[role=status]");
			if (status) status.textContent = text;
		}
		private render() {
			const button =
				this.querySelector<HTMLButtonElement>("[data-like-toggle]");
			if (button) {
				button.disabled =
					this.busy || (this.loading && Boolean(getLikeToken()));
				button.setAttribute("aria-pressed", String(this.state?.liked ?? false));
			}
			const label = this.querySelector("[data-label]");
			if (label)
				label.textContent =
					(this.state?.liked ? this.dataset.liked : this.dataset.like) || "";
			const count = this.querySelector("[data-count]");
			if (count)
				count.textContent = this.state ? String(this.state.count) : "—";
			const list = this.querySelector("[data-like-users]");
			if (list) {
				list.replaceChildren();
				for (const user of this.state?.users ?? []) {
					const item = document.createElement("li");
					const avatar = document.createElement("span");
					avatar.className = "like-avatar";
					avatar.textContent = Array.from(user.nick)[0] || "?";
					avatar.setAttribute("aria-hidden", "true");
					try {
						const url = new URL(user.avatar, this.dataset.server);
						if (
							user.avatar &&
							["https:", "http:"].includes(url.protocol) &&
							!url.username &&
							!url.password
						) {
							const image = document.createElement("img");
							image.src = url.href;
							image.alt = "";
							image.loading = "lazy";
							image.referrerPolicy = "no-referrer";
							image.addEventListener("error", () => image.remove(), {
								once: true,
							});
							avatar.append(image);
						}
					} catch {
						/* Invalid avatar URLs retain the initial fallback. */
					}
					const name = document.createElement("span");
					name.textContent = user.nick;
					item.append(avatar, name);
					list.append(item);
				}
			}
			const more = this.querySelector<HTMLButtonElement>("[data-like-more]");
			if (more) {
				more.hidden = !this.state?.hasMore;
				more.disabled = this.loading || this.busy;
			}
		}
	}
	customElements.define("content-like", ContentLike);
}
