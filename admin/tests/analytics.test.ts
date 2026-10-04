import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
	AnalyticsService,
	analyticsRange,
	analyticsSettings,
	mapRanks,
	mapStats,
	mapTrend,
} from "../server/analytics.js";
import { change } from "../shared/analytics.js";
import {
	analyticsFixture,
	cloudMock,
	mockConfig,
	mockNow,
} from "./analytics-fixture.js";
import { listenLocal } from "./local-listener.js";

test("Self-hosted 3.4 PostgreSQL: explicit endpoint, scoped bearer and Shanghai wall-clock buckets", async () => {
	const config = analyticsSettings({
		ADMIN_UMAMI_SOURCE: "self-hosted",
		ADMIN_UMAMI_ENDPOINT: "http://127.0.0.1:18300/api",
		ADMIN_UMAMI_WEBSITE_ID: mockConfig.websiteId,
		ADMIN_UMAMI_API_KEY: "selfhost-test-key",
	});
	for (const endpoint of [
		"http://remote/api",
		"https://stats.invalid/api?x=1",
		"https://u:p@stats.invalid/api",
		"https://stats.invalid/wrong",
	]) {
		assert.throws(() =>
			analyticsSettings({
				ADMIN_UMAMI_SOURCE: "self-hosted",
				ADMIN_UMAMI_WEBSITE_ID: mockConfig.websiteId,
				ADMIN_UMAMI_ENDPOINT: endpoint,
			}),
		);
	}
	assert.throws(() =>
		analyticsSettings({
			ADMIN_UMAMI_SOURCE: "self-hosted",
			ADMIN_UMAMI_ENDPOINT: "https://stats.invalid/api",
		}),
	);
	const mock = cloudMock();
	const fetcher: typeof fetch = async (input, options) => {
		const url = new URL(String(input));
		assert.equal(url.origin, "http://127.0.0.1:18300");
		assert.ok(url.pathname.startsWith(`/api/websites/${config.websiteId}/`));
		assert.equal(
			new Headers(options?.headers).get("authorization"),
			"Bearer selfhost-test-key",
		);
		if (url.pathname.endsWith("/pageviews"))
			return Response.json({
				pageviews: [{ x: "2026-10-01T00:00:00Z", y: 2 }],
				sessions: [{ x: "2026-10-01T00:00:00Z", y: 1 }],
			});
		return mock.fetcher(input, options);
	};
	const report = await new AnalyticsService(
		config,
		"unused",
		fetcher,
		() => mockNow,
	).report(new URLSearchParams("range=7d"));
	assert.equal(report.state, "success");
	assert.equal(report.source, "Umami 自建");
	assert.equal(report.trend.data?.pageviews[0].x, "2026-10-01 00:00:00");
	assert.equal(JSON.stringify(report).includes(config.key), false);
	const denied = await new AnalyticsService(
		config,
		"unused",
		async () => new Response("", { status: 401 }),
		() => mockNow,
	).report(new URLSearchParams());
	assert.equal(denied.stats.reason, "CREDENTIALS");
	assert.equal(denied.stats.data, null);
});

