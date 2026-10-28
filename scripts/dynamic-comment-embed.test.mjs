import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadModule(path, globals) {
	const source = ts.transpileModule(
		readFileSync(new URL(path, import.meta.url), "utf8"),
		{ compilerOptions: { module: ts.ModuleKind.CommonJS } },
	).outputText;
	const context = vm.createContext({ exports: {}, ...globals });
	vm.runInContext(source, context);
	return context.exports;
}

function eventTarget() {
	const listeners = new Map();
	return {
		addEventListener(type, handler) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type).add(handler);
		},
		removeEventListener(type, handler) {
			listeners.get(type)?.delete(handler);
		},
		emit(type, event = {}) {
			for (const handler of listeners.get(type) || []) handler(event);
		},
	};
}

function embedFixture() {
	const messages = [];
	const frames = new Map();
	let nextFrame = 0;
	let contentHeight = 700;
	let resize;
	let observed;
	const main = {
		getBoundingClientRect: () => ({ height: contentHeight }),
		get scrollHeight() {
			return contentHeight;
		},
	};
	const root = {
		scrollHeight: 10000, // A stale iframe viewport must never set the reported height.
		classList: {
			toggle: (_name, dark) => {
				root.dark = dark;
			},
		},
		dataset: {},
		style: {
			setProperty: (_name, hue) => {
				root.hue = hue;
			},
		},
	};
	const parent = { postMessage: (message) => messages.push(message) };
	const window = {
		...eventTarget(),
		parent,
		location: { origin: "https://example.com" },
	};
	const document = {
		...eventTarget(),
		documentElement: root,
		querySelector: () => main,
	};
	const { initDynamicCommentEmbed } = loadModule(
		"../src/components/pages/dynamic/dynamic-comment-embed.ts",
		{
			window,
			document,
			ResizeObserver: class {
				constructor(callback) {
					resize = callback;
				}
				observe(element) {
					observed = element;
				}
				disconnect() {
					observed = undefined;
				}
			},
			requestAnimationFrame(callback) {
				frames.set(++nextFrame, callback);
				return nextFrame;
			},
			cancelAnimationFrame(id) {
				frames.delete(id);
			},
		},
	);
	const dispose = initDynamicCommentEmbed();
	return {
		window,
		parent,
		root,
		main,
		messages,
		dispose,
		get observed() {
			return observed;
		},
		get pending() {
			return frames.size;
		},
		resize(height) {
			contentHeight = height;
			resize();
		},
		flush() {
			const callbacks = [...frames.values()];
			frames.clear();
			for (const callback of callbacks) callback();
		},
		theme(overrides = {}) {
			window.emit("message", {
				origin: window.location.origin,
				source: parent,
				data: { type: "dynamic-comment-theme", dark: true, hue: 308 },
				...overrides,
			});
		},
	};
}

test("content grows and shrinks independently of iframe viewport; resize bursts and repeated heights are deduplicated", () => {
	const f = embedFixture();
	assert.equal(f.observed, f.main);
	f.flush();
	f.resize(900);
	f.resize(950);
	f.resize(950);
	assert.equal(f.pending, 1);
	f.flush();
	f.resize(300);
	f.flush();
	f.resize(300);
	f.flush();
	assert.deepEqual(
		f.messages.map(({ height }) => height),
		[700, 950, 300],
	);
	f.resize(Number.POSITIVE_INFINITY);
	f.flush();
	assert.equal(f.messages.length, 3);
});

test("theme updates require the same-origin parent and a boolean theme", () => {
	const f = embedFixture();
	f.flush();
	f.theme({ source: {} });
	f.theme({ origin: "https://other.example" });
	f.theme({ data: { type: "dynamic-comment-theme", dark: "true" } });
	assert.equal(f.root.dark, undefined);
	f.theme();
	assert.equal(f.root.dark, true);
	assert.equal(f.root.hue, "308");
});

test("pagehide cancels pending work; BFCache pageshow reconnects and sends fresh height", () => {
	const f = embedFixture();
	f.window.emit("pagehide");
	assert.equal(f.observed, undefined);
	assert.equal(f.pending, 0);
	f.theme();
	assert.equal(f.root.dark, undefined);
	f.window.emit("pageshow");
	f.flush();
	assert.equal(f.observed, f.main);
	assert.equal(f.messages.length, 1);
	f.window.emit("pagehide");
	f.window.emit("pageshow");
	f.flush();
	assert.equal(f.messages.length, 2);
	f.dispose();
	f.window.emit("pageshow");
	assert.equal(f.pending, 0);
});

test("parent accepts only its own frame height, rejects invalid values, and skips duplicate style writes", () => {
	let Constructor;
	const { registerDynamicInlineComments } = loadModule(
		"../src/components/pages/dynamic/dynamic-inline-comments.ts",
		{
			HTMLElement: class {},
			customElements: {
				get: () => undefined,
				define: (_name, value) => {
					Constructor = value;
				},
			},
			window: { location: { origin: "https://example.com" } },
		},
	);
	registerDynamicInlineComments();
	const element = new Constructor();
	let writes = 0;
	let height = "";
	const source = {};
	element.frame = {
		contentWindow: source,
		style: {
			get height() {
				return height;
			},
			set height(value) {
				writes++;
				height = value;
			},
		},
	};
	const send = (value, overrides = {}) =>
		element.handleMessage({
			origin: "https://example.com",
			source,
			data: { type: "dynamic-comment-height", height: value },
			...overrides,
		});
	send(700, { source: {} });
	send(700, { origin: "https://other.example" });
	for (const value of [
		Number.NaN,
		Number.POSITIVE_INFINITY,
		-1,
		0,
		"700",
		null,
	])
		send(value);
	assert.equal(writes, 0);
	send(700);
	send(700);
	send(700.0);
	assert.equal(writes, 1);
	send(300);
	assert.equal(height, "300px");
	send(100);
	assert.equal(height, "240px");
	send(500000);
	assert.equal(height, "500000px"); // Real long threads are not truncated.
});
