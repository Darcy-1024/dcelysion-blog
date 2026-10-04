import {
	lstat,
	mkdir,
	readFile,
	rename,
	rmdir,
	unlink,
	writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import { isConfiguration } from "../shared/configuration.js";
import type { Draft } from "../shared/contracts.js";
import { inspect } from "../shared/editor.js";
import type {
	Job,
	JobEffects,
	PublishingInfo,
	PublishTarget,
} from "../shared/publishing.js";
import type { BuildDriver } from "./build.js";
import { CandidateExecutor } from "./candidate.js";
import { configurationMedia } from "./configuration.js";
import {
	DraftError,
	type DraftService,
	hash,
	type Queryable,
	uuid,
} from "./drafts.js";
import type { MediaService } from "./media.js";
import { inside } from "./paths.js";
import { validateMedia, validateSnapshot } from "./publish-validation.js";
import {
	packageArtifact,
	type ReleaseDriver,
	readPackage,
} from "./releases.js";

export type JobConfiguration = {
	stateRoot: string;
	repository: string;
	targets: PublishTarget[];
	mediaOrigins: string[];
};
export class JobService {
	private db: Queryable;
	private pool?: pg.Pool;
	private worker: Promise<void> | null = null;
	constructor(
		private config: JobConfiguration,
		private drafts: DraftService,
		private builder: BuildDriver,
		private releases: Map<string, ReleaseDriver>,
		databaseUrl: string,
		adapter?: Queryable,
		private media: MediaService | null = null,
	) {
		if (inside(resolve(config.repository), resolve(config.stateRoot)))
			throw new Error("Executor state must be outside the content repository");
		if (adapter) this.db = adapter;
		else {
			this.pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
			this.db = this.pool;
		}
	}
	async close() {
		await this.worker;
		await this.pool?.end();
	}
	async info(): Promise<PublishingInfo> {
		const available = await this.builder.available();
		return {
			targets: this.config.targets,
			buildMode: this.builder.mode,
			available,
			reason: available ? null : "BUILD_UNAVAILABLE",
		};
	}
	private executor(target: PublishTarget) {
		return new CandidateExecutor(
			this.config.repository,
			target.remote,
			target.branch,
			join(this.config.stateRoot, "source.git"),
		);
	}
	private target(id: unknown) {
		const value = this.config.targets.find((target) => target.id === id);
		if (!value) throw new DraftError(503, "TARGET_NOT_CONFIGURED");
		return value;
	}
	directory(id: string) {
		return join(this.config.stateRoot, uuid(id));
	}
	private decode(row: Record<string, unknown>): Job {
		const data = (row.document || row) as Record<string, unknown>;
		return {
			id: String(data.id),
			draftId: String(data.draft_id),
			revision: Number(data.revision),
			snapshot: data.snapshot as Draft,
			mediaPlan: data.media_plan
				? (data.media_plan as Job["mediaPlan"])
				: undefined,
			target: data.target as PublishTarget,
			kind: data.kind as Job["kind"],
			status: data.status as Job["status"],
			stage: String(data.stage),
			effects: data.effects as JobEffects,
			error: data.error === null ? null : String(data.error),
			attempt: Number(data.attempt),
			createdAt: new Date(String(data.created_at)).toISOString(),
			logs: [],
		};
	}
	async get(owner: number, id: string) {
		const row = (
			await this.db.query(
				"SELECT to_jsonb(jobs) AS document FROM dc_admin.jobs WHERE id=$1 AND owner_id=$2",
				[uuid(id), owner],
			)
		).rows[0];
		if (!row) throw new DraftError(404, "NOT_FOUND");
		const job = this.decode(row);
		job.logs = (
			await this.db.query(
				"SELECT stage,message,created_at FROM dc_admin.job_logs WHERE job_id=$1 ORDER BY id",
				[id],
			)
		).rows as Job["logs"];
		return job;
	}
	async list(owner: number) {
		return (
			await this.db.query(
				"SELECT to_jsonb(jobs) AS document FROM dc_admin.jobs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 40",
				[owner],
			)
		).rows.map((row) => this.decode(row));
	}
	async diff(owner: number, input: Record<string, unknown>) {
		const draft = await this.drafts.get(uuid(input.draftId), owner);
		if (draft.revision !== input.revision)
			throw new DraftError(409, "REVISION_CONFLICT");
		validateSnapshot(draft);
		if ((await this.drafts.sourceState(draft)).changed)
			throw new DraftError(409, "SOURCE_CONFLICT");
		const target = this.target(input.targetId);
		const base = await this.executor(target).remoteHead();
		const mediaPlan = isConfiguration(draft.kind)
			? await configurationMedia(owner, draft, this.media)
			: await this.media?.plan(owner, draft.source);
		const resolved = mediaPlan ? { ...draft, source: mediaPlan.source } : draft;
		return {
			draftId: draft.id,
			revision: draft.revision,
			base,
			target,
			...(await this.executor(target).diff(resolved, base)),
			mediaPlan,
			mediaConfirm: mediaPlan?.dependencies.length
				? hash(JSON.stringify(mediaPlan))
				: null,
		};
	}
	async create(owner: number, input: Record<string, unknown>) {
		const id = uuid(input.requestId);
		const draftId = uuid(input.draftId);
		const target = this.target(input.targetId);
		const kind = input.kind;
		if (
			(kind !== "preview" && kind !== "publish") ||
			!Number.isSafeInteger(input.revision)
		)
			throw new DraftError(400, "INPUT");
		if (kind === "publish" && input.confirm !== target.fingerprint)
			throw new DraftError(400, "PUBLISH_CONFIRM");
		if (typeof input.base !== "string" || !/^[a-f0-9]{40}$/u.test(input.base))
			throw new DraftError(400, "INPUT");
		const fingerprint = hash(
			JSON.stringify({
				draftId,
				revision: input.revision,
				target,
				kind,
				base: input.base,
				mediaConfirm: input.mediaConfirm || null,
			}),
		);
		const existing = (
			await this.db.query(
				"SELECT request_hash FROM dc_admin.jobs WHERE id=$1 AND owner_id=$2",
				[id, owner],
			)
		).rows[0];
		if (existing) {
			if (existing.request_hash !== fingerprint)
				throw new DraftError(409, "REQUEST_REUSE");
			return this.get(owner, id);
		}
		const draft = await this.drafts.get(draftId, owner);
		if (draft.revision !== input.revision)
			throw new DraftError(409, "REVISION_CONFLICT");
		validateSnapshot(draft);
		if ((await this.drafts.sourceState(draft)).changed)
			throw new DraftError(409, "SOURCE_CONFLICT");
		const executor = this.executor(target);
		if ((await executor.remoteHead()) !== input.base)
			throw new DraftError(409, "REMOTE_CONFLICT");
		await executor.checkSource(draft, input.base);
		const publicPlan = isConfiguration(draft.kind)
			? await configurationMedia(owner, draft, this.media)
			: await this.media?.plan(owner, draft.source);
		if (publicPlan?.dependencies.length) {
			if (input.mediaConfirm !== hash(JSON.stringify(publicPlan)))
				throw new DraftError(409, "MEDIA_CONFIRM_CHANGED");
			if (
				kind === "publish" &&
				!isConfiguration(draft.kind) &&
				inspect(draft.source, draft.kind).values.draft === true
			)
				throw new DraftError(422, "MEDIA_PRIVATE_DRAFT");
		} else if (draft.source.includes("/__managed-media/") && !this.media)
			throw new DraftError(503, "MEDIA_NOT_CONFIGURED");
		const mediaPlan =
			kind === "preview"
				? isConfiguration(draft.kind)
					? await configurationMedia(owner, draft, this.media, true)
					: await this.media?.plan(owner, draft.source, true)
				: publicPlan;
		// INSERT SELECT binds the captured document to its actual revision in one SQL statement.
		await this.db.query(
			`INSERT INTO dc_admin.jobs(id,owner_id,request_hash,draft_id,revision,snapshot,target,kind,effects,media_plan)
   SELECT $1,$2,$3,id,revision,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10::jsonb FROM dc_admin.drafts WHERE id=$4 AND owner_id=$2 AND revision=$5 ON CONFLICT(id) DO NOTHING`,
			[
				id,
				owner,
				fingerprint,
				draftId,
				input.revision,
				JSON.stringify(draft),
				JSON.stringify(target),
				kind,
				JSON.stringify({ base: input.base, buildMode: this.builder.mode }),
				mediaPlan ? JSON.stringify(mediaPlan) : null,
			],
		);
		const receipt = (
			await this.db.query(
				"SELECT request_hash FROM dc_admin.jobs WHERE id=$1 AND owner_id=$2",
				[id, owner],
			)
		).rows[0];
		if (!receipt) throw new DraftError(409, "REVISION_CONFLICT");
		if (receipt.request_hash !== fingerprint)
			throw new DraftError(409, "REQUEST_REUSE");
		this.kick();
		return this.get(owner, id);
	}
	async retry(owner: number, id: string) {
		const job = await this.get(owner, id);
		if (job.status !== "failed") throw new DraftError(409, "JOB_STATE");
		if (this.target(job.target.id).fingerprint !== job.target.fingerprint)
			throw new DraftError(409, "TARGET_CHANGED");
		await this.db.query(
			"UPDATE dc_admin.jobs SET status='queued',error=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='failed'",
			[id, owner],
		);
		this.kick();
		return this.get(owner, id);
	}
	private async update(
		job: Job,
		stage: string,
		message: string,
		effects = job.effects,
	) {
		const result = await this.db.query(
			"UPDATE dc_admin.jobs SET stage=$1,effects=$2::jsonb,updated_at=now() WHERE id=$3 AND status='running' AND attempt=$4 RETURNING id",
			[stage, JSON.stringify(effects), job.id, job.attempt],
		);
		if (!result.rows.length) throw new DraftError(409, "JOB_STATE");
		job.stage = stage;
		job.effects = effects;
		await this.db.query(
			"INSERT INTO dc_admin.job_logs(job_id,stage,message) SELECT $1,$2,$3 WHERE (SELECT count(*) FROM dc_admin.job_logs WHERE job_id=$1)<200",
			[job.id, stage, message],
		);
	}
	// One host / shared private state root. Never use expiry alone to steal a live worker's lock.
	private async lock() {
		await mkdir(this.config.stateRoot, { recursive: true });
		const file = join(this.config.stateRoot, "worker.lock");
		try {
			await mkdir(file);
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
			let owner: { pid: number; host: string };
			try {
				owner = JSON.parse(await readFile(join(file, "owner.json"), "utf8"));
			} catch {
				throw new DraftError(409, "EXECUTOR_BUSY");
			}
			if (owner.host !== hostname()) throw new DraftError(409, "EXECUTOR_BUSY");
			try {
				process.kill(owner.pid, 0);
				throw new DraftError(409, "EXECUTOR_BUSY");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			}
			await unlink(join(file, "owner.json"));
			await rmdir(file);
			await mkdir(file);
		}
		await writeFile(
			join(file, "owner.json"),
			JSON.stringify({ pid: process.pid, host: hostname() }),
		);
		return async () => {
			await unlink(join(file, "owner.json"));
			await rmdir(file);
		};
	}
	kick() {
		if (!this.worker)
			this.worker = this.drain()
				.catch(() => {})
				.finally(() => {
					this.worker = null;
				});
	}
	async idle() {
		await this.worker;
	}
	private async drain() {
		const unlock = await this.lock();
		try {
			// Lock acquisition proves the prior worker is gone; containers are reconciled per job.
			await this.db.query(
				"UPDATE dc_admin.jobs SET status='queued' WHERE status='running'",
			);
			for (;;) {
				const row = (
					await this.db.query(
						`UPDATE dc_admin.jobs SET status='running',attempt=attempt+1,updated_at=now() WHERE id=(SELECT id FROM dc_admin.jobs WHERE status='queued' ORDER BY created_at LIMIT 1) AND status='queued' RETURNING to_jsonb(jobs) AS document`,
					)
				).rows[0];
				if (!row) break;
				const job = this.decode(row);
				try {
					await this.execute(job);
					await this.db.query(
						"UPDATE dc_admin.jobs SET status='succeeded',error=NULL,updated_at=now() WHERE id=$1 AND status='running' AND attempt=$2",
						[job.id, job.attempt],
					);
				} catch (cause) {
					const code =
						cause instanceof DraftError ? cause.code : "EXECUTOR_FAILED";
					await this.update(job, job.stage, `执行停止：${code}`);
					await this.db.query(
						"UPDATE dc_admin.jobs SET status='failed',error=$1,updated_at=now() WHERE id=$2 AND status='running' AND attempt=$3",
						[code, job.id, job.attempt],
					);
				}
			}
		} finally {
			await unlock();
		}
	}
	private async execute(job: Job) {
		const configured = this.target(job.target.id);
		if (configured.fingerprint !== job.target.fingerprint)
			throw new DraftError(409, "TARGET_CHANGED");
		await this.builder.stop(job.id);
		const directory = this.directory(job.id);
		const executor = this.executor(job.target);
		const effects = job.effects;
		const base = effects.base as string;
		validateSnapshot(job.snapshot);
		const draft = job.mediaPlan
			? { ...job.snapshot, source: job.mediaPlan.source }
			: job.snapshot;
		if (job.mediaPlan?.dependencies.length) {
			if (!this.media) throw new DraftError(503, "MEDIA_NOT_CONFIGURED");
			await this.update(
				job,
				"media",
				"正在核对固定媒体依赖；正式发布将交付公开副本",
			);
			const owner = Number(
				(
					await this.db.query(
						"SELECT owner_id FROM dc_admin.jobs WHERE id=$1",
						[job.id],
					)
				).rows[0].owner_id,
			);
			await this.media.ensure(owner, job.mediaPlan, job.kind === "publish");
		}
		if (!effects.commit) {
			if ((await executor.remoteHead()) !== base)
				throw new DraftError(409, "REMOTE_CONFLICT");
			if ((await this.drafts.sourceState(job.snapshot)).changed)
				throw new DraftError(409, "SOURCE_CONFLICT");
			await this.update(job, "candidate", "正在形成仅含目标内容的候选提交");
			// Interrupted preparation is preserved for inspection and never mixed into another attempt.
			try {
				await lstat(directory);
				await rename(directory, `${directory}.interrupted-${job.attempt}`);
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
			}
			let distribution: string | undefined;
			if (job.kind === "publish" && this.media) {
				const owner = Number(
					(
						await this.db.query(
							"SELECT owner_id FROM dc_admin.jobs WHERE id=$1",
							[job.id],
						)
					).rows[0].owner_id,
				);
				distribution = `${JSON.stringify(await this.media.distribution(owner, hash(JSON.stringify([base, job.snapshot.id, job.revision, draft.source]))), null, 2)}\n`;
				effects.distributionHash = hash(distribution);
			}
			const candidate = await executor.prepare(
				directory,
				draft,
				base,
				job.target,
				job.kind === "preview",
				distribution,
			);
			effects.commit = candidate.commit;
			await this.update(job, "candidate", "候选提交已形成", effects);
		}
		if (
			job.kind === "preview" &&
			job.mediaPlan?.dependencies.length &&
			this.media
		) {
			const owner = Number(
				(
					await this.db.query(
						"SELECT owner_id FROM dc_admin.jobs WHERE id=$1",
						[job.id],
					)
				).rows[0].owner_id,
			);
			await this.media.ensure(
				owner,
				job.mediaPlan,
				false,
				join(directory, "input/public"),
			);
		}
		if (!effects.built) {
			if (job.kind === "publish")
				await executor.verifyCandidate(
					directory,
					effects.commit as string,
					base,
					draft,
					effects.distributionHash,
				);
			await validateMedia(
				draft,
				join(directory, "input"),
				this.config.mediaOrigins,
				job.kind === "publish"
					? job.mediaPlan?.dependencies.map((d) => d.url)
					: [],
			);
			await this.update(job, "build", `开始 ${this.builder.mode} 构建`);
			// Failed/interrupted outputs are never reused as completed artifacts.
			try {
				await lstat(join(directory, "artifact"));
				await rename(
					join(directory, "artifact"),
					join(directory, `artifact.interrupted-${job.attempt}`),
				);
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
			}
			await this.builder.build(
				directory,
				job.id,
				draft,
				job.kind === "preview",
			);
			if (
				job.kind === "preview" &&
				job.mediaPlan?.dependencies.length &&
				this.media
			) {
				const owner = Number(
					(
						await this.db.query(
							"SELECT owner_id FROM dc_admin.jobs WHERE id=$1",
							[job.id],
						)
					).rows[0].owner_id,
				);
				await this.media.ensure(
					owner,
					job.mediaPlan,
					false,
					join(directory, "artifact"),
				);
			}
			const packaged = await packageArtifact(directory);
			effects.built = true;
			effects.digest = packaged.digest;
			effects.release = packaged.release;
			await this.update(job, "build", "构建与产物校验完成", effects);
		}
		const packaged = await readPackage(directory);
		if (
			packaged.digest !== effects.digest ||
			packaged.release !== effects.release
		)
			throw new DraftError(409, "ARTIFACT_INVALID");
		if (job.kind === "preview") {
			await this.update(job, "preview", "受保护静态排版预览就绪");
			return;
		}
		await executor.verifyCandidate(
			directory,
			effects.commit as string,
			base,
			draft,
			effects.distributionHash,
		);
		if (job.mediaPlan?.dependencies.length && this.media) {
			const owner = Number(
				(
					await this.db.query(
						"SELECT owner_id FROM dc_admin.jobs WHERE id=$1",
						[job.id],
					)
				).rows[0].owner_id,
			);
			await this.media.ensure(owner, job.mediaPlan, true);
		}
		// Reconcile uncertain push outcomes before retrying any external effect.
		const remote = await executor.remoteHead();
		if (remote === effects.commit) {
			effects.pushed = true;
			await this.update(job, "push", "远端已包含本任务提交", effects);
		} else if (effects.pushed || remote !== base)
			throw new DraftError(409, "REMOTE_CONFLICT");
		if (!effects.pushed) {
			if ((await this.drafts.sourceState(job.snapshot)).changed)
				throw new DraftError(409, "SOURCE_CONFLICT");
			await this.update(
				job,
				"push",
				job.target.pages
					? "准备同步 Git；master 推送会触发既有 Pages 工作流"
					: "准备同步配置的 Git 远端",
			);
			await executor.push(directory, effects.commit as string, base);
			effects.pushed = true;
			await this.update(job, "push", "Git 推送完成", effects);
		}
		if (!job.target.deploy) {
			await this.update(job, "complete", "Git 同步完成；此目标不安装 release");
			return;
		}
		const releases = this.releases.get(job.target.id);
		if (!releases) throw new DraftError(503, "TARGET_NOT_CONFIGURED");
		const current = await releases.current();
		if (current === effects.release) {
			await releases.list();
			effects.installed = true;
			await this.update(
				job,
				"complete",
				"已核对 current 与本任务 release",
				effects,
			);
			return;
		}
		if (effects.installed) throw new DraftError(409, "RELEASE_CONFLICT");
		if (effects.previous === undefined) effects.previous = current;
		if (current !== effects.previous)
			throw new DraftError(409, "RELEASE_CONFLICT");
		await this.update(
			job,
			"install",
			"Git 已推送，准备安装腾讯格式 release",
			effects,
		);
		await releases.install(packaged, effects.previous);
		effects.installed = true;
		await this.update(job, "complete", "release 安装完成", effects);
	}
	async releaseList(targetId: string) {
		const target = this.target(targetId);
		const driver = this.releases.get(target.id);
		if (!driver) throw new DraftError(503, "TARGET_NOT_CONFIGURED");
		return driver.list();
	}
	async rollback(owner: number, input: Record<string, unknown>) {
		const target = this.target(input.targetId);
		if (
			input.confirm !== target.fingerprint ||
			typeof input.releaseId !== "string" ||
			!(input.expected === null || typeof input.expected === "string")
		)
			throw new DraftError(400, "PUBLISH_CONFIRM");
		const driver = this.releases.get(target.id);
		if (!driver) throw new DraftError(503, "TARGET_NOT_CONFIGURED");
		const unlock = await this.lock();
		try {
			await driver.rollback(input.releaseId, input.expected);
			await this.db.query(
				"INSERT INTO dc_admin.audit(actor_id,action,result) VALUES($1,'release.rollback','success')",
				[owner],
			);
			return driver.list();
		} finally {
			await unlock();
		}
	}
}
