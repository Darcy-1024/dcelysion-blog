import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { isConfiguration } from "../shared/configuration.js";
import type { Draft } from "../shared/contracts.js";
import { patchField } from "../shared/editor.js";
import { type BuildDriver, buildJobId } from "./build.js";
import { contentPath } from "./candidate.js";
import { DraftError } from "./drafts.js";
import { command, tree, writeControlled } from "./executor.js";

export function builderEndpoint(value: string) {
	const url = new URL(value);
	if (
		url.protocol !== "http:" ||
		url.hostname !== "127.0.0.1" ||
		!url.port ||
		url.pathname !== "/" ||
		url.search ||
		url.hash ||
		url.username ||
		url.password
	)
		throw new Error("Builder requires a fixed loopback HTTP endpoint");
	return url;
}
export function byteLimit(maximum: number) {
	let bytes = 0;
	return new Transform({
		transform(chunk: Buffer, _encoding, done) {
			bytes += chunk.length;
			done(bytes > maximum ? new Error("BUILD_LIMIT") : null, chunk);
		},
	});
}
export class RemoteBuild implements BuildDriver {
	readonly mode = "docker-astro" as const;
	private endpoint: URL;
	constructor(
		endpoint: string,
		private token: string,
		private image: string,
	) {
		this.endpoint = builderEndpoint(endpoint);
		if (!/^[A-Za-z0-9_-]{43,128}$/u.test(token))
			throw new Error(
				"Builder token must be independently generated with at least 256 bits",
			);
		if (!/^(?:[-a-zA-Z0-9._/:]+@)?sha256:[a-f0-9]{64}$/u.test(image))
			throw new Error("Build image requires an immutable digest");
	}
	private async call(
		method: string,
		path: string,
		input?: string,
		output?: string,
	) {
		await new Promise<void>((accept, reject) => {
			const req = request(new URL(path, this.endpoint), {
				method,
				headers: {
					Authorization: `Bearer ${this.token}`,
					"X-Build-Image": this.image,
					...(input ? { "Content-Type": "application/x-tar" } : {}),
				},
			});
			const timer = setTimeout(
				() => req.destroy(new Error("BUILD_TIMEOUT")),
				input ? 11 * 60_000 : 15_000,
			);
			req.once("error", reject);
			req.once("close", () => clearTimeout(timer));
			req.once("response", (response) => {
				if (
					response.statusCode !== 200 ||
					response.headers["x-build-image"] !== this.image
				) {
					response.destroy();
					reject(new Error("BUILD_REMOTE"));
					return;
				}
				const finish = output
					? pipeline(
							response,
							byteLimit(512 * 1024 * 1024),
							createWriteStream(output, { mode: 0o600 }),
						)
					: pipeline(
							response,
							byteLimit(4096),
							new Transform({
								transform(_chunk, _encoding, done) {
									done();
								},
							}),
						);
				void finish.then(accept, reject);
			});
			if (input)
				void pipeline(
					createReadStream(input),
					byteLimit(544 * 1024 * 1024),
					req,
				).catch(reject);
			else req.end();
		});
	}
	async available() {
		try {
			await command("python3", [
				"-c",
				"import sys; assert sys.version_info >= (3,12)",
			]);
			await command("tar", ["--version"]);
			await this.call("GET", "/health");
			return true;
		} catch {
			return false;
		}
	}
	async stop(jobId: string) {
		try {
			await this.call("DELETE", `/jobs/${buildJobId(jobId)}`);
		} catch {
			throw new DraftError(503, "BUILD_UNAVAILABLE");
		}
	}
	async build(
		directory: string,
		jobId: string,
		draft: Draft,
		preview: boolean,
	) {
		buildJobId(jobId);
		const input = join(directory, "input");
		const output = join(directory, "artifact");
		const source = join(directory, "container-input.tar");
		const artifact = join(directory, "container-output.tar.gz");
		if (preview && !isConfiguration(draft.kind))
			await writeControlled(
				input,
				contentPath(draft),
				patchField(draft.source, draft.kind, "draft", false),
			);
		await tree(input);
		await command("tar", ["-cf", source, "-C", input, "."]);
		try {
			await this.call("POST", `/jobs/${jobId}`, source, artifact);
		} catch {
			await this.stop(jobId).catch(() => {});
			throw new DraftError(422, "BUILD_FAILED");
		}
		await mkdir(output, { recursive: true });
		await command("python3", [
			fileURLToPath(new URL("../build/extract-artifact.py", import.meta.url)),
			artifact,
			output,
		]);
		return output;
	}
}
