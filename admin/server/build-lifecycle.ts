import type { Writable } from "node:stream";

// Await daemon creation before checking cancellation: an empty ps while create is
// in flight does not prove that the job has stopped.
export async function prepareContainer(
	create: () => Promise<unknown>,
	stop: () => Promise<void>,
	signal?: AbortSignal,
) {
	if (signal?.aborted) throw new Error("BUILD_CANCELLED");
	await create();
	if (signal?.aborted) {
		await stop();
		throw new Error("BUILD_CANCELLED");
	}
}

export function finishArchive(
	stream: Writable,
	signal?: AbortSignal,
	timeoutMs = 60_000,
) {
	return new Promise<void>((resolve, reject) => {
		const finish = () => {
			cleanup();
			resolve();
		};
		const fail = () => {
			cleanup();
			reject(new Error("BUILD_OUTPUT_FAILED"));
		};
		const cancel = () => {
			cleanup();
			stream.destroy();
			reject(new Error("BUILD_CANCELLED"));
		};
		const cleanup = () => {
			clearTimeout(timer);
			stream.off("finish", finish);
			stream.off("error", fail);
			stream.off("close", fail);
			signal?.removeEventListener("abort", cancel);
		};
		const timer = setTimeout(() => {
			cleanup();
			stream.destroy();
			reject(new Error("BUILD_RUNTIME_UNKNOWN"));
		}, timeoutMs);
		stream.once("finish", finish);
		stream.once("error", fail);
		stream.once("close", fail);
		signal?.addEventListener("abort", cancel, { once: true });
		if (signal?.aborted) cancel();
		else if (stream.writableFinished) finish();
		else if (stream.destroyed) fail();
	});
}