test("Cloud ranges/mapping: Shanghai, inclusive equal periods, strict dates, whole-period UV and zero comparison", () => {
	const today = analyticsRange(new URLSearchParams(), mockNow);
	assert.equal(today.startAt, Date.parse("2026-10-01T00:00:00+08:00"));
	assert.equal(today.previousStart, Date.parse("2026-09-30T00:00:00+08:00"));
	assert.equal(
		today.previousEnd - today.previousStart,
		today.endAt - today.startAt,
	);
	assert.equal(
		analyticsRange(new URLSearchParams("range=7d"), mockNow).startAt,
		today.startAt - 6 * 86400000,
	);
	const midnight = analyticsRange(new URLSearchParams(), today.startAt);
	assert.equal(midnight.endAt, midnight.startAt);
	for (const query of [
		"range=nope",
		"range=custom&start=2026-02-30&end=2026-03-01",
		"range=custom&start=2026-10-02&end=2026-10-01",
		"range=custom&start=2026-06-01&end=2026-10-01",
		"range=custom&start=2026-10-01&end=2026-10-02",
		"websiteId=x",
		"endpoint=https://evil.invalid",
		"range=today&range=7d",
	])
		assert.throws(() => analyticsRange(new URLSearchParams(query), mockNow));
	assert.equal(
		mapStats({ pageviews: 120, visitors: 7, visits: 9 }).visitors,
		7,
	);
	assert.throws(() => mapStats({ pageviews: null, visitors: 7, visits: 9 }));
	assert.throws(() =>
		mapStats({
			pageviews: { value: 12 },
			visitors: { value: 7 },
			visits: { value: 9 },
		}),
	);
	const trend = mapTrend(
		{
			pageviews: [{ x: "2026-10-01 00:00:00", y: 0 }],
			sessions: [
				{ x: "2026-10-01 00:00:00", y: 5 },
				{ x: "2026-10-01 01:00:00", y: 5 },
			],
		},
		today,
	);
	assert.equal(
		trend.visitors.reduce((sum, row) => sum + row.y, 0),
		10,
	); // Distinct per bucket is not period UV=7.
	assert.equal(trend.pageviews.length, 1); // Missing buckets are not zeros.
	assert.throws(() =>
		mapTrend(
			{
				pageviews: [
					{ x: "2026-10-01 00:00:00", y: 1 },
					{ x: "2026-10-01 00:00:00", y: 2 },
				],
				sessions: [],
			},
			today,
		),
	);
	assert.throws(() => mapRanks([{ x: "x", y: -1 }]));
	assert.equal(change(4, 0), "new");
	assert.equal(change(0, 0), "no_comparison");
	assert.equal(change(0, 4), "-100.0%");
	assert.throws(() => analyticsSettings({ ADMIN_UMAMI_REGION: "http://evil" }));
});

test("Cloud auth/request contract, concurrent cache merge/isolation and exact title mapping", async () => {
	const f = await analyticsFixture();
	try {
		const [first, same] = await Promise.all([
			f.analytics.report(new URLSearchParams("range=7d")),
			f.analytics.report(new URLSearchParams("range=7d")),
		]);
		assert.equal(first.state, "success");
		assert.equal(same.stats.data?.visitors, 7);
		assert.equal(f.mock.requests.length, 9);
		for (const call of f.mock.requests) {
			assert.equal(call.url.origin, "https://api.umami.is");
			assert.ok(
				call.url.pathname.startsWith(`/v1/websites/${mockConfig.websiteId}/`),
			);
			assert.equal(call.authorization, `Bearer ${mockConfig.key}`);
			assert.equal(call.url.searchParams.get("timezone"), "Asia/Shanghai");
			assert.equal(call.url.searchParams.get("unit"), "day");
			assert.ok(Number(call.url.searchParams.get("endAt")) <= mockNow);
			assert.equal(call.url.toString().includes(mockConfig.key), false);
		}
		assert.equal(first.ranks.path.data?.[0].title, "原标题");
		assert.equal(first.ranks.path.data?.[1].title, undefined);
		await f.analytics.report(new URLSearchParams("range=7d"));
		assert.equal(f.mock.requests.length, 9);
		await f.analytics.report(new URLSearchParams("range=30d"));
		assert.equal(f.mock.requests.length, 18);
		assert.equal(JSON.stringify(first).includes(mockConfig.key), false);
		const other = new AnalyticsService(
			{
				...mockConfig,
				key: "different",
				websiteId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
				region: "eu",
			},
			f.root,
			f.mock.fetcher,
			() => mockNow,
		);
		await other.report(new URLSearchParams("range=7d"));
		assert.equal(f.mock.requests.length, 27);
		assert.ok(
			f.mock.requests[26].url.pathname.startsWith("/v1/eu/websites/aaaaaaaa"),
		);
	} finally {
		await f.db.close();
	}
});

