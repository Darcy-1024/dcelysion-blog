import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import type { MediaDestination, MediaVariant } from "../shared/media.js";
import { DraftError } from "./drafts.js";
import { pathName, safeFile } from "./executor.js";
import type { MediaBudget } from "./media-budget.js";
import { inside } from "./paths.js";

export interface ObjectStore {
	readonly identity: string;
	put(
		scope: "private" | "public",
		object: MediaVariant,
		file: string,
		destination?: MediaDestination,
	): Promise<void>;
	verify(
		scope: "private" | "public",
		object: MediaVariant,
		destination?: MediaDestination,
	): Promise<void>;
	verifyPublicDelivery(
		object: MediaVariant,
		destination?: MediaDestination,
	): Promise<void>;
}
export async function digest(
	stream: AsyncIterable<Uint8Array>,
	maximum: number,
) {
	const hash = createHash("sha256");
	let size = 0;
	for await (const bytes of stream) {
		size += bytes.length;
		if (size > maximum) throw new DraftError(422, "MEDIA_SIZE");
		hash.update(bytes);
	}
	return { size, sha256: hash.digest("hex") };
}
export async function verifyFile(file: string, object: MediaVariant) {
	const actual = await digest(createReadStream(file), object.size);
	if (actual.size !== object.size || actual.sha256 !== object.sha256)
		throw new DraftError(422, "MEDIA_INTEGRITY");
}
// Media roots are operator-owned. Reject symlinks in every existing ancestor, including the root.
export async function privateDirectory(directory: string) {
	const full = resolve(directory);
	let part = full;
	for (;;) {
		try {
			if ((await lstat(part)).isSymbolicLink())
				throw new DraftError(400, "PATH");
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
		}
		const parent = dirname(part);
		if (parent === part) break;
		part = parent;
	}
	await mkdir(full, { recursive: true, mode: 0o700 });
	return realpath(full);
}
export async function atomicCopy(
	root: string,
	name: string,
	source: string,
	object: MediaVariant,
) {
	pathName(name);
	const parent = await privateDirectory(join(root, dirname(name)));
	if (!inside(await realpath(root), parent)) throw new DraftError(400, "PATH");
	const destination = join(root, name);
	try {
		await verifyFile(await safeFile(root, name), object);
		return;
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
	}
	const temporary = `${destination}.partial`;
	try {
		if ((await lstat(temporary)).isSymbolicLink())
			throw new DraftError(400, "PATH");
		await unlink(temporary);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
	}
	const handle = await open(temporary, "wx", 0o600);
	try {
		for await (const bytes of createReadStream(source))
			await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await verifyFile(temporary, object);
		// Only the media worker holding its shared directory lease writes these immutable names.
		await rename(temporary, destination);
	} catch (cause) {
		await unlink(temporary).catch(() => {});
		throw cause;
	}
}
export class R2Store implements ObjectStore {
	readonly identity: string;
	private client: S3Client;
	constructor(
		private config: {
			endpoint: string;
			privateBucket: string;
			publicBucket: string;
			prefix: string;
			accessKeyId: string;
			secretAccessKey: string;
			bytesPerSecond: number;
			publicBase: string;
			destinations?: MediaDestination[];
			budget?: MediaBudget;
		},
	) {
		const url = new URL(config.endpoint);
		if (
			url.protocol !== "https:" ||
			!/^[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/u.test(
				url.hostname,
			) ||
			url.pathname !== "/" ||
			url.search ||
			url.username ||
			url.password ||
			url.port
		)
			throw new Error("Invalid R2 endpoint");
		if (
			config.privateBucket === config.publicBucket ||
			![config.privateBucket, config.publicBucket].every((s) =>
				/^[a-z0-9][a-z0-9-]{2,62}$/u.test(s),
			)
		)
			throw new Error("Separate private and public R2 buckets required");
		pathName(config.prefix);
		this.identity = JSON.stringify([
			config.endpoint,
			config.privateBucket,
			config.publicBucket,
			config.prefix,
		]);
		this.client = new S3Client({
			forcePathStyle: true,
			region: "auto",
			endpoint: config.endpoint,
			credentials: {
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey,
			},
			maxAttempts: 1,
			requestChecksumCalculation: "WHEN_REQUIRED",
			responseChecksumValidation: "WHEN_REQUIRED",
		});
	}
	private location(
		scope: "private" | "public",
		object: MediaVariant,
		destination?: MediaDestination,
	) {
		if (
			destination &&
			(destination.bucket === this.config.privateBucket ||
				!/^[a-z0-9][a-z0-9-]{2,62}$/u.test(destination.bucket))
		)
			throw new DraftError(422, "MEDIA_DESTINATION");
		if (destination) pathName(destination.prefix);
		pathName(object.key);
		if (
			!/^[a-f0-9-]{36}\/(?:original|preview)-[a-f0-9]{64}\.[a-z0-9]+$/u.test(
				object.key,
			)
		)
			throw new DraftError(400, "PATH");
		return {
			Bucket:
				scope === "private"
					? this.config.privateBucket
					: destination?.bucket || this.config.publicBucket,
			Key: `${scope === "public" && destination ? destination.prefix : this.config.prefix}/${object.key}`,
		};
	}
	private timeout(object: MediaVariant) {
		return AbortSignal.timeout(
			30_000 + Math.ceil(object.size / this.config.bytesPerSecond) * 1500,
		);
	}
	async put(
		scope: "private" | "public",
		object: MediaVariant,
		file: string,
		destination?: MediaDestination,
	) {
		const location = this.location(scope, object, destination);
		try {
			await this.client.send(new HeadObjectCommand(location), {
				abortSignal: this.timeout(object),
			});
			await this.verify(scope, object, destination);
			return;
		} catch (cause) {
			if (
				(cause as { $metadata?: { httpStatusCode?: number } }).$metadata
					?.httpStatusCode !== 404
			)
				throw cause;
		}
		await this.config.budget?.reserve(object.size);
		const rate = this.config.bytesPerSecond;
		async function* limited() {
			const start = Date.now();
			let total = 0;
			for await (const bytes of createReadStream(file, {
				highWaterMark: 64 * 1024,
			})) {
				total += bytes.length;
				const wait = (total * 1000) / rate - (Date.now() - start);
				if (wait > 0) await delay(wait);
				yield bytes;
			}
		}
		const body = Readable.from(limited(), { objectMode: false });
		try {
			await this.client.send(
				new PutObjectCommand({
					...location,
					Body: body,
					ContentLength: object.size,
					ContentType: object.mime,
					IfNoneMatch: "*",
					Metadata: { sha256: object.sha256 },
					CacheControl:
						scope === "public"
							? "public, max-age=31536000, immutable"
							: "private, no-store",
				}),
				{ abortSignal: this.timeout(object) },
			);
		} catch (cause) {
			if (
				(cause as { $metadata?: { httpStatusCode?: number } }).$metadata
					?.httpStatusCode !== 412
			)
				throw cause;
		} finally {
			body.destroy();
		}
		await this.verify(scope, object, destination);
	}
	async verify(
		scope: "private" | "public",
		object: MediaVariant,
		destination?: MediaDestination,
	) {
		const result = await this.client.send(
			new GetObjectCommand(this.location(scope, object, destination)),
			{ abortSignal: this.timeout(object) },
		);
		const body = result.Body as Readable | undefined;
		try {
			if (
				!body ||
				result.ContentLength !== object.size ||
				result.ContentType !== object.mime
			)
				throw new DraftError(422, "MEDIA_INTEGRITY");
			const actual = await digest(body, object.size);
			if (actual.size !== object.size || actual.sha256 !== object.sha256)
				throw new DraftError(422, "MEDIA_INTEGRITY");
		} finally {
			body?.destroy();
		}
	}
	async verifyPublicDelivery(
		object: MediaVariant,
		destination?: MediaDestination,
	) {
		this.location("public", object, destination);
		const result = await fetch(
			`${(destination?.publicBase || this.config.publicBase).replace(/\/$/u, "")}/${object.key}`,
			{
				redirect: "error",
				headers: { "accept-encoding": "identity" },
				signal: this.timeout(object),
			},
		);
		try {
			if (
				!result.ok ||
				!result.body ||
				Number(result.headers.get("content-length")) !== object.size ||
				result.headers.get("content-type") !== object.mime
			)
				throw new DraftError(422, "MEDIA_DISTRIBUTION");
			const actual = await digest(
				Readable.fromWeb(
					result.body as import("node:stream/web").ReadableStream,
				),
				object.size,
			);
			if (actual.size !== object.size || actual.sha256 !== object.sha256)
				throw new DraftError(422, "MEDIA_DISTRIBUTION");
		} finally {
			await result.body?.cancel().catch(() => {});
		}
	}
}
