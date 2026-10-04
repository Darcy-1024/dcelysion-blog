import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	readFile,
	rename,
	rmdir,
	unlink,
	writeFile,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import type {
	Media,
	MediaDependency,
	MediaDestination,
	MediaPlan,
	MediaPurpose,
	MediaVariant,
} from "../shared/media.js";
import {
	mediaPositions,
	mediaPurposes,
	mediaSourceWithoutCode,
} from "../shared/media.js";
import { DraftError, hash, type Queryable, uuid } from "./drafts.js";
import { safeFile } from "./executor.js";
import {
	publicDistribution,
	verifyTencentDelivery,
} from "./media-distribution.js";
import {
	atomicCopy,
	digest,
	type ObjectStore,
	privateDirectory,
	verifyFile,
} from "./media-storage.js";
import { inspectUpload, mediaLimits } from "./media-validation.js";
import { inside } from "./paths.js";
export type MediaConfiguration = {
	destinations?: Partial<Record<MediaPurpose, MediaDestination>>;
	tencentBase?: string;
	capacityUrl?: string;
	probeId?: string;
	privateRoot: string;
	publicRoot: string;
	repository: string;
	publicBase: string;
};
const objectIdentity = (object: MediaVariant) =>
	JSON.stringify([
		object.key,
		object.sha256,
		object.size,
		object.mime,
		object.ext,
	]);
const destinationIdentity = (destination?: MediaDestination) =>
	JSON.stringify(
		destination
			? [
					destination.purpose,
					destination.version,
					destination.bucket,
					destination.prefix,
					destination.publicBase,
					destination.tencentRoot,
					destination.tencentBase,
				]
			: null,
	);
