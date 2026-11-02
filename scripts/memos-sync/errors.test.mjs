import assert from "node:assert/strict";
import test from "node:test";
import { errorReason } from "./errors.mjs";
import { git } from "./publish.mjs";

test("Git failure diagnostics expose only safe operation categories", async () => {
	await assert.rejects(
		git(process.cwd(), [
			"rev-parse",
			"--verify",
			"refs/heads/memos-test-nonexistent-ref",
		]),
		(error) => {
			assert.equal(errorReason(error), "git-local-failed");
			assert.equal(error.message.includes("memos-test-nonexistent-ref"), false);
			return true;
		},
	);
	assert.equal(
		errorReason({ gitOperation: "fetch", gitTimedOut: true }),
		"git-fetch-timeout",
	);
	assert.equal(
		errorReason({ gitOperation: "push", gitTimedOut: false }),
		"git-push-failed",
	);
	assert.equal(
		errorReason({ gitOperation: "secret-value", gitTimedOut: true }),
		"unknown",
	);
});
