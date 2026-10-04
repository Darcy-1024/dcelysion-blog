import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AnalyticsConfig, AnalyticsService } from "../server/analytics.js";
import { createApi } from "../server/api.js";
import { JobService } from "../server/jobs.js";
import { OverviewService } from "../server/overview.js";
import { managementFixture } from "./management-fixture.js";
import { FixtureBuild } from "./publish-fixture.js";

export const mockConfig: AnalyticsConfig = {
	key: "SYNTHETIC-UMAMI-KEY-NEVER-EXPOSE",
	websiteId: "db010c0d-422d-49c6-8a89-6a0aa6b79c23",
	region: "",
};
export const mockNow = Date.parse("2026-10-01T12:34:00+08:00");
export function cloudMock() {
	let fault = "";
	const requests: { url: URL; authorization: string }[] = [];
	const fetcher: typeof fetch = async (input, options) => {
		const url = new URL(String(input));
		requests.push({
			url,
			authorization: new Headers(options?.headers).get("authorization") || "",
		});
		if (fault === "timeout")
			return new Promise((_resolve, reject) => {
				options?.signal?.addEventListener(
					"abort",
					() => reject(new Error("synthetic timeout")),
					{ once: true },
				);
			});
		if (["401", "429", "500"].includes(fault))
			return new Response("synthetic upstream error", {
				status: Number(fault),
				headers: { "retry-after": "30" },
			});
		if (fault === "partial" && url.searchParams.get("type") === "browser")
			return new Response("synthetic", { status: 500 });
		const start = Number(url.searchParams.get("startAt"));
		const x = new Date(Math.floor((start + 28800000) / 86400000) * 86400000)
			.toISOString()
			.slice(0, 19)
			.replace("T", " ");
		if (url.pathname.endsWith("/stats"))
			return Response.json({
				pageviews: 120,
				visitors: 7,
				visits: 9,
				bounces: 2,
				totaltime: 120,
				comparison: {
					pageviews: 0,
					visitors: 0,
					visits: 0,
					bounces: 0,
					totaltime: 0,
				},
			});
		if (url.pathname.endsWith("/pageviews"))
			return Response.json({
				pageviews: [{ x, y: 120 }],
				sessions: [{ x, y: 7 }],
			});
		const type = url.searchParams.get("type");
		return Response.json(
			type === "path"
				? [
						{ x: "/posts/example/", y: 90 },
						{ x: "/posts/example/?mode=1", y: 30 },
					]
				: type === "referrer"
					? [
							{ x: "<script>alert(1)</script>", y: 80 },
							{ x: null, y: 40 },
						]
					: [
							{
								x:
									type === "country"
										? "CN"
										: type === "region"
											? "CN-GD"
											: type === "device"
												? "mobile"
												: "Chrome",
								y: 7,
							},
						],
		);
	};
	return {
		fetcher,
		requests,
		setFault: (value: string) => {
			fault = value;
		},
	};
}
export async function analyticsFixture() {
	const f = await managementFixture();
	await writeFile(
		join(f.root, "src/content/posts/draft.md"),
		"---\ntitle: 仓库草稿\npublished: 2026-09-30\ndraft: true\n---\n未公开\n",
	);
	// More private records than one page: summary must use COUNT, never list length.
	const ids: string[] = [];
	for (let index = 0; index < 31; index++) {
		const id = randomUUID();
		ids.push(id);
		await f.db.query(
			"INSERT INTO dc_admin.drafts(id,owner_id,kind,path,content_id,source,last_request,last_payload,creation_payload) VALUES ($1,7,'posts',$2,$3,'private',$1,'fixture','fixture')",
			[id, `private-${index}.md`, `private-${index}`],
		);
	}
	const jobId = randomUUID();
	const target = {
		id: "stage7-fixture",
		label: "隔离只读任务",
		branch: "fixture",
		remote: "unused",
		deploy: false,
		pages: false,
		mode: "local-fixture" as const,
		fingerprint: "fixture",
	};
	await f.db.query(
		"INSERT INTO dc_admin.jobs(id,owner_id,request_hash,draft_id,revision,snapshot,target,kind,status,stage,effects,error) VALUES ($1,7,'fixture',$2,1,'{}',$3,'publish','failed','install',$4,'FIXTURE_INSTALL_FAILED')",
		[
			jobId,
			ids[0],
			JSON.stringify(target),
			JSON.stringify({
				pushed: true,
				installed: false,
				commit: "mock-commit",
				release: "mock-release",
			}),
		],
	);
	await f.db.query(
		"INSERT INTO dc_admin.job_logs(job_id,stage,message) VALUES ($1,'install','模拟：Git推送成功，安装失败')",
		[jobId],
	);
	const jobs = new JobService(
		{
			repository: f.root,
			stateRoot: join(tmpdir(), `stage7-${jobId}`),
			targets: [],
			mediaOrigins: [],
		},
		f.drafts,
		new FixtureBuild(),
		new Map(),
		"",
		f.adapter,
	);
	const mock = cloudMock();
	let analytics = new AnalyticsService(
		mockConfig,
		f.root,
		mock.fetcher,
		() => mockNow,
		5000,
		true,
	);
	const overview = new OverviewService(f.root, f.drafts, f.management);
	let api = createApi(
		f.config,
		f.auth,
		f.drafts,
		jobs,
		null,
		f.management,
		analytics,
		overview,
	);
	return {
		...f,
		mock,
		analytics,
		overview,
		jobId,
		api: (...args: Parameters<typeof api>) => api(...args),
		setAnalyticsMode(mode: string) {
			mock.setFault(
				mode === "error" ? "500" : mode === "partial" ? "partial" : "",
			);
			analytics = new AnalyticsService(
				{ ...mockConfig, key: mode === "unconfigured" ? "" : mockConfig.key },
				f.root,
				mock.fetcher,
				() => mockNow,
				5000,
				true,
			);
			api = createApi(
				f.config,
				f.auth,
				f.drafts,
				jobs,
				null,
				f.management,
				analytics,
				overview,
			);
		},
	};
}
