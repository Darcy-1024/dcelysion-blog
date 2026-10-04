import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../server/api.js";
import type { BuildDriver } from "../server/build.js";
import { hash } from "../server/drafts.js";
import { command, writeControlled } from "../server/executor.js";
import { JobService } from "../server/jobs.js";
import { LocalReleases, type Package } from "../server/releases.js";
import type { Draft } from "../shared/contracts.js";
import type { PublishTarget } from "../shared/publishing.js";
import { fixture } from "./fixture.js";

export const publication =
	"---\ntitle: 发布验收\npublished: 2026-09-30\ndraft: false\n---\n\n保留原文，🙂\n";
export class FixtureBuild implements BuildDriver {
	readonly mode = "fixture" as const;
	fail = false;
	count = 0;
	async available() {
		return true;
	}
	async stop() {}
	async build(directory: string, _id: string, draft: Draft, _preview: boolean) {
		this.count++;
		if (this.fail) {
			this.fail = false;
			throw new Error("fixture build failure");
		}
		const root = join(directory, "artifact");
		const html =
			'<html><head><link rel="stylesheet" href="/_astro/fixture.css"></head><body><h1>fixture 构建 · 非真实 Astro</h1><img src="/_astro/pixel.svg"><script>fetch("/api/me");parent.document.body.innerHTML="unsafe"</script><p>仅隔离发布验收</p></body></html>';
		for (const [name, value] of Object.entries({
			"index.html": html,
			"404.html": "fixture 404",
			"pagefind/pagefind.js": "/* fixture */",
			"_astro/fixture.css": "body{background:#f5f5fc;color:#222}",
			"_astro/pixel.svg":
				'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>',
			[`posts/${draft.contentId}/index.html`]: html,
		}))
			await writeControlled(root, name, value);
		return root;
	}
}
export class FixtureReleases extends LocalReleases {
	fail = false;
	count = 0;
	override async install(info: Package, expected: string | null) {
		this.count++;
		if (this.fail) {
			this.fail = false;
			throw new Error("fixture install failure");
		}
		await super.install(info, expected);
	}
}
export async function publicationFixture(port = 4325) {
	const f = await fixture(port);
	const privateRoot = await mkdtemp(join(tmpdir(), "dc-admin-stage3-"));
	const remote = join(privateRoot, "remote.git");
	await writeFile(join(f.root, "src/content/posts/example.mdx"), publication);
	await writeFile(
		join(f.root, "src/content/dynamic/2026-09-30-120000.md"),
		"---\npublished: 2026-09-30\n---\n\n动态 baseline\n",
	);
	await writeFile(
		join(f.root, "package.json"),
		'{"type":"module","fixture":true}',
	);
	await writeFile(
		join(f.root, ".env"),
		"FIXTURE_SECRET=synthetic-never-export",
	);
	const git = (args: string[]) =>
		command(
			"git",
			[
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@localhost",
				...args,
			],
			f.root,
		);
	await git(["init", "-b", "master"]);
	await git(["add", "--", "src", "package.json"]);
	await git(["commit", "-m", "test: isolated baseline"]);
	await command("git", ["init", "--bare", remote]);
	await git(["push", remote, "HEAD:refs/heads/master"]);
	// Worktree changes must not enter any candidate or build export.
	await writeFile(
		join(f.root, "src/content/posts/workspace-only.md"),
		`${publication}工作区私有内容`,
	);
	const baseline = await readFile(
		join(f.root, "src/content/dynamic/2026-09-30-120000.md"),
		"utf8",
	);
	await writeFile(
		join(f.root, "src/content/dynamic/2026-09-30-120000.md"),
		`${baseline}\n本机未提交改动`,
	);
	const value = {
		id: "isolated",
		label: "隔离 Git + 本地 release",
		remote,
		branch: "master",
		deploy: true,
		pages: false,
		mode: "local-fixture" as const,
	};
	const target: PublishTarget = {
		...value,
		fingerprint: hash(JSON.stringify(value)),
	};
	const builder = new FixtureBuild();
	const releases = new FixtureReleases(join(privateRoot, "site"));
	await mkdir(releases.root, { recursive: true });
	const config = {
		repository: f.root,
		stateRoot: join(privateRoot, "jobs"),
		targets: [target],
		mediaOrigins: [],
	};
	const newJobs = () =>
		new JobService(
			config,
			f.drafts,
			builder,
			new Map([[target.id, releases]]),
			"",
			f.adapter,
		);
	const jobs = newJobs();
	return {
		...f,
		privateRoot,
		target,
		builder,
		releases,
		publicationConfig: config,
		jobs,
		newJobs,
		git,
		api: createApi(f.config, f.auth, f.drafts, jobs),
	};
}
