import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(
	readFileSync(
		new URL("../src/scripts/waline-login.ts", import.meta.url),
		"utf8",
	),
	{ compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;

function fixture() {
	let handler;
	let resolve;
	const calls = [];
	class Element {
		constructor(login = true) {
			this.login = login;
		}
		closest(selector) {
			assert.equal(
				selector,
				'.wl-footer .wl-info > button.wl-btn[type="button"]',
			);
			return this.login ? this : null;
		}
	}
	const mount = {
		contains: () => true,
		addEventListener: (type, callback, capture) => {
			assert.equal(type, "click");
			assert.equal(capture, true);
			handler = callback;
		},
		removeEventListener: (type, callback, capture) => {
			assert.equal(type, "click");
			assert.equal(callback, handler);
			assert.equal(capture, true);
			handler = undefined;
		},
	};
	const context = vm.createContext({
		exports: {},
		Element,
		AbortController,
		console,
		require: () => ({
			loginForLike: (...args) => {
				calls.push(args);
				return new Promise((done) => {
					resolve = done;
				});
			},
		}),
	});
	vm.runInContext(source, context);
	return {
		calls,
		mount,
		bind: () =>
			context.exports.bindWalineLogin(
				mount,
				"https://comments.example",
				"zh-CN",
			),
		finish: () => resolve(true),
		click(login = true) {
			const event = {
				target: new Element(login),
				preventDefault() {
					this.prevented = true;
				},
				stopImmediatePropagation() {
					this.stopped = true;
				},
			};
			handler?.(event);
			return event;
		},
	};
}

test("login is intercepted before Waline's mobile frame navigation; repeated clicks share one popup", async () => {
	const f = fixture();
	const unbind = f.bind();
	const event = f.click();
	assert.equal(event.prevented, true);
	assert.equal(event.stopped, true);
	f.click();
	assert.equal(f.calls.length, 1);
	assert.equal(f.calls[0][0], "https://comments.example");
	assert.equal(f.calls[0][1], "zh-CN");
	f.finish();
	await new Promise((done) => setImmediate(done));
	f.click();
	assert.equal(f.calls.length, 2);
	unbind();
});

test("submit, editor tools and clicks outside the mount keep their original handlers", () => {
	const f = fixture();
	const unbind = f.bind();
	assert.equal(f.click(false).stopped, undefined);
	f.mount.contains = () => false;
	assert.equal(f.click().stopped, undefined);
	assert.equal(f.calls.length, 0);
	unbind();
});

test("Swup cleanup aborts pending login and removes the capture listener before remount", () => {
	const f = fixture();
	const unbind = f.bind();
	f.click();
	const signal = f.calls[0][2];
	unbind();
	assert.equal(signal.aborted, true);
	f.click();
	assert.equal(f.calls.length, 1);
	const nextCleanup = f.bind();
	f.click();
	assert.equal(f.calls.length, 2);
	nextCleanup();
});
