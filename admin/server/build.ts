import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isConfiguration } from "../shared/configuration.js";
import type { Draft } from "../shared/contracts.js";
import { patchField } from "../shared/editor.js";
import { contentPath } from "./candidate.js";
import { DraftError } from "./drafts.js";
import { command, tree, writeControlled } from "./executor.js";

export const buildJobId = (value: string) => {
	if (
		!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
			value,
		)
	)
		throw new Error("BUILD_JOB_ID");
	return value;
};

export interface BuildDriver {
	mode: "docker-astro" | "fixture";
	available(): Promise<boolean>;
	stop(jobId: string): Promise<void>;
	build(
		directory: string,
		jobId: string,
		draft: Draft,
		preview: boolean,
	): Promise<string>;
}
export class DockerBuild implements BuildDriver {
	readonly mode = "docker-astro" as const;
	constructor(
		private image: string | undefined,
		private publicEnvironment: {
			commentProvider?: "waline" | "twikoo";
			walineServer?: string;
		} = {},
		private endpoint = "unix:///run/user/1000/docker.sock",
	) {
		if (
			publicEnvironment.commentProvider &&
			!["waline", "twikoo"].includes(publicEnvironment.commentProvider)
		)
			throw new Error("Unsupported public comment provider");
		if (!/^unix:\/\/\/run\/user\/[1-9][0-9]*\/docker\.sock$/u.test(endpoint))
			throw new Error("Explicit rootless Docker endpoint required");
		if (image && !/^(?:[-a-zA-Z0-9._/:]+@)?sha256:[a-f0-9]{64}$/u.test(image))
			throw new Error("Build image must be pinned by sha256 digest");
		if (publicEnvironment.walineServer) {
			const url = new URL(publicEnvironment.walineServer);
			if (
				url.origin !== publicEnvironment.walineServer ||
				url.protocol !== "https:"
			)
				throw new Error("Build Waline URL requires a public HTTPS origin");
		}
	}
	async available() {
		if (!(await this.containerAvailable())) return false;
		try {
			await command("python3", [
				"-c",
				"import sys; assert sys.version_info >= (3,12)",
			]);
			return true;
		} catch {
			return false;
		}
	}
	async containerAvailable() {
		if (!this.image) return false;
		try {
			const info = JSON.parse(
				await command("docker", [
					"--host",
					this.endpoint,
					"info",
					"--format",
					"{{json .}}",
				]),
			);
			if (
				!info.SecurityOptions?.some((value: string) =>
					value.includes("rootless"),
				) ||
				info.CgroupVersion !== "2" ||
				!info.CgroupDriver ||
				info.CgroupDriver === "none" ||
				["MemoryLimit", "SwapLimit", "CpuCfsQuota", "PidsLimit"].some(
					(key) => info[key] !== true,
				)
			)
				return false;
			await command("docker", [
				"--host",
				this.endpoint,
				"image",
				"inspect",
				this.image,
			]);
			return true;
		} catch {
			return false;
		}
	}
	async stop(jobId: string) {
		buildJobId(jobId);
		if (!this.image) return;
		// A stopped API process can leave its container alive. Never rebuild until it is removed.
		try {
			const state = await command("docker", [
				"--host",
				this.endpoint,
				"ps",
				"-a",
				"--filter",
				`name=^dc-admin-${jobId}$`,
				"--filter",
				"label=cn.dcelysion.admin-builder=1",
				"--format",
				"{{.ID}}",
			]);
			if (state.trim())
				await command("docker", [
					"--host",
					this.endpoint,
					"rm",
					"--force",
					...state.trim().split(/\s+/u),
				]);
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
		if (!(await this.available()))
			throw new DraftError(503, "BUILD_UNAVAILABLE");
		const input = join(directory, "input");
		const output = join(directory, "artifact");
		await mkdir(output, { recursive: true });
		if (preview && !isConfiguration(draft.kind))
			await writeControlled(
				input,
				contentPath(draft),
				patchField(draft.source, draft.kind, "draft", false),
			);
		await tree(input);
		const sourceArchive = join(directory, "container-input.tar");
		await command("tar", ["-cf", sourceArchive, "-C", input, "."]);
		await this.buildArchive(
			sourceArchive,
			join(directory, "container-output.tar.gz"),
			jobId,
		);
		await command("python3", [
			fileURLToPath(new URL("../build/extract-artifact.py", import.meta.url)),
			join(directory, "container-output.tar.gz"),
			output,
		]);
		return output;
	}
	async buildArchive(
		sourceArchive: string,
		outputArchive: string,
		jobId: string,
	) {
		buildJobId(jobId);
		await this.stop(jobId);
		const args = [
			"--host",
			this.endpoint,
			"run",
			"-i",
			"--label",
			"cn.dcelysion.admin-builder=1",
			"--rm",
			"--name",
			`dc-admin-${jobId}`,
			"--network",
			"none",
			"--read-only",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--user",
			"1000:1000",
			"--memory",
			"768m",
			"--memory-swap",
			"1280m",
			"--cpus",
			"0.5",
			"--pids-limit",
			"192",
			"--tmpfs",
			"/tmp:rw,noexec,nosuid,size=128m",
			"--tmpfs",
			"/work:rw,nosuid,size=1024m,uid=1000,gid=1000",
			"--env",
			"ASTRO_TELEMETRY_DISABLED=1",
			...(this.publicEnvironment.commentProvider
				? [
						"--env",
						`PUBLIC_COMMENT_PROVIDER=${this.publicEnvironment.commentProvider}`,
					]
				: []),
			...(this.publicEnvironment.walineServer
				? [
						"--env",
						`PUBLIC_WALINE_SERVER_URL=${this.publicEnvironment.walineServer}`,
					]
				: []),
			this.image as string,
		];
		await new Promise<void>((accept, reject) => {
			const archive = createWriteStream(outputArchive, {
				flags: "w",
				mode: 0o600,
			});
			const child = spawn("docker", args, {
				windowsHide: true,
				env: {
					PATH: process.env.PATH,
					SystemRoot: process.env.SystemRoot,
					HOME: process.env.HOME,
					USERPROFILE: process.env.USERPROFILE,
				},
				stdio: ["pipe", "pipe", "pipe"],
			});
			const source = createReadStream(sourceArchive);
			source.on("error", () => abort());
			child.stdin.on("error", () => abort());
			source.pipe(child.stdin);
			let outputBytes = 0;
			let logBytes = 0;
			let timedOut = false;
			let stopping = false;
			const abort = () => {
				if (stopping) return;
				stopping = true;
				timedOut = true;
				void this.stop(jobId)
					.finally(() => child.kill())
					.catch(() => {});
			};
			child.stdout.on("data", (chunk: Buffer) => {
				outputBytes += chunk.length;
				if (outputBytes > 512 * 1024 * 1024) {
					timedOut = true;
					child.stdout.unpipe(archive);
					archive.end();
					abort();
				}
			});
			child.stdout.pipe(archive);
			child.stderr.on("data", (chunk: Buffer) => {
				logBytes += chunk.length;
				if (logBytes > 4 * 1024 * 1024) {
					timedOut = true;
					abort();
				}
			});
			archive.on("error", () => {
				abort();
				reject(new DraftError(422, "BUILD_FAILED"));
			});
			const timer = setTimeout(() => {
				abort();
			}, 10 * 60_000);
			child.on("error", () => {
				clearTimeout(timer);
				archive.destroy();
				reject(new DraftError(503, "BUILD_UNAVAILABLE"));
			});
			child.on("close", (code) => {
				source.destroy();
				clearTimeout(timer);
				const finish = () => {
					if (code === 0 && !timedOut) accept();
					else reject(new DraftError(422, "BUILD_FAILED"));
				};
				if (archive.writableFinished || archive.destroyed) finish();
				else archive.once("finish", finish);
			});
		});
		await this.stop(jobId);
	}
}
