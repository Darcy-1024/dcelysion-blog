// Fsync the already-restored drill journals; no new backup or service exercise.
import assert from "node:assert/strict";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { MediaBudget } from "../server/media-budget.js";

const recovery = JSON.parse(
	await readFile("cache/stage9-evidence/recovery.json", "utf8"),
);
for (const [journal, limit] of [
	[join(recovery.restored, "media/sync-budget.jsonl"), 80_000_000_000],
	[join(recovery.restored, "edge/edge.jsonl"), 250_000_000_000],
] as const) {
	const handle = await open(journal, "r+");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
	const budget = new MediaBudget(journal, limit);
	assert.equal(await budget.available(), false);
	await assert.rejects(() => budget.reserve(1));
}
console.log(
	"Restored drill journals fsynced; both budgets deny new reservations",
);
