import { resolve } from "node:path";
import type { PublishTarget } from "../shared/publishing.js";
import { DockerBuild } from "./build.js";
import { type DraftService, hash } from "./drafts.js";
import { JobService } from "./jobs.js";
import type { MediaService } from "./media.js";
import { type ReleaseDriver, TencentReleases } from "./releases.js";
import { RemoteBuild } from "./remote-build.js";

export function productionPublishing(
	repository: string,
	databaseUrl: string,
	drafts: DraftService,
	env = process.env,
	media: MediaService | null = null,
) {
	const targets: PublishTarget[] = [];
	const releases = new Map<string, ReleaseDriver>();
	// No real write target is enabled by default. Configuration is a server operator action.
	if (
		env.ADMIN_PUBLISH_REMOTE &&
		env.ADMIN_PUBLISH_BRANCH &&
		env.ADMIN_EXECUTOR_STATE_ROOT
	) {
		const deploy = Boolean(env.ADMIN_TENCENT_SSH_HOST);
		const value = {
			id: "configured",
			label: deploy ? "Git 同步 + 腾讯私有 release" : "仅 Git 同步",
			remote: env.ADMIN_PUBLISH_REMOTE,
			branch: env.ADMIN_PUBLISH_BRANCH,
			deploy,
			pages: env.ADMIN_PUBLISH_BRANCH === "master",
			mode: "tencent" as const,
		};
		const target = {
			...value,
			fingerprint: hash(
				JSON.stringify({
					...value,
					buildImage: env.ADMIN_BUILD_IMAGE,
					builderEndpoint: env.ADMIN_BUILD_REMOTE_URL,
					dockerEndpoint: env.ADMIN_BUILD_DOCKER_ENDPOINT,
					commentProvider: env.ADMIN_BUILD_COMMENT_PROVIDER,
					walineServer: env.ADMIN_BUILD_WALINE_SERVER_URL,
					releaseHost: env.ADMIN_TENCENT_SSH_HOST,
				}),
			),
		};
		targets.push(target);
		if (deploy)
			releases.set(
				target.id,
				new TencentReleases(env.ADMIN_TENCENT_SSH_HOST as string),
			);
	}
	const mediaOrigins = (env.ADMIN_MEDIA_ORIGINS || "")
		.split(",")
		.filter(Boolean)
		.map((value) => {
			const url = new URL(value);
			if (url.origin !== value || url.protocol !== "https:")
				throw new Error("ADMIN_MEDIA_ORIGINS requires HTTPS origins");
			return value;
		});
	const state = env.ADMIN_EXECUTOR_STATE_ROOT;
	if (!state) return null;
	const provider = env.ADMIN_BUILD_COMMENT_PROVIDER;
	if (provider !== "waline" && provider !== "twikoo")
		throw new Error("ADMIN_BUILD_COMMENT_PROVIDER must be waline or twikoo");
	if (provider === "waline" && !env.ADMIN_BUILD_WALINE_SERVER_URL)
		throw new Error("Waline builds require ADMIN_BUILD_WALINE_SERVER_URL");
	return new JobService(
		{ repository, stateRoot: resolve(state), targets, mediaOrigins },
		drafts,
		env.ADMIN_BUILD_REMOTE_URL
			? new RemoteBuild(
					env.ADMIN_BUILD_REMOTE_URL,
					env.ADMIN_BUILD_REMOTE_TOKEN || "",
					env.ADMIN_BUILD_IMAGE || "",
				)
			: new DockerBuild(
					env.ADMIN_BUILD_IMAGE,
					{
						commentProvider: provider,
						walineServer: env.ADMIN_BUILD_WALINE_SERVER_URL,
					},
					env.ADMIN_BUILD_DOCKER_ENDPOINT,
				),
		releases,
		databaseUrl,
		undefined,
		media,
	);
}