export class MediaService {
	private db: Queryable;
	private pool?: pg.Pool;
	private worker: Promise<void> | null = null;
	private lease: Promise<void> | null = null;
	private uploadBusy = false;
	private mutations: Promise<unknown> = Promise.resolve();
	readonly fingerprint: string;
	constructor(
		readonly config: MediaConfiguration,
		private store: ObjectStore | null,
		databaseUrl: string,
		adapter?: Queryable,
	) {
		const roots = [
			config.privateRoot,
			config.publicRoot,
			config.repository,
		].map((s) => resolve(s));
		if (
			inside(roots[0], roots[1]) ||
			inside(roots[1], roots[0]) ||
			inside(roots[2], roots[0]) ||
			inside(roots[2], roots[1])
		)
			throw new Error(
				"Media roots must be separate and outside the repository",
			);
		const base = new URL(config.publicBase);
		if (
			base.protocol !== "https:" ||
			base.username ||
			base.password ||
			base.search ||
			base.hash
		)
			throw new Error("Media public base requires HTTPS");
		for (const [purpose, destination] of Object.entries(
			config.destinations || {},
		)) {
			if (
				!mediaPurposes.includes(purpose as MediaPurpose) ||
				destination.purpose !== purpose ||
				destination.version !== 1 ||
				!/^[a-z0-9][a-z0-9-]{2,62}$/u.test(destination.bucket)
			)
				throw new Error("Invalid media destination");
			for (const value of [destination.publicBase, destination.tencentBase]) {
				if (!value) continue;
				const parsed = new URL(value);
				if (
					parsed.protocol !== "https:" ||
					parsed.username ||
					parsed.password ||
					parsed.search ||
					parsed.hash
				)
					throw new Error("Media destination requires HTTPS");
			}
			const root = resolve(destination.tencentRoot);
			if (
				!inside(roots[1], root) ||
				inside(roots[0], root) ||
				inside(root, roots[0]) ||
				inside(roots[2], root)
			)
				throw new Error(
					"Media destination root must be inside publicRoot and outside private data/repository",
				);
		}
		this.fingerprint = hash(
			JSON.stringify([
				roots[0],
				roots[1],
				config.publicBase,
				config.tencentBase,
				config.capacityUrl,
				config.probeId,
				store?.identity || "unconfigured",
				config.destinations,
			]),
		);
		if (adapter) this.db = adapter;
		else {
			this.pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
			this.db = this.pool;
		}
	}
	info() {
		return {
			configured: true,
			syncConfigured: Boolean(this.store),
			fingerprint: this.fingerprint,
			limits: mediaLimits,
			concurrency: 1,
			purposes: mediaPurposes.filter((purpose) =>
				Boolean(this.config.destinations?.[purpose]),
			),
		};
	}
	private async start() {
		if (!this.lease) this.lease = this.acquire();
		return this.lease;
	}
	private async acquire() {
		await privateDirectory(this.config.privateRoot);
		await privateDirectory(this.config.publicRoot);
		const lock = join(this.config.privateRoot, "media.lock");
		try {
			await mkdir(lock);
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
			let previous: { host: string; pid: number };
			try {
				previous = JSON.parse(
					await readFile(await safeFile(lock, "owner.json"), "utf8"),
				);
			} catch {
				throw new DraftError(409, "MEDIA_BUSY");
			}
			if (
				previous.host !== hostname() ||
				!Number.isSafeInteger(previous.pid) ||
				previous.pid < 1
			)
				throw new DraftError(409, "MEDIA_BUSY");
			try {
				process.kill(previous.pid, 0);
				throw new DraftError(409, "MEDIA_BUSY");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			}
			await unlink(join(lock, "owner.json"));
			await rmdir(lock);
			await mkdir(lock);
		}
		await writeFile(
			join(lock, "owner.json"),
			JSON.stringify({ host: hostname(), pid: process.pid }),
			{ mode: 0o600 },
		);
		await privateDirectory(join(this.config.privateRoot, "temporary"));
		await privateDirectory(join(this.config.privateRoot, "originals"));
		const rows = (
			await this.db.query(
				"SELECT id,owner_id,document FROM dc_admin.media WHERE document->>'local'='uploading' OR document->>'privateCopy'='running'",
			)
		).rows;
		for (const row of rows) {
			const media = row.document as Media;
			if (media.local === "uploading") {
				try {
					const final = await this.recoverUpload(media);
					if (final.local !== "ready") throw new Error("manifest");
				} catch {
					await this.patch(media.id, {
						local: "failed",
						privateCopy: "failed",
						stage: "interrupted",
						error: "UPLOAD_INTERRUPTED",
					});
				}
			} else
				await this.patch(media.id, { privateCopy: "queued", stage: "queued" });
		}
	}
	private serial<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.mutations.catch(() => {}).then(operation);
		this.mutations = result;
		return result;
	}
	private objects(media: Media) {
		return [media.original, ...(media.preview ? [media.preview] : [])];
	}
	private async patch(id: string, change: Partial<Media>) {
		await this.db.query(
			"UPDATE dc_admin.media SET document=document || $1::jsonb,updated_at=now() WHERE id=$2",
			[JSON.stringify(change), id],
		);
	}
	private async recoverUpload(media: Media) {
		if (media.local === "ready") return media;
		let manifest: Media;
		try {
			manifest = JSON.parse(
				await readFile(
					await safeFile(
						join(this.config.privateRoot, "originals"),
						`${media.id}/manifest.json`,
					),
					"utf8",
				),
			);
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "ENOENT") return media;
			throw cause;
		}
		if (manifest.id !== media.id || manifest.name !== media.name)
			throw new DraftError(422, "MEDIA_INTEGRITY");
		for (const object of this.objects(manifest))
			await verifyFile(await this.localFile(object), object);
		manifest.deleted = media.deleted;
		manifest.publicCopy = media.publicCopy;
		manifest.publicKeys = media.publicKeys;
		await this.db.query(
			"UPDATE dc_admin.media SET document=$1::jsonb,upload_hash=$2,updated_at=now() WHERE id=$3",
			[JSON.stringify(manifest), manifest.original.sha256, media.id],
		);
		return manifest;
	}
	async get(owner: number, id: string): Promise<Media> {
		const row = (
			await this.db.query(
				"SELECT document FROM dc_admin.media WHERE id=$1 AND owner_id=$2",
				[uuid(id), owner],
			)
		).rows[0];
		if (!row) throw new DraftError(404, "MEDIA_NOT_FOUND");
		return row.document as Media;
	}
	async list(
		owner: number,
		trash: boolean,
		kind: string,
		page = 1,
		purpose = "all",
	) {
		if (
			!["all", "image", "audio", "video", "text"].includes(kind) ||
			!Number.isSafeInteger(page) ||
			page < 1 ||
			(purpose !== "all" && !mediaPurposes.includes(purpose as MediaPurpose))
		)
			throw new DraftError(400, "INPUT");
		const rows = await this.db.query(
			"SELECT document FROM dc_admin.media WHERE owner_id=$1 AND (document->>'deleted')::boolean=$2 AND ($3='all' OR document->>'kind'=$3) AND ($5='all' OR document->>'purpose'=$5 OR NOT(document ? 'purpose')) ORDER BY updated_at DESC,id LIMIT 30 OFFSET $4",
			[owner, trash, kind, (page - 1) * 30, purpose],
		);
		return {
			items: rows.rows.map((r) => r.document as Media),
			page,
			info: this.info(),
		};
	}
	async references(owner: number, id: string) {
		await this.get(owner, id);
		const refs = (
			await this.db.query(
				"SELECT kind,ref_id FROM dc_admin.media_refs WHERE media_id=$1 ORDER BY kind,ref_id LIMIT 100",
				[id],
			)
		).rows;
		return {
			refs,
			physicalCleanupAllowed: false,
			reason: "HISTORY_INDEX_INCOMPLETE",
		};
	}
	async deleted(owner: number, id: string, deleted: boolean) {
		const media = await this.get(owner, id);
		if (!deleted && media.local === "ready") {
			try {
				const manifest = JSON.parse(
					await readFile(
						await safeFile(
							join(this.config.privateRoot, "originals"),
							`${media.id}/manifest.json`,
						),
						"utf8",
					),
				) as Media;
				if (
					JSON.stringify(this.objects(media).map(objectIdentity)) !==
					JSON.stringify(this.objects(manifest).map(objectIdentity))
				)
					throw new DraftError(422, "MEDIA_INTEGRITY");
				for (const object of this.objects(media))
					await verifyFile(await this.localFile(object), object);
			} catch {
				throw new DraftError(422, "MEDIA_INTEGRITY");
			}
		}
		await this.patch(id, { deleted });
		return this.get(owner, id);
	}
	async retry(owner: number, id: string) {
		const media = await this.get(owner, id);
		if (media.local !== "ready" || media.privateCopy !== "failed")
			throw new DraftError(409, "MEDIA_STATE");
		await this.patch(id, {
			privateCopy: "queued",
			error: null,
			stage: "queued",
		});
		this.kick();
		return this.get(owner, id);
	}
	async upload(
		owner: number,
		id: string,
		name: string,
		size: number,
		stream: AsyncIterable<Uint8Array>,
		purpose?: unknown,
	) {
		uuid(id);
		if (
			!name ||
			name.length > 180 ||
			[...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
			!Number.isSafeInteger(size) ||
			size < 1 ||
			size > mediaLimits.video
		)
			throw new DraftError(422, "MEDIA_SIZE");
		if (this.uploadBusy) throw new DraftError(429, "MEDIA_BUSY");
		this.uploadBusy = true;
		await this.start().catch((cause) => {
			this.uploadBusy = false;
			throw cause;
		});
		const folder = join(this.config.privateRoot, "temporary", randomUUID());
		let created = false;
		try {
			let existing: Media | null = null;
			try {
				existing = await this.recoverUpload(await this.get(owner, id));
			} catch (cause) {
				if (!(cause instanceof DraftError) || cause.status !== 404) throw cause;
			}
			if (
				existing &&
				(existing.name !== name ||
					(purpose !== undefined && existing.purpose !== purpose))
			)
				throw new DraftError(409, "REQUEST_REUSE");
			if (!existing && !mediaPurposes.includes(purpose as MediaPurpose))
				throw new DraftError(422, "MEDIA_PURPOSE");
			const selectedDestination =
				existing?.destination ||
				(existing
					? undefined
					: this.config.destinations?.[purpose as MediaPurpose]);
			const destination = selectedDestination
				? structuredClone(selectedDestination)
				: undefined;
			if (!existing && !destination)
				throw new DraftError(422, "MEDIA_PURPOSE_NOT_CONFIGURED");
			if (!existing) {
				const pending: Media = {
					purpose: purpose as MediaPurpose,
					version: 1,
					destination: structuredClone(destination),
					id,
					name,
					kind: "text",
					original: { key: "", sha256: "", size, mime: "", ext: "" },
					local: "uploading",
					privateCopy: "queued",
					publicCopy: "absent",
					stage: "uploading",
					error: null,
					attempt: 0,
					deleted: false,
					createdAt: new Date().toISOString(),
				};
				await this.db.query(
					"INSERT INTO dc_admin.media(id,owner_id,document) VALUES($1,$2,$3::jsonb)",
					[id, owner, JSON.stringify(pending)],
				);
				created = true;
			} else if (existing.local !== "ready") {
				await this.patch(id, {
					local: "uploading",
					stage: "uploading",
					error: null,
				});
				created = true;
			}
			await privateDirectory(folder);
			const temporary = join(folder, "upload.partial");
			const output = await open(temporary, "wx", 0o600);
			const checksum = createHash("sha256");
			let received = 0;
			try {
				for await (const chunk of stream) {
					received += chunk.length;
					if (received > size) throw new DraftError(422, "MEDIA_SIZE");
					checksum.update(chunk);
					await output.writeFile(chunk);
				}
				if (received !== size) throw new DraftError(422, "MEDIA_SIZE");
				await output.sync();
			} finally {
				await output.close();
			}
			const sha256 = checksum.digest("hex");
			if (existing?.local === "ready") {
				if (
					existing.original.sha256 !== sha256 ||
					existing.original.size !== size
				)
					throw new DraftError(409, "REQUEST_REUSE");
				return existing;
			}
			// A failed upload with known immutable bytes can never be reused for replacement bytes.
			const receipt = (
				await this.db.query(
					"SELECT upload_hash FROM dc_admin.media WHERE id=$1",
					[id],
				)
			).rows[0];
			if (receipt.upload_hash && receipt.upload_hash !== sha256)
				throw new DraftError(409, "REQUEST_REUSE");
			await this.patch(id, { stage: "validating" });
			let metadata: Awaited<ReturnType<typeof inspectUpload>>;
			try {
				metadata = await inspectUpload(
					temporary,
					name,
					size,
					join(folder, "preview.partial"),
				);
			} catch (cause) {
				if (cause instanceof DraftError) throw cause;
				throw new DraftError(422, "MEDIA_TYPE");
			}
			if (
				(purpose === "gallery" || purpose === "wallpaper") &&
				metadata.kind !== "image"
			)
				throw new DraftError(422, "MEDIA_PURPOSE_TYPE");
			if (purpose === "music" && metadata.kind === "video")
				throw new DraftError(422, "MEDIA_PURPOSE_TYPE");
			const original: MediaVariant = {
				key: `${id}/original-${sha256}.${metadata.ext}`,
				sha256,
				size,
				mime: metadata.mime,
				ext: metadata.ext,
			};
			await rename(temporary, join(folder, original.key.split("/")[1]));
			let preview: MediaVariant | undefined;
			if (metadata.previewPath) {
				const checked = await digest(
					createReadStream(metadata.previewPath),
					mediaLimits.image,
				);
				preview = {
					...checked,
					key: `${id}/preview-${checked.sha256}.webp`,
					mime: "image/webp",
					ext: "webp",
				};
				await rename(
					metadata.previewPath,
					join(folder, preview.key.split("/")[1]),
				);
			}
			const media: Media = {
				...(existing
					? {
							purpose: existing.purpose,
							version: existing.version,
							destination: existing.destination,
						}
					: {
							purpose: purpose as MediaPurpose,
							version: 1,
							destination: structuredClone(destination),
						}),
				id,
				name,
				kind: metadata.kind,
				original,
				...(preview ? { preview } : {}),
				...(metadata.width
					? { width: metadata.width, height: metadata.height }
					: {}),
				local: "ready",
				privateCopy: "queued",
				publicCopy: "absent",
				stage: "queued",
				error: null,
				attempt: 0,
				deleted: existing?.deleted || false,
				createdAt: existing?.createdAt || new Date().toISOString(),
			};
			await writeFile(join(folder, "manifest.json"), JSON.stringify(media), {
				mode: 0o600,
			});
			await rename(folder, join(this.config.privateRoot, "originals", id));
			await this.db.query(
				"UPDATE dc_admin.media SET document=$1::jsonb,upload_hash=$2,updated_at=now() WHERE id=$3",
				[JSON.stringify(media), sha256, id],
			);
			this.kick();
			return media;
		} catch (cause) {
			if (created)
				await this.patch(id, {
					local: "failed",
					privateCopy: "failed",
					stage: "upload_failed",
					error: cause instanceof DraftError ? cause.code : "UPLOAD_FAILED",
				});
			throw cause;
		} finally {
			// Only this freshly generated temporary folder is cleaned; no original/public object is deleted.
			const { rm } = await import("node:fs/promises");
			if (
				inside(resolve(this.config.privateRoot, "temporary"), resolve(folder))
			)
				await rm(folder, { recursive: true, force: true });
			this.uploadBusy = false;
		}
	}
	private localFile(object: MediaVariant) {
		return safeFile(join(this.config.privateRoot, "originals"), object.key);
	}
	kick() {
		if (!this.worker)
			this.worker = this.serial(() => this.drain())
				.catch(() => {})
				.finally(() => {
					this.worker = null;
				});
	}
	async idle() {
		await this.worker;
	}
	private async drain() {
		await this.start();
		for (;;) {
			const row = (
				await this.db.query(
					"SELECT id,owner_id,document FROM dc_admin.media WHERE document->>'local'='ready' AND document->>'privateCopy'='queued' ORDER BY updated_at LIMIT 1",
				)
			).rows[0];
			if (!row) break;
			const media = row.document as Media;
			await this.patch(media.id, {
				privateCopy: "running",
				stage: "sync_private",
				attempt: media.attempt + 1,
			});
			try {
				if (!this.store) throw new DraftError(503, "R2_NOT_CONFIGURED");
				for (const object of this.objects(media)) {
					const file = await this.localFile(object);
					await verifyFile(file, object);
					await this.store.put("private", object, file);
					await this.store.verify("private", object);
				}
				await this.patch(media.id, {
					privateCopy: "ready",
					stage: "private_verified",
					error: null,
				});
			} catch (cause) {
				await this.patch(media.id, {
					privateCopy: "failed",
					stage: "sync_failed",
					error: cause instanceof DraftError ? cause.code : "R2_SYNC_FAILED",
				});
			}
		}
	}
	async validateSource(owner: number, source: string) {
		for (const reference of mediaPositions(source))
			if (reference.url.startsWith("/__managed-media/")) {
				const match =
					/^\/__managed-media\/([a-f0-9-]{36})\/(original|preview)$/u.exec(
						reference.url,
					);
				if (!match) throw new DraftError(422, "MEDIA_REFERENCE");
				const media = await this.get(owner, match[1]);
				if (
					media.local !== "ready" ||
					(match[2] === "preview" && !media.preview)
				)
					throw new DraftError(422, "MEDIA_NOT_READY");
			}
	}
	async plan(
		owner: number,
		source: string,
		preview = false,
	): Promise<MediaPlan> {
		await this.validateSource(owner, source);
		const dependencies: MediaDependency[] = [];
		let resolved = source;
		const known = (
			await this.db.query(
				"SELECT document FROM dc_admin.media WHERE owner_id=$1 AND document->>'local'='ready' AND (position(document->'original'->>'key' IN $2)>0 OR (document ? 'preview' AND position(document->'preview'->>'key' IN $2)>0))",
				[owner, source],
			)
		).rows.map((row) => row.document as Media);
		for (const reference of mediaPositions(source).reverse()) {
			const match =
				/^\/__managed-media\/([a-f0-9-]{36})\/(original|preview)$/u.exec(
					reference.url,
				);
			const existing = known
				.flatMap((media) =>
					this.objects(media).map((object) => ({ media, object })),
				)
				.find(
					({ media, object }) =>
						reference.url ===
						`${(media.destination?.publicBase || this.config.publicBase).replace(/\/$/u, "")}/${object.key}`,
				);
			if (!match && !existing) continue;
			const media = match ? await this.get(owner, match[1]) : existing?.media;
			if (!media) continue;
			const variant = match
				? (match[2] as "original" | "preview")
				: existing?.object.key === media.original.key
					? "original"
					: "preview";
			const object = media[variant] as MediaVariant;
			const url = `${(media.destination?.publicBase || this.config.publicBase).replace(/\/$/u, "")}/${object.key}`;
			dependencies.push({
				id: media.id,
				variant,
				object,
				url,
				...(media.destination
					? {
							destination: structuredClone(media.destination),
							version: media.version,
						}
					: {}),
			});
			const replacement = preview ? `/__admin_media/${object.key}` : url;
			resolved =
				resolved.slice(0, reference.start) +
				replacement +
				resolved.slice(reference.end);
		}
		if (mediaSourceWithoutCode(resolved).includes("/__managed-media/"))
			throw new DraftError(422, "MEDIA_REFERENCE");
		return { source: resolved, dependencies, fingerprint: this.fingerprint };
	}
	async ensure(
		owner: number,
		plan: MediaPlan,
		publish: boolean,
		previewRoot?: string,
	) {
		return this.serial(async () => {
			await this.start();
			if (
				plan.dependencies.some((dependency) => !dependency.destination) &&
				plan.fingerprint !== this.fingerprint
			)
				throw new DraftError(409, "MEDIA_CONFIG_CHANGED");
			for (const dependency of plan.dependencies) {
				const media = await this.get(owner, dependency.id);
				const object = media[dependency.variant];
				const destination = dependency.destination;
				if (
					destinationIdentity(destination) !==
						destinationIdentity(media.destination) ||
					(destination && dependency.version !== media.version)
				)
					throw new DraftError(422, "MEDIA_INTEGRITY");
				const publicRoot = destination?.tencentRoot || this.config.publicRoot;
				const publicBase = destination?.publicBase || this.config.publicBase;
				const tencentBase = destination
					? destination.tencentBase
					: this.config.tencentBase;
				if (
					!object ||
					objectIdentity(object) !== objectIdentity(dependency.object) ||
					media.local !== "ready"
				)
					throw new DraftError(422, "MEDIA_INTEGRITY");
				const file = await this.localFile(object);
				await verifyFile(file, object);
				if (!publish) {
					if (previewRoot) {
						await privateDirectory(previewRoot);
						await atomicCopy(
							previewRoot,
							`__admin_media/${object.key}`,
							file,
							object,
						);
					}
					continue;
				}
				if (!this.store || media.privateCopy !== "ready")
					throw new DraftError(422, "MEDIA_NOT_READY");
				try {
					await this.store.verify("private", object);
				} catch (cause) {
					await this.patch(media.id, {
						privateCopy: "failed",
						stage: "integrity_failed",
						error: "MEDIA_INTEGRITY",
					});
					throw cause;
				}
				await this.patch(media.id, { publicCopy: "partial" });
				await privateDirectory(publicRoot);
				await atomicCopy(publicRoot, object.key, file, object);
				await this.store.put("public", object, file, destination);
				await this.store.verify("public", object, destination);
				await this.store.verifyPublicDelivery(object, destination);
				await verifyFile(await safeFile(publicRoot, object.key), object);
				const beforeTencent = await this.get(owner, media.id);
				await this.patch(media.id, {
					publicKeys: [
						...new Set([...(beforeTencent.publicKeys || []), object.key]),
					],
				});
				if (tencentBase) {
					const rows = await this.db.query(
						"SELECT document FROM dc_admin.media WHERE owner_id=$1 AND document ? 'publicKeys'",
						[owner],
					);
					const index = publicDistribution(
						rows.rows.map((r) => r.document as Media),
						"edge-public",
						publicBase,
						tencentBase,
						undefined,
						undefined,
						false,
						this.config.publicRoot,
					);
					const temporaryIndex = join(
						this.config.publicRoot,
						".distribution.json.partial",
					);
					await writeFile(temporaryIndex, JSON.stringify(index), {
						mode: 0o600,
					});
					await rename(
						temporaryIndex,
						join(this.config.publicRoot, ".distribution.json"),
					);
					await verifyTencentDelivery(publicBase, object);
					await verifyTencentDelivery(tencentBase, object);
					const verified = await this.get(owner, media.id);
					await this.patch(media.id, {
						tencentKeys: [
							...new Set([...(verified.tencentKeys || []), object.key]),
						],
						deliveryReceipts: {
							...verified.deliveryReceipts,
							[object.key]: {
								sha256: object.sha256,
								size: object.size,
								mime: object.mime,
							},
						},
					});
				}
				const current = await this.get(owner, media.id);
				const publicKeys = [
					...new Set([...(current.publicKeys || []), object.key]),
				];
				await this.patch(media.id, {
					publicKeys,
					publicCopy: this.objects(media).every((o) =>
						publicKeys.includes(o.key),
					)
						? "ready"
						: "partial",
				});
			}
		});
	}
	async distribution(owner: number, snapshot: string) {
		const rows = await this.db.query(
			"SELECT document FROM dc_admin.media WHERE owner_id=$1 AND document ? 'publicKeys'",
			[owner],
		);
		return publicDistribution(
			rows.rows.map((r) => r.document as Media),
			snapshot,
			this.config.publicBase,
			this.config.tencentBase,
			this.config.capacityUrl,
			this.config.probeId,
		);
	}
	async serve(
		owner: number,
		id: string,
		variant: string,
		req: IncomingMessage,
		res: ServerResponse,
	) {
		const media = await this.get(owner, id);
		const object =
			variant === "original"
				? media.original
				: variant === "preview"
					? media.preview
					: undefined;
		if (!object || media.local !== "ready")
			throw new DraftError(404, "MEDIA_NOT_FOUND");
		const file = await this.localFile(object);
		if ((await lstat(file)).size !== object.size)
			throw new DraftError(422, "MEDIA_INTEGRITY");
		let start = 0;
		let end = object.size - 1;
		let status = 200;
		if (req.headers.range) {
			const range = /^bytes=(\d+)-(\d*)$/u.exec(req.headers.range);
			if (!range) throw new DraftError(416, "MEDIA_RANGE");
			start = Number(range[1]);
			end = range[2] ? Number(range[2]) : end;
			if (
				!Number.isSafeInteger(start) ||
				!Number.isSafeInteger(end) ||
				start > end ||
				end >= object.size
			)
				throw new DraftError(416, "MEDIA_RANGE");
			status = 206;
		}
		res.writeHead(status, {
			"content-type": object.mime,
			"cache-control": "private, no-store",
			"x-content-type-options": "nosniff",
			"accept-ranges": "bytes",
			"content-length": end - start + 1,
			...(status === 206
				? { "content-range": `bytes ${start}-${end}/${object.size}` }
				: {}),
			...(media.kind === "text" ? { "content-disposition": "attachment" } : {}),
		});
		const stream = createReadStream(file, { start, end });
		res.on("close", () => stream.destroy());
		stream.on("error", () => res.destroy());
		stream.pipe(res);
	}
	async close() {
		await this.worker;
		await this.mutations.catch(() => {});
		if (this.lease) {
			await this.lease;
			await unlink(join(this.config.privateRoot, "media.lock/owner.json"));
			await rmdir(join(this.config.privateRoot, "media.lock"));
		}
		await this.pool?.end();
	}
}
