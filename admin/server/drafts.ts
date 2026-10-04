import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { glob } from "glob";
import pg from "pg";
import {
	type DraftKind,
	isConfiguration,
	parseConfiguration,
} from "../shared/configuration.js";
import type { Draft, DraftDetail, SourceState } from "../shared/contracts.js";
import { images, inspect } from "../shared/editor.js";
import { contentIdentity, safeIdentity } from "../shared/identity.js";
import {
	configurationMedia,
	configurationPath,
	dependencyState,
	normalizeConfiguration,
} from "./configuration.js";
import type { ContentKind } from "./content.js";
import type { MediaService } from "./media.js";
import { inside } from "./paths.js";

export type Queryable = {
	query(
		sql: string,
		values?: unknown[],
	): Promise<{ rows: Record<string, unknown>[] }>;
};
export class DraftError extends Error {
	constructor(
		public status: number,
		public code: string,
		public details?: unknown,
	) {
		super(code);
	}
}
export const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
export function uuid(value: unknown): string {
	if (
		typeof value !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
			value,
		)
	)
		throw new DraftError(400, "INPUT");
	return value.toLowerCase();
}
export function contentKind(value: unknown): ContentKind {
	if (value !== "posts" && value !== "dynamic")
		throw new DraftError(400, "INPUT");
	return value;
}
export function draftKind(value: unknown): DraftKind {
	if (typeof value === "string" && isConfiguration(value)) return value;
	return contentKind(value);
}
export function controlledPath(value: unknown, kind: DraftKind): string {
	if (isConfiguration(kind)) {
		if (value !== `${kind}.json`) throw new DraftError(400, "PATH");
		return value;
	}
	if (
		typeof value !== "string" ||
		value.length > 200 ||
		!value ||
		/[\uD800-\uDFFF]/u.test(value) ||
		[...value].some((char) => char.charCodeAt(0) < 32) ||
		/[\\<>:"|?*%#]/u.test(value)
	)
		throw new DraftError(400, "PATH");
	const parts = value.split("/");
	if (
		parts.some(
			(part) =>
				!part ||
				part === "." ||
				part === ".." ||
				/[. ]$/u.test(part) ||
				/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part),
		) ||
		!(kind === "posts" ? /\.(md|mdx)$/u : /\.md$/u).test(value)
	)
		throw new DraftError(400, "PATH");
	return value;
}

