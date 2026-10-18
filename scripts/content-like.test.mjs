import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compile = (name) =>
	ts.transpileModule(
		readFileSync(new URL(`../src/scripts/${name}.ts`, import.meta.url), "utf8"),
		{
			compilerOptions: {
				target: ts.ScriptTarget.ES2022,
				module: ts.ModuleKind.CommonJS,
			},
		},
	).outputText;
const source = compile("content-like");
const authSource = compile("content-like-auth");
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
	const registry = new Map();
	const requests = [];
	const confirms = [];
	const storage = () => {
		const map = new Map();
		return {
			getItem: (k) => map.get(k) ?? null,
			setItem: (k, v) => map.set(k, v),
			removeItem: (k) => map.delete(k),
		};
	};
	const localStorage = storage();
	const sessionStorage = storage();
	class Node extends EventTarget {
		dataset = {
			path: "/dynamic/entry/",
			server: "https://comments.example",
			like: "Like",
			liked: "Liked",
			error: "Failed",
			loginPrompt: "Please sign in to like. Sign in now?",
			loginRequired: "Sign in required",
		};
		isConnected = true;
		nodes = new Map();
		attrs = {};
		children = [];
		textContent = "";
		showModal() {
			this.open = true;
		}
		close() {
			this.open = false;
		}
		setAttribute(k, v) {
			this.attrs[k] = v;
		}
		querySelector(k) {
			if (!this.nodes.has(k)) this.nodes.set(k, new Node());
			return this.nodes.get(k);
		}
		replaceChildren(...nodes) {
			this.children = nodes;
		}
		append(...nodes) {
			this.children.push(...nodes);
		}
		remove() {
			this.removed = true;
		}
	}
	const window = new EventTarget();
	Object.assign(window, { localStorage, sessionStorage });
	const popup = {
		closed: false,
		close() {
			this.closed = true;
		},
	};
	let confirmResult = false;
	let blockPopup = false;
	let failure = 0;
	let hold = null;
	let liked = false;
	window.confirm = (text) => {
		confirms.push(text);
		return confirmResult;
	};
	window.open = (url) => {
		window.opened = url;
		return blockPopup ? null : popup;
	};
	const users = [
		{
			id: 1,
			nick: "<img src=x onerror=alert(1)>",
			avatar: "javascript:alert(1)",
		},
		{ id: 2, nick: "Reader", avatar: "https://comments.example/avatar.png" },
	];
	const context = vm.createContext({
		exports: {},
		HTMLElement: Node,
		window,
		localStorage,
		sessionStorage,
		customElements: {
			get: (k) => registry.get(k),
			define: (k, v) => registry.set(k, v),
		},
		document: { createElement: () => new Node() },
		URL,
		Event,
		EventTarget,
		AbortSignal,
		AbortController,
		queueMicrotask,
		setInterval,
		clearInterval,
		setTimeout,
		clearTimeout,
		StorageEvent: class extends Event {
			constructor(type, options) {
				super(type);
				Object.assign(this, options);
			}
		},
		fetch: async (url, options) => {
			requests.push({ url, options });
			if (failure) return { ok: false, status: failure };
			if (options.method === "POST") {
				assert.equal(options.headers.Authorization, "Bearer valid-token");
				const body = JSON.parse(options.body);
				assert.equal(body.path, "/dynamic/entry");
				assert.equal(typeof body.liked, "boolean");
				if (hold) await hold;
				liked = body.liked;
			}
			const offset = Number(url.searchParams.get("offset") || 0);
			return {
				ok: true,
				status: 200,
				json: async () => ({
					errno: 0,
					data: {
						count: liked ? 3 : 2,
						liked,
						users: offset ? [users[1]] : [users[0]],
						hasMore: !offset,
						nextOffset: offset ? null : 20,
					},
				}),
			};
		},
	});
	vm.runInContext(authSource, context);
	const auth = context.exports;
	context.exports = {};
	context.require = (name) => {
		assert.equal(name, "./content-like-auth");
		return auth;
	};
	vm.runInContext(source, context);
	context.exports.registerContentLike();
	const make = () => {
		const el = new (registry.get("content-like"))();
		el.connectedCallback();
		return el;
	};
	return {
		make,
		auth,
		window,
		popup,
		requests,
		confirms,
		localStorage,
		sessionStorage,
		signed() {
			localStorage.setItem(
				"WALINE_USER",
				JSON.stringify({ token: "valid-token" }),
			);
		},
		confirm(v) {
			confirmResult = v;
		},
		fail(code) {
			failure = code;
		},
		block() {
			blockPopup = true;
		},
		hold() {
			let release;
			hold = new Promise((r) => (release = r));
			return release;
		},
		message(origin = "https://comments.example", sender = popup) {
			const e = new Event("message");
			Object.assign(e, {
				origin,
				source: sender,
				data: {
					type: "userInfo",
					data: { token: "valid-token", remember: true, nick: "Reader" },
				},
			});
			window.dispatchEvent(e);
		},
	};
}
const click = (el, selector = "[data-like-toggle]") =>
	el.querySelector(selector).dispatchEvent(new Event("click"));
