import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchWithDedup } from "./fetch-dedup";
import { fetchMemos } from "./memos-adapter";

test("deduplicated requests share failures and can retry after cleanup", async (t) => {
	for (const [name, request] of [
		["JSON", () => fetchWithDedup("https://example.test/data")],
		["Memos", () => fetchMemos("https://example.test")],
	] as const) {
		await t.test(name, async (t) => {
			const offline = new Error("offline");
			let attempts = 0;
			const fetch = t.mock.method(globalThis, "fetch", async () => {
				if (++attempts === 1) throw offline;
				return Response.json({ memos: [] });
			});

			const first = request();
			assert.strictEqual(request(), first);
			await assert.rejects(first, (error: unknown) => error === offline);
			// Give the test runner a turn to detect any unhandled rejection.
			await new Promise<void>((resolve) => setImmediate(resolve));

			const retry = request();
			assert.notStrictEqual(retry, first);
			assert.strictEqual(request(), retry);
			await retry;
			assert.equal(fetch.mock.callCount(), 2);
		});
	}
});
