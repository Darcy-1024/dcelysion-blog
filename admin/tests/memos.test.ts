import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createApi } from "../server/api.js";
import type { AuthService } from "../server/auth.js";
import { readConfig } from "../server/config.js";
import { adminCsp, memosOrigin } from "../server/memos.js";
import type { MemosBridge } from "../server/memos-bridge.js";

test("Memos origin is one exact separate HTTPS origin; CSP preserves admin protections", () => {
	const admin = "https://admin.example.invalid";
	const origin = "https://memos.example.invalid";
	assert.equal(memosOrigin("", admin), "");
	assert.equal(memosOrigin(origin, admin), origin);
	for (const value of [
		admin,
		"http://memos.example.invalid",
		`${origin}/`,
		`${origin}/api`,
		`${origin}?token=secret`,
		`${origin}#token`,
		"https://name:secret@memos.example.invalid",
		"javascript:alert(1)",
		"https://memos.invalid;frame-src",
	]) {
		assert.throws(() => memosOrigin(value, admin));
	}
	const policy = adminCsp(origin);
	assert.ok(policy.includes(`frame-src 'self' ${origin};`));
	assert.ok(policy.includes("connect-src 'self';"));
	assert.ok(policy.includes("frame-ancestors 'none';"));
	assert.ok(!policy.includes("https:; frame"));
	assert.ok(!adminCsp().includes(origin));
	assert.ok(adminCsp(origin, true).includes(`form-action 'self' ${origin}`));
	assert.ok(!adminCsp(origin).includes(`form-action 'self' ${origin}`));
});

test("Memos bridge stays disabled by default and rejects public upstream/listener", () => {
	const base = {
		ADMIN_ORIGIN: "https://admin.example.invalid",
		ADMIN_MEMOS_ORIGIN: "https://memos.example.invalid",
	};
	assert.equal(readConfig(base).memosBridge, undefined);
	const enabled = {
		...base,
		ADMIN_MEMOS_BRIDGE_ENABLED: "1",
		ADMIN_MEMOS_CREDENTIALS_FILE: "cache/synthetic-credentials.json",
	};
	assert.equal(
		readConfig(enabled).memosBridge?.upstream,
		"http://127.0.0.1:5231",
	);
	assert.equal(
		readConfig({
			...enabled,
			ADMIN_MEMOS_UPSTREAM: "http://dc-memos-origin:5230",
		}).memosBridge?.upstream,
		"http://dc-memos-origin:5230",
	);
	assert.equal(
		readConfig({
			...enabled,
			ADMIN_MEMOS_GATEWAY_HOST: "0.0.0.0",
			ADMIN_MEMOS_GATEWAY_CONTAINER_ONLY: "1",
		}).memosBridge?.host,
		"0.0.0.0",
	);
	for (const extra of [
		{ ADMIN_MEMOS_GATEWAY_HOST: "0.0.0.0" },
		{ ADMIN_MEMOS_UPSTREAM: "http://169.254.169.254" },
		{ ADMIN_MEMOS_UPSTREAM: "http://127.0.0.1:5231/other" },
		{ ADMIN_MEMOS_UPSTREAM: "http://dc-memos-origin:5230@evil.invalid" },
		{ ADMIN_MEMOS_UPSTREAM: "http://other-container:5230" },
		{ ADMIN_MEMOS_GATEWAY_PORT: "4322" },
	]) {
		assert.throws(() => readConfig({ ...enabled, ...extra }));
	}
});

test("Memos entry requires the existing admin session and stays gated pending unified auth", async (t) => {
	const config = readConfig({
		ADMIN_ORIGIN: "https://admin.example.invalid",
		ADMIN_MEMOS_ORIGIN: "https://memos.example.invalid",
	});
	let valid = false;
	const auth = {
		verify: async (token: string) =>
			valid && token === "synthetic-session"
				? { id: 7, name: "Fixture" }
				: null,
	} as unknown as AuthService;
	const api = createApi(config, auth, null, null, null, null);
	const server = createServer((req, res) => {
		void api(req, res, new URL(req.url || "/", config.origin));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(
		() =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	);
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}/api/memos`;
	assert.equal((await fetch(url)).status, 401);
	valid = true;
	const response = await fetch(url, {
		headers: { cookie: "__Host-dc_admin=synthetic-session" },
	});
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.deepEqual(await response.json(), {
		ok: true,
		data: { origin: config.memosOrigin, access: "awaiting-unified-auth" },
	});
	valid = false;
	assert.equal(
		(
			await fetch(url, {
				headers: { cookie: "__Host-dc_admin=synthetic-session" },
			})
		).status,
		401,
	);
});

test("enabled bridge entry is still guarded by the original admin session and POST Origin", async (t) => {
	const config = readConfig({
		ADMIN_ORIGIN: "https://admin.example.invalid",
		ADMIN_MEMOS_ORIGIN: "https://memos.example.invalid",
	});
	let valid = true;
	let issued = 0;
	const auth = {
		verify: async (token: string) =>
			valid && token === "synthetic-session"
				? { id: 7, name: "Fixture", version: 3 }
				: null,
	} as unknown as AuthService;
	const bridge = {
		issueTicket: async (token: string, owner: { id: number }) => {
			assert.equal(token, "synthetic-session");
			assert.equal(owner.id, 7);
			issued++;
			return "synthetic-once-only-ticket";
		},
	} as unknown as MemosBridge;
	const api = createApi(
		config,
		auth,
		null,
		null,
		null,
		null,
		undefined,
		undefined,
		bridge,
	);
	const server = createServer((req, res) => {
		void api(req, res, new URL(req.url || "/", config.origin));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(
		() =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	);
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}/api/memos`;
	const headers = {
		cookie: "__Host-dc_admin=synthetic-session",
		origin: config.origin,
		"content-type": "application/json",
	};
	const entry = () =>
		fetch(`${url}/entry`, { method: "POST", headers, body: "{}" });
	assert.equal(
		(await (await fetch(url, { headers })).json()).data.access,
		"unified-session",
	);
	assert.equal(
		(
			await fetch(`${url}/entry`, {
				method: "POST",
				headers: { ...headers, origin: "https://evil.invalid" },
				body: "{}",
			})
		).status,
		403,
	);
	assert.equal((await entry()).status, 200);
	assert.equal(issued, 1);
	valid = false;
	assert.equal((await entry()).status, 401);
	assert.equal(issued, 1);
});
