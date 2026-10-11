import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { diskFilesystem } from "../build/work-root.js";
import { finishArchive, prepareContainer } from "../server/build-lifecycle.js";

test("cancellation after CLI exit interrupts pending output flush", async () => {
	const stream = new Writable({
		write(_chunk, _encoding, done) {
			done();
		},
		final(_done) {},
	});
	stream.end("pending");
	const controller = new AbortController();
	const pending = finishArchive(stream, controller.signal, 100);
	controller.abort();
	await assert.rejects(pending, /BUILD_CANCELLED/);
	assert.equal(stream.destroyed, true);
});

test("output flush has a finite deadline even without cancellation", async () => {
	const stream = new Writable({
		write(_chunk, _encoding, done) {
			done();
		},
		final(_done) {},
	});
	stream.end("pending");
	await assert.rejects(
		finishArchive(stream, undefined, 10),
		/BUILD_RUNTIME_UNKNOWN/,
	);
	assert.equal(stream.destroyed, true);
});

test("builder upload spool rejects tmpfs and ramfs without changing memory gates", () => {
	assert.equal(diskFilesystem(0x01021994), false);
	assert.equal(diskFilesystem(0x858458f6n), false);
	assert.equal(diskFilesystem(0xef53), true);
});

test("cancellation during daemon creation waits and removes the created container", async () => {
	const controller = new AbortController();
	let complete!: () => void;
	const pending = new Promise<void>((resolve) => {
		complete = resolve;
	});
	let removed = false;
	const result = prepareContainer(
		() => pending,
		async () => {
			removed = true;
		},
		controller.signal,
	);
	controller.abort();
	assert.equal(removed, false);
	complete();
	await assert.rejects(result, /BUILD_CANCELLED/);
	assert.equal(removed, true);
});

test("pre-cancelled job never creates a container", async () => {
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		prepareContainer(
			async () => {
				assert.fail("create");
			},
			async () => {},
			controller.signal,
		),
		/BUILD_CANCELLED/,
	);
});
