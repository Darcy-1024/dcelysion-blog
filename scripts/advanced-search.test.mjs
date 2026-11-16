import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the component's real production script with deferred Pagefind data.
// DOM hydration and Swup navigation are checked separately in the browser.
const source = readFileSync(
	new URL("../src/components/pages/AdvancedSearch.svelte", import.meta.url),
	"utf8",
)
	.split(/<\/?script[^>]*>/)[1]
	.replace(/^import .*;\r?$/gm, "")
	.replace(/^export /gm, "")
	.replaceAll("import.meta.env.PROD", "true")
	.replaceAll("import.meta.env.DEV", "false");
const { outputText } = ts.transpileModule(source, {
	compilerOptions: { target: ts.ScriptTarget.ESNext },
});

function setup() {
	const window = Object.assign(new EventTarget(), {
		location: { search: "" },
		pagefind: undefined,
	});
	const document = new EventTarget();
	const timers = new Set();
	const requests = [];
	let unmount;
	const pagefind = {
		async search(query) {
			const { promise, resolve } = Promise.withResolvers();
			requests.push({
				query,
				finish: () => resolve({ meta: { title: query } }),
			});
			return { results: [{ data: () => promise }] };
		},
	};
	const context = vm.createContext({
		window,
		document,
		URLSearchParams,
		I18nKey: {},
		i18n: () => "",
		formatUrl: (url) => url,
		setTimeout: (callback) => {
			timers.add(callback);
			return callback;
		},
		clearTimeout: (callback) => timers.delete(callback),
		onMount: (mount) => {
			unmount = mount();
		},
	});
	vm.runInContext(outputText, context);
	return {
		window,
		document,
		pagefind,
		requests,
		unmount,
		input(value) {
			context.event = { currentTarget: { value } };
			vm.runInContext("handleInput(event)", context);
		},
		debounce() {
			for (const callback of timers) {
				timers.delete(callback);
				callback();
			}
		},
		state: () =>
			vm.runInContext(
				"JSON.stringify([results.map(r => r.meta.title), isSearching])",
				context,
			),
	};
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("late results cannot replace newer results or undo a cleared input", async () => {
	const search = setup();
	search.window.pagefind = search.pagefind;
	search.window.dispatchEvent(new Event("pagefindready"));
	search.input("old");
	search.debounce();
	search.input("new");
	search.debounce();
	search.requests[1].finish();
	await settle();
	search.requests[0].finish();
	await settle();
	assert.equal(search.state(), '[["new"],false]');

	search.input("stale");
	search.debounce();
	search.input("");
	assert.equal(search.state(), "[[],false]");
	search.requests[2].finish();
	await settle();
	assert.equal(search.state(), "[[],false]");
	search.unmount();
});

test("unmount invalidates pending data and cancels debounce and readiness", async () => {
	const active = setup();
	active.window.pagefind = active.pagefind;
	active.document.dispatchEvent(new Event("pagefindready"));
	active.input("in flight");
	active.debounce();
	active.input("queued");
	active.unmount();
	active.debounce();
	active.requests[0].finish();
	await settle();
	assert.equal(active.requests.length, 1);
	assert.equal(active.state(), "[[],true]");

	const waiting = setup();
	waiting.input("before Pagefind");
	waiting.unmount();
	waiting.window.pagefind = waiting.pagefind;
	waiting.document.dispatchEvent(new Event("pagefindready"));
	waiting.window.dispatchEvent(new Event("pagefindready"));
	waiting.debounce();
	assert.equal(waiting.requests.length, 0);
});