function raw(value: unknown): string {
	if (
		typeof value !== "string" ||
		value.includes("\0") ||
		/[\uD800-\uDFFF]/u.test(value) ||
		Buffer.byteLength(value) > 524288
	)
		throw new DraftError(400, "INPUT");
	return value;
}
function fromRow(row: Record<string, unknown>): Draft {
	const nullable = (key: string) =>
		row[key] == null ? null : String(row[key]);
	return {
		id: String(row.id),
		kind: draftKind(row.kind),
		baseDependencies: (row.base_dependencies || {}) as Record<string, string>,
		path: String(row.path),
		contentId: String(row.content_id),
		sourceId: nullable("source_id"),
		baseCommit: nullable("base_commit"),
		baseBlob: nullable("base_blob"),
		baseHash: nullable("base_hash"),
		baseSource: nullable("base_source"),
		source: String(row.source),
		revision: Number(row.revision),
		copiedFrom: nullable("copied_from"),
		snapshot: Boolean(row.snapshot),
		createdAt: new Date(String(row.created_at)).toISOString(),
		updatedAt: new Date(String(row.updated_at)).toISOString(),
	};
}
export class DraftService {
	managedMedia: MediaService | null = null;
	private db: Queryable;
	private pool?: pg.Pool;
	constructor(
		private root: string,
		databaseUrl: string,
		adapter?: Queryable,
	) {
		if (adapter) this.db = adapter;
		else {
			this.pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
			this.db = this.pool;
		}
	}
	async close() {
		await this.pool?.end();
	}
	async folder(kind: DraftKind) {
		const root = await realpath(this.root);
		const folder = await realpath(
			isConfiguration(kind)
				? resolve(root, "src/config/manifests")
				: resolve(root, "src", "content", kind),
		);
		if (!inside(root, folder)) throw new DraftError(400, "PATH");
		return folder;
	}
	async readSource(kind: DraftKind, path: string): Promise<string | null> {
		controlledPath(path, kind);
		const folder = await this.folder(kind);
		const file = resolve(folder, path);
		if (!inside(folder, file)) throw new DraftError(400, "PATH");
		try {
			if (
				!(await lstat(file)).isFile() ||
				!inside(folder, await realpath(file))
			)
				throw new DraftError(400, "PATH");
			const bytes = await readFile(file);
			if (bytes.length > 524288) throw new DraftError(400, "INPUT");
			const source = bytes.toString("utf8");
			if (!Buffer.from(source).equals(bytes))
				throw new DraftError(400, "INPUT");
			return source;
		} catch (cause) {
			if (
				cause &&
				typeof cause === "object" &&
				"code" in cause &&
				cause.code === "ENOENT"
			)
				return null;
			throw cause;
		}
	}
	async collision(
		kind: DraftKind,
		path: string,
		contentId = contentIdentity(path, "").id,
	) {
		if (isConfiguration(kind))
			return (await this.readSource(kind, controlledPath(path, kind))) !== null;
		const folder = await this.folder(kind);
		const name = path.replace(/\.(md|mdx)$/u, "").toLowerCase();
		const files = await glob("**/*.{md,mdx}", {
			cwd: folder,
			nodir: true,
			follow: false,
		});
		for (const file of files) {
			const controlled = file.replaceAll("\\", "/");
			if (controlled.replace(/\.(md|mdx)$/iu, "").toLowerCase() === name)
				return true;
			const source = await this.readSource(kind, controlled);
			if (
				source !== null &&
				contentIdentity(controlled, source).id.toLowerCase() ===
					contentId.toLowerCase()
			)
				return true;
		}
		// Missing targets still cannot traverse a symlinked parent.
		const parent = resolve(folder, path, "..");
		let check = parent;
		while (check !== folder) {
			try {
				if (!inside(folder, await realpath(check)))
					throw new DraftError(400, "PATH");
				break;
			} catch (cause) {
				if (
					!(
						cause &&
						typeof cause === "object" &&
						"code" in cause &&
						cause.code === "ENOENT"
					)
				)
					throw cause;
				check = resolve(check, "..");
			}
		}
		return false;
	}
	async sourceState(draft: Draft): Promise<SourceState> {
		if (!draft.sourceId) {
			const changed = await this.collision(
				draft.kind,
				draft.path,
				draft.contentId,
			);
			return { changed, reason: changed ? "collision" : null, current: null };
		}
		const current = await this.readSource(draft.kind, draft.sourceId);
		let changed = current === null || hash(current) !== draft.baseHash;
		if (isConfiguration(draft.kind)) {
			try {
				const currentDependencies = await dependencyState(
					this.root,
					draft.kind,
				);
				changed ||=
					Object.keys(currentDependencies).length !==
						Object.keys(draft.baseDependencies || {}).length ||
					Object.entries(currentDependencies).some(
						([path, digest]) => draft.baseDependencies?.[path] !== digest,
					);
			} catch {
				changed = true;
			}
		}
		return {
			changed,
			reason: changed ? (current === null ? "deleted" : "changed") : null,
			current,
		};
	}
	async get(id: string, owner: number): Promise<Draft> {
		const row = (
			await this.db.query(
				"SELECT to_jsonb(drafts) AS document FROM dc_admin.drafts WHERE id=$1 AND owner_id=$2",
				[uuid(id), owner],
			)
		).rows[0];
		if (!row) throw new DraftError(404, "NOT_FOUND");
		return fromRow(row.document as Record<string, unknown>);
	}
	async detail(draft: Draft): Promise<DraftDetail> {
		if (isConfiguration(draft.kind)) {
			const values = parseConfiguration(
				draft.kind,
				draft.source,
				draft.baseSource || undefined,
			);
			return {
				draft,
				metadata: { values, editable: [], errors: [] },
				sourceState: await this.sourceState(draft),
			};
		}
		const metadata = inspect(draft.source, draft.kind);
		const identity = contentIdentity(draft.path, draft.source);
		if (identity.reliable && identity.id !== draft.contentId)
			metadata.errors.push(
				"源码 slug 与固定内容标识不同；本阶段保留输入，未来发布必须恢复原标识",
			);
		return { draft, metadata, sourceState: await this.sourceState(draft) };
	}
	async summary(owner: number): Promise<Record<string, number>> {
		const rows = await this.db.query(
			"SELECT kind, count(*)::int AS total FROM dc_admin.drafts WHERE owner_id=$1 GROUP BY kind",
			[owner],
		);
		return Object.fromEntries(
			rows.rows.map((row) => [String(row.kind), Number(row.total)]),
		);
	}
	async taskSummary(owner: number) {
		const counts = await this.db.query(
			"SELECT status, count(*)::int AS total FROM dc_admin.jobs WHERE owner_id=$1 GROUP BY status",
			[owner],
		);
		const recent = await this.db.query(
			"SELECT id,kind,status,stage,effects,error,created_at FROM dc_admin.jobs WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT 6",
			[owner],
		);
		return {
			counts: Object.fromEntries(
				counts.rows.map((row) => [String(row.status), Number(row.total)]),
			),
			recent: recent.rows.map((row) => ({
				id: String(row.id),
				kind: String(row.kind),
				status: String(row.status),
				stage: String(row.stage),
				effects: row.effects as {
					commit?: string;
					release?: string;
					pushed?: boolean;
					installed?: boolean;
				},
				error: row.error as string | null,
				createdAt: new Date(row.created_at as string).toISOString(),
			})),
		};
	}
	async list(owner: number, kind: DraftKind, page: number) {
		if (!Number.isSafeInteger(page) || page < 1)
			throw new DraftError(400, "INPUT");
		const rows = await this.db.query(
			"SELECT id,kind,path,source_id,revision,snapshot,updated_at FROM dc_admin.drafts WHERE owner_id=$1 AND kind=$2 ORDER BY updated_at DESC,id LIMIT 30 OFFSET $3",
			[owner, kind, (page - 1) * 30],
		);
		const count = await this.db.query(
			"SELECT count(*)::int AS total FROM dc_admin.drafts WHERE owner_id=$1 AND kind=$2",
			[owner, kind],
		);
		return { items: rows.rows, total: Number(count.rows[0].total), page };
	}
	async create(
		owner: number,
		input: Record<string, unknown>,
	): Promise<DraftDetail> {
		const id = uuid(input.requestId);
		const fingerprint = hash(JSON.stringify(input));
		const existing = (
			await this.db.query(
				"SELECT to_jsonb(drafts) AS document FROM dc_admin.drafts WHERE id=$1 AND owner_id=$2",
				[id, owner],
			)
		).rows[0];
		if (existing) {
			const document = existing.document as Record<string, unknown>;
			if (document.creation_payload !== fingerprint)
				throw new DraftError(409, "REQUEST_REUSE");
			return this.detail(fromRow(document));
		}
		let kind: DraftKind;
		let baseDependencies: Record<string, string> = {};
		let path: string;
		let contentId: string;
		let sourceId: string | null = null;
		let source: string;
		let baseSource: string | null = null;
		let baseHash: string | null = null;
		let baseCommit: string | null = null;
		let baseBlob: string | null = null;
		let copiedFrom: string | null = null;
		if (input.copyFrom !== undefined) {
			const original = await this.get(uuid(input.copyFrom), owner);
			({
				kind,
				path,
				contentId,
				sourceId,
				baseSource,
				baseHash,
				baseCommit,
				baseBlob,
				baseDependencies = {},
			} = original);
			source = raw(input.source);
			copiedFrom = original.id;
		} else {
			kind = draftKind(input.kind);
			path = controlledPath(input.path, kind);
			if (input.fromSource === true || isConfiguration(kind)) {
				if (isConfiguration(kind) && input.fromSource !== true)
					throw new DraftError(400, "INPUT");
				sourceId = path;
				const current = await this.readSource(kind, path);
				if (current === null) throw new DraftError(404, "SOURCE_MISSING");
				source = raw(current);
				contentId = isConfiguration(kind)
					? kind
					: contentIdentity(path, source).id;
				if (isConfiguration(kind))
					baseDependencies = await dependencyState(this.root, kind);
				baseSource = source;
				baseHash = hash(source);
				const run = promisify(execFile);
				try {
					baseCommit = (
						await run("git", ["rev-parse", "HEAD"], {
							cwd: this.root,
							timeout: 3000,
						})
					).stdout.trim();
				} catch {
					/* non-git fixture */
				}
				if (baseCommit)
					try {
						baseBlob = (
							await run(
								"git",
								[
									"rev-parse",
									`${baseCommit}:${isConfiguration(kind) ? configurationPath(kind, path) : `src/content/${kind}/${path}`}`,
								],
								{ cwd: this.root, timeout: 3000 },
							)
						).stdout.trim();
					} catch {
						/* untracked source */
					}
			} else {
				const date = new Intl.DateTimeFormat("sv-SE", {
					timeZone: "Asia/Shanghai",
				}).format(new Date());
				source =
					input.source !== undefined
						? raw(input.source)
						: `---\n${kind === "posts" ? 'title: ""\n' : ""}published: ${date}\ndraft: true\n---\n\n`;
				contentId = contentIdentity(path, source).id;
				if (!safeIdentity(contentId)) throw new DraftError(400, "PATH");
				if (await this.collision(kind, path, contentId))
					throw new DraftError(409, "PATH_COLLISION");
			}
		}
		if (isConfiguration(kind)) {
			source = normalizeConfiguration(kind, source, baseSource || undefined);
			await configurationMedia(
				owner,
				{ kind, source, baseSource },
				this.managedMedia,
			);
		} else await this.managedMedia?.validateSource(owner, source);
		try {
			await this.db.query(
				"INSERT INTO dc_admin.drafts (id,owner_id,kind,path,source_id,base_commit,base_blob,base_hash,base_source,source,copied_from,snapshot,last_request,last_payload,creation_payload,content_id,base_dependencies) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$1,$13,$13,$14,$15::jsonb) ON CONFLICT (id) DO NOTHING",
				[
					id,
					owner,
					kind,
					path,
					sourceId,
					baseCommit,
					baseBlob,
					baseHash,
					baseSource,
					source,
					copiedFrom,
					copiedFrom !== null,
					fingerprint,
					contentId,
					JSON.stringify(baseDependencies),
				],
			);
		} catch (cause) {
			if (
				cause &&
				typeof cause === "object" &&
				"code" in cause &&
				cause.code === "23505"
			)
				throw new DraftError(409, "PATH_COLLISION");
			throw cause;
		}
		const result = (
			await this.db.query(
				"SELECT to_jsonb(drafts) AS document FROM dc_admin.drafts WHERE id=$1 AND owner_id=$2",
				[id, owner],
			)
		).rows[0];
		const document = result?.document as Record<string, unknown> | undefined;
		if (!document || document.creation_payload !== fingerprint)
			throw new DraftError(409, "REQUEST_REUSE");
		return this.detail(fromRow(document));
	}
	async save(
		owner: number,
		id: string,
		input: Record<string, unknown>,
	): Promise<DraftDetail> {
		const requestId = uuid(input.requestId);
		let source = raw(input.source);
		const revision = input.revision;
		if (
			!Number.isSafeInteger(revision) ||
			Number(revision) < 1 ||
			Number(revision) >= 2147483647
		)
			throw new DraftError(400, "INPUT");
		const draft = await this.get(id, owner);
		if (isConfiguration(draft.kind))
			source = normalizeConfiguration(
				draft.kind,
				source,
				draft.baseSource || undefined,
			);
		const fingerprint = hash(JSON.stringify({ source, revision }));
		const replay = async () => {
			const row = (
				await this.db.query(
					"SELECT payload,result FROM dc_admin.draft_saves WHERE draft_id=$1 AND request_id=$2",
					[id, requestId],
				)
			).rows[0];
			if (!row) return null;
			if (row.payload !== fingerprint)
				throw new DraftError(409, "REQUEST_REUSE");
			return this.detail(fromRow(row.result as Record<string, unknown>));
		};
		const repeated = await replay();
		if (repeated) return repeated;
		if (isConfiguration(draft.kind))
			await configurationMedia(
				owner,
				{ ...draft, source },
				this.managedMedia,
				false,
				draft.source,
			);
		else await this.managedMedia?.validateSource(owner, source);
		if (draft.revision !== revision)
			throw new DraftError(409, "REVISION_CONFLICT", {
				reason: "revision",
				saved: await this.detail(draft),
			});
		const state = await this.sourceState(draft);
		if (state.changed && !draft.snapshot)
			throw new DraftError(409, "SOURCE_CONFLICT", {
				reason: "source",
				saved: await this.detail(draft),
			});
		// One SQL statement commits the CAS and its replay receipt together.
		const result = await this.db.query(
			`WITH updated AS (
   UPDATE dc_admin.drafts SET source=$1,revision=revision+1,last_request=$2,last_payload=$3,updated_at=now()
   WHERE id=$4 AND owner_id=$5 AND revision=$6 RETURNING *
  ), receipt AS (
   INSERT INTO dc_admin.draft_saves (draft_id,request_id,payload,result)
   SELECT id,$2,$3,to_jsonb(updated) FROM updated RETURNING result
  ) SELECT result FROM receipt`,
			[source, requestId, fingerprint, id, owner, revision],
		);
		if (!result.rows[0]) {
			const duplicate = await replay();
			if (duplicate) return duplicate;
			throw new DraftError(409, "REVISION_CONFLICT", {
				reason: "revision",
				saved: await this.detail(await this.get(id, owner)),
			});
		}
		return this.detail(
			fromRow(result.rows[0].result as Record<string, unknown>),
		);
	}
	async media(kind: ContentKind) {
		const folder = await this.folder(kind);
		const names = await glob(kind === "posts" ? "**/*.{md,mdx}" : "**/*.md", {
			cwd: folder,
			nodir: true,
			follow: false,
		});
		const urls = new Set<string>();
		for (const name of names) {
			const source = await this.readSource(kind, name.replaceAll("\\", "/"));
			if (!source) continue;
			for (const item of images(source).items)
				if (/^(?:https?:\/\/|\/)/u.test(item.url)) urls.add(item.url);
			const cover = inspect(source, kind).values.image;
			if (typeof cover === "string" && /^https?:\/\//u.test(cover))
				urls.add(cover);
		}
		return [...urls].sort();
	}
}
