import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { isConfiguration } from "../shared/configuration.js";
import type { Draft } from "../shared/contracts.js";
import { patchField } from "../shared/editor.js";
import { type BuildDriver, buildJobId } from "./build.js";
import { contentPath } from "./candidate.js";
import { DraftError } from "./drafts.js";
import { command, tree, writeControlled } from "./executor.js";
import { byteLimit } from "./remote-build.js";

type CloudConfiguration = {
	repository: string;
	token: string;
	workflowRevision: string;
};
type CloudRun = {
	id: number;
	display_title: string;
	head_sha: string;
	event: string;
	status: string;
	conclusion: string | null;
};
const maxArchive = 1024 * 1024 * 1024;
const workflow = "build.yml";

/** Private transport only; source is not pushed to the public blog until build succeeds. */
export class GitHubActionsBuild implements BuildDriver {
	readonly mode = "github-actions" as const;
	private readonly root: string;
	constructor(
		private readonly config: CloudConfiguration,
		private readonly request: typeof fetch = fetch,
		private readonly pause = (ms: number) =>
			new Promise<void>((resolve) => setTimeout(resolve, ms)),
	) {
		if (
			!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(config.repository) ||
			config.repository.split("/").some((part) => part.startsWith(".")) ||
			!config.token ||
			/[\r\n]/u.test(config.token) ||
			!/^[a-f0-9]{40}$/u.test(config.workflowRevision)
		)
			throw new Error("Private GitHub builder operator configuration required");
		this.root = `https://api.github.com/repos/${config.repository}`;
	}