const postCount = (f) =>
	f.requests.filter((r) => r.options.method === "POST").length;
test("anonymous click shows login prompt without POST, including failed API", async () => {
	const f = fixture();
	f.fail(503);
	const el = f.make();
	await flush();
	click(el);
	await flush();
	assert.equal(el.querySelector("[data-like-dialog]").open, true);
	click(el, "[data-like-cancel]");
	assert.equal(el.querySelector("[data-like-dialog]").open, false);
	assert.equal(postCount(f), 0);
	assert.equal(f.window.opened, undefined);
	el.isConnected = false;
	el.disconnectedCallback();
});
test("login rejects wrong origin/source, accepts owned popup; login never auto-likes", async () => {
	const f = fixture();
	const el = f.make();
	await flush();
	click(el);
	assert.equal(el.querySelector("[data-like-dialog]").open, true);
	click(el, "[data-like-login]");
	assert.equal(f.window.opened, "https://comments.example/ui/login?lng=zh-CN");
	f.message("https://evil.example");
	f.message("https://comments.example", {});
	assert.equal(f.auth.getLikeToken(), "");
	assert.equal(postCount(f), 0);
	f.message();
	await flush();
	assert.equal(f.auth.getLikeToken(), "valid-token");
	assert.equal(f.popup.closed, true);
	assert.equal(postCount(f), 0);
	click(el);
	await flush();
	assert.equal(postCount(f), 1);
	assert.equal(
		el.querySelector("[data-like-toggle]").attrs["aria-pressed"],
		"true",
	);
	el.isConnected = false;
	el.disconnectedCallback();
});
test("signed likes/cancellation are boolean writes; duplicate clicks stay locked; remount uses server state", async () => {
	const f = fixture();
	f.signed();
	const el = f.make();
	await flush();
	const release = f.hold();
	click(el);
	click(el);
	assert.equal(postCount(f), 1);
	release();
	await flush();
	assert.equal(el.querySelector("[data-count]").textContent, "3");
	click(el);
	await flush();
	assert.equal(el.querySelector("[data-count]").textContent, "2");
	el.isConnected = false;
	el.disconnectedCallback();
	click(el);
	assert.equal(postCount(f), 2);
	const next = f.make();
	await flush();
	assert.equal(
		next.querySelector("[data-like-toggle]").attrs["aria-pressed"],
		"false",
	);
	next.disconnectedCallback();
});
test("nickname is text, unsafe avatar falls back, pagination appends and hides more", async () => {
	const f = fixture();
	const el = f.make();
	await flush();
	let rows = el.querySelector("[data-like-users]").children;
	assert.equal(rows[0].children[1].textContent, "<img src=x onerror=alert(1)>");
	assert.equal(rows[0].children[0].children.length, 0);
	click(el, "[data-like-more]");
	await flush();
	rows = el.querySelector("[data-like-users]").children;
	assert.equal(rows.length, 2);
	assert.equal(
		rows[1].children[0].children[0].src,
		"https://comments.example/avatar.png",
	);
	assert.equal(el.querySelector("[data-like-more]").hidden, true);
	el.disconnectedCallback();
});
test("401 clears expired session, later anonymous click asks login and does not write", async () => {
	const f = fixture();
	f.signed();
	const el = f.make();
	await flush();
	f.fail(401);
	click(el);
	await flush();
	assert.equal(f.auth.getLikeToken(), "");
	const before = postCount(f);
	click(el);
	await flush();
	assert.equal(el.querySelector("[data-like-dialog]").open, true);
	assert.equal(postCount(f), before);
	el.disconnectedCallback();
});
test("popup blocked/abort resolves safely and removes message listener", async () => {
	const f = fixture();
	const c = new AbortController();
	const pending = f.auth.loginForLike(
		"https://comments.example",
		"zh-CN",
		c.signal,
	);
	c.abort();
	assert.equal(await pending, false);
	f.message();
	assert.equal(f.auth.getLikeToken(), "");
	f.block();
	assert.equal(
		await f.auth.loginForLike(
			"https://comments.example",
			"zh-CN",
			new AbortController().signal,
		),
		false,
	);
});
test("current Waline account wins over an older session; expiry does not clear a newer account", () => {
	const f = fixture();
	f.sessionStorage.setItem(
		"WALINE_USER",
		JSON.stringify({ token: "old-token" }),
	);
	f.signed();
	assert.equal(f.auth.getLikeToken(), "valid-token");
	f.auth.clearLikeToken("old-token");
	assert.equal(f.auth.getLikeToken(), "valid-token");
});
