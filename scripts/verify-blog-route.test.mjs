import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
	makeProbe,
	probeBytes,
	probePath,
	routeHeaders,
	sha256,
	versionPath,
} from "./blog-route-contract.mjs";
import {
	runCli,
	verifyBlogRelease,
	verifyBlogRoutes,
} from "./verify-blog-route.mjs";

const revision = "a".repeat(40);
function fixture(change = () => {}) {
	return async (url, options) => {
		const pathname = url.pathname;
		const version = {
			schema: 1,
			releaseId: `blog-${revision}`,
			sourceRevision: revision,
			publicTreeSha256: "b".repeat(64),
			deploymentEligible: true,
			buildProvenance: "github-actions",
			probe: {
				path: probePath,
				bytes: probeBytes,
				sha256: sha256(makeProbe()),
			},
		};
		const state = {
			url,
			options,
			version,
			headers: {
				...routeHeaders().find((entry) => entry.path === pathname).headers,
			},
			body: pathname === probePath ? makeProbe() : undefined,
			status: 200,
		};
		change(state);
		return new Response(state.body ?? JSON.stringify(version), {
			headers: state.headers,
			status: state.status,
		});
	};
}

test("strict success observes both origins and both homepage CORS origins", async () => {
	const observations = [];
	const result = await verifyBlogRelease(revision, {
		fetchImpl: fixture(({ url, options }) => {
			observations.push(
				`${url.origin} ${options.headers.Origin} ${url.pathname}`,
			);
			assert.equal(options.redirect, "error");
			assert.equal(options.cache, "no-store");
		}),
	});
	assert.equal(result.passed, true);
	assert.deepEqual(result.errors, []);
	assert.equal(new Set(observations).size, 8);
});

test("old revisions remain diagnostic-valid but fail the explicit release target", async () => {
	const fetchImpl = fixture(({ version }) => {
		version.sourceRevision = "c".repeat(40);
		version.releaseId = `blog-${version.sourceRevision}`;
	});
	const diagnostic = await verifyBlogRoutes({ fetchImpl });
	assert.ok(
		diagnostic.every((route) =>
			route.checks.every((check) => check.results.every((r) => r.valid)),
		),
	);
	assert.equal(
		(await verifyBlogRelease(revision, { fetchImpl })).passed,
		false,
	);
});

test("different public trees across sites or homepage origins fail", async () => {
	for (const differs of [
		({ url }) => url.hostname === "blog-eo.dcelysion.cn",
		({ options }) => options.headers.Origin === "https://home.dcelysion.cn",
	]) {
		const result = await verifyBlogRelease(revision, {
			fetchImpl: fixture((state) => {
				if (differs(state)) state.version.publicTreeSha256 = "d".repeat(64);
			}),
		});
		assert.equal(result.passed, false);
		assert.ok(result.errors.some((error) => error.includes("digests differ")));
	}
});

test("unavailable/non-JSON/version and probe contract failures never pass", async () => {
	const failures = [
		() => {
			throw new Error("network unavailable");
		},
		(state) => {
			if (state.url.pathname === versionPath) state.body = "<html>";
		},
		(state) => {
			state.status = 503;
		},
		(state) => {
			if (state.url.pathname === probePath)
				state.body = Buffer.alloc(probeBytes);
		},
		(state) => {
			state.headers["Access-Control-Allow-Origin"] = "https://wrong.example";
		},
		(state) => {
			state.headers["Cache-Control"] = "public";
		},
		(state) => {
			state.version.deploymentEligible = false;
		},
		(state) => {
			state.version.buildProvenance = "unverified";
		},
		(state) => {
			state.version.releaseId = "rehearsal";
		},
		(state) => {
			state.version.probe.bytes = 1;
		},
		(state) => {
			state.version.probe.path = "/wrong.bin";
		},
		(state) => {
			state.version.probe.sha256 = "0".repeat(64);
		},
		(state) => {
			state.version.publicTreeSha256 = "invalid";
		},
	];
	for (const change of failures) {
		assert.equal(
			(await verifyBlogRelease(revision, { fetchImpl: fixture(change) }))
				.passed,
			false,
		);
	}
});

test("CLI distinguishes strict success/failure, diagnostic mode and bad arguments", async () => {
	const output = [];
	const errors = [];
	const options = {
		stdout: (line) => output.push(JSON.parse(line)),
		stderr: (line) => errors.push(line),
		fetchImpl: fixture(),
	};
	assert.equal(await runCli(["--expected-sha", revision], options), 0);
	assert.equal(output.at(-1).passed, true);
	options.fetchImpl = fixture(({ version }) => {
		version.sourceRevision = "c".repeat(40);
	});
	assert.equal(await runCli(["--expected-sha", revision], options), 1);
	assert.equal(output.at(-1).passed, false);
	options.fetchImpl = fixture(() => {
		throw new Error("offline");
	});
	assert.equal(await runCli(["--expected-sha", revision], options), 1);
	assert.equal(await runCli([], options), 0);
	assert.deepEqual(Object.keys(output.at(-1)), ["checkedAt", "routes"]);
	options.fetchImpl = () => {
		throw new Error("must not fetch invalid arguments");
	};
	for (const args of [
		["--expected-sha"],
		["--expected-sha", "abc123"],
		["--expected-sha", "z".repeat(40)],
		["--strict", revision],
		["--expected-sha", revision, "extra"],
	]) {
		assert.equal(await runCli(args, options), 2);
	}
	assert.equal(errors.length, 5);
	await assert.rejects(verifyBlogRelease(), /Full expected commit SHA/);
	const child = spawnSync(
		process.execPath,
		["scripts/verify-blog-route.mjs", "--expected-sha", "short"],
		{ encoding: "utf8" },
	);
	assert.equal(child.status, 2);
	assert.match(child.stderr, /Usage:/);
});