	private async api(path: string, method = "GET", body?: unknown) {
		const response = await this.request(this.root + path, {
			method,
			headers: {
				Authorization: `Bearer ${this.config.token}`,
				Accept: "application/vnd.github+json",
				"Content-Type": "application/json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(30_000),
			redirect: "error",
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(`GITHUB_BUILDER_HTTP_${response.status}`);
		}
		if (response.status === 204) return null;
		const data = await response.text();
		if (Buffer.byteLength(data) > 4 * 1024 * 1024)
			throw new Error("GITHUB_BUILDER_RESPONSE_LIMIT");
		return JSON.parse(data);
	}

	private async assertPrivate() {
		const repository = await this.api("");
		if (
			repository.private !== true ||
			repository.full_name?.toLowerCase() !==
				this.config.repository.toLowerCase() ||
			repository.default_branch !== "main"
		)
			throw new Error("GITHUB_BUILDER_MUST_BE_PRIVATE");
		const revision = await this.api("/git/ref/heads/main");
		if (revision.object?.sha !== this.config.workflowRevision)
			throw new Error("GITHUB_BUILDER_WORKFLOW_CHANGED");
		const value = await this.api(`/actions/workflows/${workflow}`);
		if (value.state !== "active") throw new Error("GITHUB_BUILDER_DISABLED");
	}

	async available() {
		try {
			await this.assertPrivate();
			await command("python3", [
				"-c",
				"import sys; assert sys.version_info >= (3,12)",
			]);
			await command("tar", ["--version"]);
			return true;
		} catch {
			return false;
		}
	}

	private async runs(): Promise<CloudRun[]> {
		const result = await this.api(
			`/actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=main&per_page=100`,
		);
		return result.workflow_runs;
	}

	async stop(jobId: string) {
		buildJobId(jobId);
		const runs = (await this.runs()).filter(
			(run) =>
				run.display_title.startsWith(`build-${jobId}-`) &&
				run.event === "workflow_dispatch" &&
				run.status !== "completed",
		);
		for (const run of runs)
			await this.api(`/actions/runs/${run.id}/cancel`, "POST");
		for (let attempt = 0; attempt < 30; attempt++) {
			if (
				(await this.runs()).every(
					(run) =>
						!runs.some((active) => active.id === run.id) ||
						run.status === "completed",
				)
			)
				return;
			await this.pause(2000);
		}
		throw new DraftError(503, "BUILD_UNAVAILABLE");
	}

	private async downloadArtifact(run: CloudRun, jobId: string, output: string) {
		const list = await this.api(`/actions/runs/${run.id}/artifacts`);
		const artifacts = list.artifacts.filter(
			(value: { name: string; expired: boolean }) =>
				value.name === `build-${jobId}` && !value.expired,
		);
		if (artifacts.length !== 1) throw new Error("GITHUB_BUILDER_ARTIFACT");
		const response = await this.request(
			`${this.root}/actions/artifacts/${artifacts[0].id}/zip`,
			{
				headers: { Authorization: `Bearer ${this.config.token}` },
				redirect: "manual",
				signal: AbortSignal.timeout(30_000),
			},
		);
		if (response.status !== 302) throw new Error("GITHUB_BUILDER_DOWNLOAD");
		const location = new URL(response.headers.get("location") || "");
		if (
			location.protocol !== "https:" ||
			location.username ||
			location.password ||
			!/(?:^|\.)(?:blob\.core\.windows\.net|githubusercontent\.com)$/u.test(
				location.hostname,
			)
		)
			throw new Error("GITHUB_BUILDER_DOWNLOAD_ORIGIN");
		// Signed artifact URL receives no GitHub authorization header.
		const archive = await this.request(location, {
			redirect: "error",
			signal: AbortSignal.timeout(5 * 60_000),
		});
		if (!archive.ok || !archive.body)
			throw new Error("GITHUB_BUILDER_DOWNLOAD");
		await pipeline(
			Readable.fromWeb(archive.body as Parameters<typeof Readable.fromWeb>[0]),
			byteLimit(1024 * 1024 * 1024),
			createWriteStream(output, { mode: 0o600 }),
		);
	}

	async build(
		directory: string,
		jobId: string,
		draft: Draft,
		preview: boolean,
	) {
		buildJobId(jobId);
		await this.assertPrivate();
		const input = join(directory, "input");
		const source = join(directory, "cloud-input.tar.gz");
		if (preview && !isConfiguration(draft.kind))
			await writeControlled(
				input,
				contentPath(draft),
				patchField(draft.source, draft.kind, "draft", false),
			);
		await tree(input, 1024 * 1024 * 1024);
		await command(
			"tar",
			["-czf", source, "-C", input, "."],
			undefined,
			undefined,
			10 * 60_000,
		);
		const size = (await stat(source)).size;
		if (size > maxArchive) throw new Error("GITHUB_BUILDER_INPUT_LIMIT");
		const hash = createHash("sha256");
		for await (const bytes of createReadStream(source)) hash.update(bytes);
		const inputSha256 = hash.digest("hex");
		const tag = `job-${jobId}`;
		let release: { id: number; assets?: { name: string }[] };
		try {
			release = await this.api(`/releases/tags/${tag}`);
		} catch (error) {
			if (
				!(error instanceof Error) ||
				error.message !== "GITHUB_BUILDER_HTTP_404"
			)
				throw error;
			release = await this.api("/releases", "POST", {
				tag_name: tag,
				target_commitish: this.config.workflowRevision,
				name: tag,
				prerelease: true,
				draft: false,
			});
		}
		const assetName = `input-${inputSha256}.tar.gz`;
		if (!release.assets?.some((asset) => asset.name === assetName)) {
			const options: RequestInit & { duplex: string } = {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.config.token}`,
					"Content-Type": "application/gzip",
					"Content-Length": String(size),
				},
				body: createReadStream(source) as unknown as BodyInit,
				duplex: "half",
				redirect: "error",
				signal: AbortSignal.timeout(10 * 60_000),
			};
			const response = await this.request(
				`https://uploads.github.com/repos/${this.config.repository}/releases/${release.id}/assets?name=${assetName}`,
				options,
			);
			if (!response.ok) throw new Error("GITHUB_BUILDER_UPLOAD");
			await response.body?.cancel();
		}
		const attemptId = randomUUID();
		await writeFile(
			join(directory, "cloud-build.json"),
			JSON.stringify({ releaseId: release.id, attemptId, inputSha256 }),
			{ mode: 0o600 },
		);
		await this.api(`/actions/workflows/${workflow}/dispatches`, "POST", {
			ref: "main",
			inputs: { jobId, attemptId, releaseId: String(release.id), inputSha256 },
		});
		const deadline = Date.now() + 20 * 60_000;
		let completed: CloudRun | undefined;
		while (Date.now() < deadline) {
			const matches = (await this.runs()).filter(
				(run) => run.display_title === `build-${jobId}-${attemptId}`,
			);
			if (matches.length > 1) throw new Error("GITHUB_BUILDER_AMBIGUOUS_RUN");
			const run = matches[0];
			if (run) {
				if (
					run.head_sha !== this.config.workflowRevision ||
					run.event !== "workflow_dispatch"
				)
					throw new Error("GITHUB_BUILDER_RUN_MISMATCH");
				if (run.status === "completed") {
					if (run.conclusion !== "success")
						throw new DraftError(422, "BUILD_FAILED");
					completed = run;
					break;
				}
			}
			await this.pause(10_000);
		}
		if (!completed) {
			await this.stop(jobId);
			throw new DraftError(422, "BUILD_FAILED");
		}
		const zip = join(directory, "cloud-output.zip");
		const artifact = join(directory, "cloud-output.tar.gz");
		await this.downloadArtifact(completed, jobId, zip);
		// The ZIP is only an Actions wrapper, never an arbitrary extracted tree.
		await command("python3", [
			"-c",
			`import sys,zipfile,shutil,stat
with zipfile.ZipFile(sys.argv[1]) as z:
 entries=z.infolist()
 assert len(entries)==1 and entries[0].filename=='artifact.tar.gz'
 e=entries[0]
 assert e.file_size<=1024*1024*1024 and not e.is_dir() and not stat.S_ISLNK(e.external_attr>>16)
 with z.open(e) as src,open(sys.argv[2],'xb') as dst: shutil.copyfileobj(src,dst)
`,
			zip,
			artifact,
		]);
		const output = join(directory, "artifact");
		await mkdir(output, { recursive: true });
		await command("python3", [
			fileURLToPath(new URL("../build/extract-artifact.py", import.meta.url)),
			artifact,
			output,
		]);
		return output;
	}
}