test("Cloud degradation: not configured, 401, 429 Retry-After, abort timeout, partial and bounded stale", async () => {
	const absent = await new AnalyticsService(
		{ ...mockConfig, key: "" },
		"unused",
		async () => {
			throw new Error("must not call");
		},
		() => mockNow,
	).report(new URLSearchParams());
	assert.equal(absent.state, "not_configured");
	assert.equal(absent.stats.data, null);
	for (const [fault, code] of [
		["401", "CREDENTIALS"],
		["429", "RATE_LIMIT"],
		["timeout", "TIMEOUT"],
		["partial", "UPSTREAM"],
	]) {
		const mock = cloudMock();
		mock.setFault(fault);
		const service = new AnalyticsService(
			mockConfig,
			"unused",
			mock.fetcher,
			() => mockNow,
			15,
		);
		// Keep event loop alive for AbortSignal.timeout in the mocked transport.
		const keepAlive = setInterval(() => {}, 1000);
		try {
			const report = await service.report(new URLSearchParams());
			assert.equal(
				fault === "partial" ? report.ranks.browser.reason : report.stats.reason,
				code,
			);
			assert.equal(report.state, fault === "partial" ? "partial" : "error");
			if (fault === "429") {
				assert.equal(report.retryAt, new Date(mockNow + 30000).toISOString());
				const before = mock.requests.length;
				await service.report(new URLSearchParams("range=7d"));
				assert.equal(mock.requests.length, before);
			}
		} finally {
			clearInterval(keepAlive);
		}
	}
	const mock = cloudMock();
	let now = mockNow;
	const service = new AnalyticsService(
		mockConfig,
		"unused",
		mock.fetcher,
		() => now,
	);
	await service.report(new URLSearchParams());
	now += 61000;
	mock.setFault("500");
	const stale = await service.report(new URLSearchParams());
	assert.equal(stale.stats.state, "stale");
	assert.equal(stale.stats.interval?.endAt, mockNow);
	assert.equal(stale.stats.sampledAt, new Date(mockNow).toISOString());
	now += 600001;
	const expired = await service.report(new URLSearchParams());
	assert.equal(expired.stats.state, "error");
	assert.equal(expired.stats.data, null);
});

test("protected overview/API: total semantics, private/repository drafts, persisted push/install distinction, host and session revocation", async () => {
	const f = await analyticsFixture();
	const server = createServer(
		(req, res) =>
			void f.api(req, res, new URL(req.url || "/", f.config.origin)),
	);
	const address = await listenLocal(server);
	f.config.origin = `http://127.0.0.1:${address.port}`;
	let cookie = "";
	const call = (path: string, body?: unknown) =>
		fetch(f.config.origin + path, {
			headers: {
				cookie,
				origin: f.config.origin,
				"content-type": "application/json",
			},
			...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
		});
	try {
		for (const route of [
			"/api/analytics",
			"/api/overview",
			"/api/overview/host",
		])
			assert.equal((await call(route)).status, 401);
		const login = await call("/api/login", {
			identity: "preview",
			password: "preview",
			code: "123456",
		});
		cookie = login.headers.get("set-cookie")?.split(";")[0] || "";
		const response = await call("/api/overview");
		assert.equal(response.headers.get("cache-control"), "no-store");
		const { data } = await response.json();
		assert.deepEqual(data.content.data.posts, { public: 1, draft: 1 });
		assert.equal(data.drafts.data.posts, 31);
		assert.equal(data.comments.data.total, 3);
		assert.equal(data.comments.data.waiting, 1);
		assert.equal(data.comments.data.users, 2);
		assert.equal(data.jobs.data.counts.failed, 1);
		assert.equal(data.jobs.data.recent[0].effects.pushed, true);
		assert.equal(data.jobs.data.recent[0].effects.installed, false);
		assert.ok(data.host.data.processMemory.rss > 0);
		assert.ok(
			data.host.data.systemMemory.free <= data.host.data.systemMemory.total,
		);
		assert.ok(
			data.host.data.cpuPercent === null ||
				(data.host.data.cpuPercent >= 0 && data.host.data.cpuPercent <= 100),
		);
		assert.ok(["success", "error"].includes(data.host.data.disk.state));
		assert.equal((await call("/api/analytics?websiteId=evil")).status, 400);
		assert.equal((await call("/api/overview?endpoint=evil")).status, 400);
		const text = await (await call("/api/analytics")).text();
		assert.equal(text.includes(mockConfig.key), false);
		assert.ok(!text.includes("Authorization"));
		await call("/api/logout", {});
		assert.equal((await call("/api/analytics")).status, 401);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await f.db.close();
	}
});
