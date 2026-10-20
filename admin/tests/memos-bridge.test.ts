import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { encodeMemosRefresh, MemosBridge } from "../server/memos-bridge.js";

const adminOrigin = "https://admin.example.test";
const memosOrigin = "https://memos.example.test";
const owner = { id: 7, name: "Owner", version: 3 };
const credentials = {
	username: "writer",
	password: "fixture-private-password",
	expectedUser: "users/writer",
};
const initialToken = "ey.fixture.initial";
const refreshedToken = "ey.fixture.refreshed";
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture(
	t: test.TestContext,
	options: { maxBodyBytes?: number; maxResponseBytes?: number } = {},
) {
	let now = Date.parse("2026-10-19T00:00:00.000Z");
	const f = {
		valid: true,
		offline: false,
		role: "USER",
		user: "users/writer",
		username: "writer",
		redirect: false,
		responseSize: 0,
		identityCheck: null as (() => Promise<void>) | null,
		calls: [] as { url: string; init: RequestInit }[],
		advance: (ms: number) => {
			now += ms;
		},
	};
	const fetcher: typeof fetch = async (input, init = {}) => {
		const url = String(input);
		f.calls.push({ url, init });
		assert.equal(init.redirect, "error");
		assert.ok(url.startsWith("http://127.0.0.1:5231/"));
		if (f.redirect)
			return new Response(null, {
				status: 302,
				headers: { location: "https://outside.invalid/steal" },
			});
		if (url.endsWith("/api/v1/auth/signin")) {
			assert.deepEqual(JSON.parse(String(init.body)), {
				passwordCredentials: {
					username: credentials.username,
					password: credentials.password,
				},
			});
			return Response.json(
				{
					user: { name: f.user, username: f.username, role: f.role },
					accessToken: initialToken,
					accessTokenExpiresAt: new Date(now + 900000).toISOString(),
				},
				{
					headers: {
						"grpc-metadata-set-cookie":
							"memos_refresh=refresh.initial; Path=/; HttpOnly; SameSite=Lax",
					},
				},
			);
		}
		if (url.endsWith("/api/v1/auth/refresh")) {
			assert.match(
				new Headers(init.headers).get("cookie") || "",
				/^memos_refresh=refresh\./u,
			);
			return Response.json(
				{
					accessToken: refreshedToken,
					expiresAt: new Date(now + 900000).toISOString(),
				},
				{
					headers: {
						"grpc-metadata-set-cookie":
							"memos_refresh=refresh.rotated; Path=/; HttpOnly; SameSite=Lax",
					},
				},
			);
		}
		if (url.endsWith("/api/v1/auth/me")) {
			await f.identityCheck?.();
			return Response.json({
				user: { name: f.user, username: f.username, role: f.role },
			});
		}
		if (url.endsWith("/api/v1/auth/signout")) return Response.json({});
		return new Response(
			f.responseSize ? "a".repeat(f.responseSize) : "original-memos-response",
			{
				headers: {
					"content-type": "text/html",
					"set-cookie": "memos_refresh=must-not-leak; Path=/",
					"content-security-policy":
						"default-src 'self'; frame-ancestors 'none'; object-src 'none', script-src 'self'; frame-ancestors 'self'",
					"x-frame-options": "DENY",
					"cache-control": "public, max-age=300",
				},
			},
		);
	};
	const bridge = new MemosBridge({
		adminOrigin,
		memosOrigin,
		upstream: "http://127.0.0.1:5231",
		credentials,
		verify: async (token) => {
			if (f.offline) throw new Error("private DB diagnostic");
			return f.valid && token === "admin-session" ? owner : null;
		},
		fetcher,
		now: () => now,
		...options,
	});
	const server = createServer((req, res) => {
		void bridge.handle(req, res);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	t.after(async () => {
		await bridge.close();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	const request = (route: string, init: RequestInit = {}): Promise<Response> =>
		new Promise((resolve, reject) => {
			const req = httpRequest(
				base + route,
				{
					method: init.method || "GET",
					headers: {
						host: "memos.example.test",
						...Object.fromEntries(new Headers(init.headers)),
					},
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on("data", (chunk: Buffer) => chunks.push(chunk));
					res.once("end", () => {
						const headers = new Headers();
						for (const [key, value] of Object.entries(res.headers)) {
							if (Array.isArray(value))
								for (const entry of value) headers.append(key, entry);
							else if (value !== undefined) headers.set(key, value);
						}
						resolve(
							new Response(Buffer.concat(chunks), {
								status: res.statusCode,
								headers,
							}),
						);
					});
				},
			);
			req.once("error", reject);
			req.end(init.body as string | Uint8Array | undefined);
		});
	const ticket = () => bridge.issueTicket("admin-session", owner);
	const entry = async (value: string, origin = adminOrigin) =>
		request("/_bridge/entry", {
			method: "POST",
			headers: {
				origin,
				"content-type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({ ticket: value }).toString(),
		});
	const login = async () => {
		const response = await entry(await ticket());
		assert.equal(response.status, 303);
		const header = response.headers.get("set-cookie");
		assert.ok(header);
		return header.split(";")[0];
	};
	return Object.assign(f, { bridge, request, ticket, entry, login });
}
function upstreamCalls(f: Fixture, suffix: string) {
	return f.calls.filter((call) => call.url.endsWith(suffix));
}

test("Memos bridge refuses unauthenticated HTML, Connect, REST, attachment and share requests despite supplied tokens", async (t) => {
	const f = await fixture(t);
	for (const route of [
		"/",
		"/assets/app.js",
		"/api/v1/memos",
		"/file/attachments/a/photo.jpg",
		"/share/opaque?share_token=known",
		"/memos.api.v1.MemoService/ListMemos",
	]) {
		const response = await f.request(route, {
			headers: {
				authorization: "Bearer attacker-PAT",
				cookie: "memos_refresh=attacker.refresh",
			},
		});
		assert.equal(response.status, 401, route);
	}
	assert.equal(f.calls.length, 0);
});

test("30-second ticket is single use, bound to admin identity, and invalid-origin POST cannot consume it", async (t) => {
	const f = await fixture(t);
	const ticket = await f.ticket();
	assert.equal((await f.entry(ticket, "https://evil.invalid")).status, 403);
	const response = await f.entry(ticket);
	assert.equal(response.status, 303);
	assert.equal(response.headers.get("location"), "/");
	assert.match(
		response.headers.get("set-cookie") || "",
		/^__Host-dc_memos_bridge=[A-Za-z0-9_-]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/u,
	);
	assert.equal((await f.entry(ticket)).status, 401);
	const expired = await f.ticket();
	f.advance(30001);
	assert.equal((await f.entry(expired)).status, 401);
	await assert.rejects(
		f.bridge.issueTicket("admin-session", { ...owner, version: 4 }),
	);
	const revoked = await f.ticket();
	f.valid = false;
	assert.equal((await f.entry(revoked)).status, 401);
	assert.equal(upstreamCalls(f, "/api/v1/auth/signin").length, 1);
});

test("ordinary author identity is exact: wrong user, username and ADMIN are denied and cleaned up", async (t) => {
	for (const setting of [
		{ user: "users/other" },
		{ username: "other" },
		{ role: "ADMIN" },
	]) {
		const f = await fixture(t);
		Object.assign(f, setting);
		assert.equal((await f.entry(await f.ticket())).status, 403);
		assert.equal(upstreamCalls(f, "/api/v1/auth/signout").length, 1);
	}
});

test("proxy replaces browser credentials, preserves CSP restrictions, and suppresses upstream cookies/cache", async (t) => {
	const f = await fixture(t);
	const cookie = await f.login();
	const response = await f.request("/file/attachments/a/photo.jpg", {
		headers: {
			cookie: `${cookie}; memos_refresh=evil`,
			authorization: "Bearer evil-PAT",
		},
	});
	assert.equal(response.status, 200);
	assert.equal(await response.text(), "original-memos-response");
	const last = f.calls.at(-1);
	assert.ok(last);
	const headers = new Headers(last.init.headers);
	assert.equal(headers.get("authorization"), `Bearer ${initialToken}`);
	assert.equal(headers.get("cookie"), "memos_refresh=refresh.initial");
	assert.equal(response.headers.get("set-cookie"), null);
	assert.equal(response.headers.get("x-frame-options"), null);
	assert.equal(response.headers.get("cache-control"), "private, no-store");
	const csp = response.headers.get("content-security-policy") || "";
	assert.ok(csp.includes("default-src 'self'"));
	assert.ok(csp.includes("object-src 'none'"));
	assert.ok(csp.includes("script-src 'self'"));
	assert.equal(
		(csp.match(/frame-ancestors https:\/\/admin\.example\.test/gu) || [])
			.length,
		2,
	);
	assert.ok(!csp.includes("frame-ancestors 'none'"));
});

test("logout/revocation/verification outage close API and new-window access without direct-token bypass", async (t) => {
	const f = await fixture(t);
	const cookie = await f.login();
	f.offline = true;
	const unavailable = await f.request("/", { headers: { cookie } });
	assert.equal(unavailable.status, 503);
	assert.ok(!(await unavailable.text()).includes("private DB"));
	f.offline = false;
	f.valid = false;
	assert.equal(
		(
			await f.request("/api/v1/memos", {
				headers: { cookie, authorization: `Bearer ${initialToken}` },
			})
		).status,
		401,
	);
	f.valid = true;
	assert.equal((await f.request("/", { headers: { cookie } })).status, 401);
	assert.equal(upstreamCalls(f, "/api/v1/auth/signout").length, 1);
});

test("Connect RefreshToken uses exact unary protobuf fields without gRPC framing", async (t) => {
	const f = await fixture(t);
	const cookie = await f.login();
	const response = await f.request("/memos.api.v1.AuthService/RefreshToken", {
		method: "POST",
		headers: {
			cookie,
			origin: memosOrigin,
			"content-type": "application/proto",
			"connect-protocol-version": "1",
		},
		body: new Uint8Array(),
	});
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("content-type"), "application/proto");
	const bytes = Buffer.from(await response.arrayBuffer());
	assert.equal(bytes[0], 0x0a);
	assert.equal(bytes[1], Buffer.byteLength(initialToken));
	assert.equal(bytes.subarray(2, 2 + bytes[1]).toString(), initialToken);
	const offset = 2 + bytes[1];
	assert.equal(bytes[offset], 0x12);
	assert.equal(bytes[offset + 2], 0x08);
	let seconds = 0n;
	let shift = 0n;
	for (let i = offset + 3; i < bytes.length; i++) {
		seconds |= BigInt(bytes[i] & 127) << shift;
		if (!(bytes[i] & 128)) break;
		shift += 7n;
	}
	assert.equal(Number(seconds), Date.parse("2026-10-19T00:15:00Z") / 1000);
	// Independently known protobuf fixture: token='x', Timestamp(seconds=1,nanos=1e6).
	assert.equal(
		encodeMemosRefresh("x", 1001).toString("hex"),
		"0a01781206080110c0843d",
	);
});

test("refresh rotates server cookie, coalesces concurrent refresh, verifies role, and supports JSON", async (t) => {
	const f = await fixture(t);
	const cookie = await f.login();
	f.advance(850000);
	const request = () =>
		f.request("/api/v1/auth/refresh", {
			method: "POST",
			headers: {
				cookie,
				origin: memosOrigin,
				"content-type": "application/json",
			},
			body: "{}",
		});
	const results = await Promise.all([request(), request()]);
	assert.ok(results.every((response) => response.status === 200));
	assert.equal((await results[0].json()).accessToken, refreshedToken);
	assert.equal(upstreamCalls(f, "/api/v1/auth/refresh").length, 1);
	assert.equal(upstreamCalls(f, "/api/v1/auth/me").length, 1);
	await f.request("/", { headers: { cookie } });
	const last = f.calls.at(-1);
	assert.ok(last);
	assert.equal(
		new Headers(last.init.headers).get("cookie"),
		"memos_refresh=refresh.rotated",
	);
	f.role = "ADMIN";
	f.advance(850000);
	assert.equal((await request()).status, 403);
	assert.equal((await f.request("/", { headers: { cookie } })).status, 401);
});

test("concurrent business requests cannot pass a pending failed refresh identity check", async (t) => {
	const f = await fixture(t);
	const cookie = await f.login();
	f.advance(850000);
	f.role = "ADMIN";
	let checking: () => void = () => {};
	let release: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		checking = resolve;
	});
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.identityCheck = async () => {
		checking();
		await held;
	};
	const refresh = f.request("/api/v1/auth/refresh", {
		method: "POST",
		headers: {
			cookie,
			origin: memosOrigin,
			"content-type": "application/json",
		},
		body: "{}",
	});
	await started;
	const business = f.request("/file/attachments/a/photo.jpg", {
		headers: { cookie },
	});
	// Give the competing request an event-loop turn while identity proof is held.
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.equal(upstreamCalls(f, "/file/attachments/a/photo.jpg").length, 0);
	release();
	assert.equal((await refresh).status, 403);
	assert.ok([401, 403].includes((await business).status));
	assert.equal(upstreamCalls(f, "/file/attachments/a/photo.jpg").length, 0);
	assert.equal((await f.request("/", { headers: { cookie } })).status, 401);
});

test("Memos SignOut revokes the bridge; local signin, PAT/user management and foreign-origin writes stay blocked", async (t) => {
	const f = await fixture(t);
	const cookie = await f.login();
	for (const route of [
		"/api/v1/auth/signin",
		"/memos.api.v1.AuthService/SignIn",
		"/memos.api.v1.UserService/CreatePersonalAccessToken",
		"/memos.api.v1.UserService/UpdateUser",
		"/api/v1/users/writer/personalAccessTokens",
		"/api/v1/users/writer/%70ersonalAccessTokens",
	]) {
		assert.equal(
			(
				await f.request(route, {
					method: "POST",
					headers: {
						cookie,
						origin: memosOrigin,
						"content-type": "application/json",
					},
					body: "{}",
				})
			).status,
			403,
			route,
		);
	}
	assert.equal(
		(
			await f.request("/memos.api.v1.MemoService/CreateMemo", {
				method: "POST",
				headers: { cookie, origin: adminOrigin },
				body: "{}",
			})
		).status,
		403,
	);
	const logout = await f.request("/memos.api.v1.AuthService/SignOut", {
		method: "POST",
		headers: {
			cookie,
			origin: memosOrigin,
			"content-type": "application/proto",
		},
		body: new Uint8Array(),
	});
	assert.equal(logout.status, 200);
	assert.equal((await logout.arrayBuffer()).byteLength, 0);
	assert.equal((await f.request("/", { headers: { cookie } })).status, 401);
});

test("requests and responses are bounded, redirects never transfer credentials, restart loses bridge sessions", async (t) => {
	const f = await fixture(t, { maxBodyBytes: 64, maxResponseBytes: 64 });
	const cookie = await f.login();
	assert.equal(
		(
			await f.request("/memos.api.v1.MemoService/CreateMemo", {
				method: "POST",
				headers: { cookie, origin: memosOrigin },
				body: "x".repeat(65),
			})
		).status,
		413,
	);
	f.responseSize = 65;
	assert.equal((await f.request("/", { headers: { cookie } })).status, 502);
	f.redirect = true;
	assert.equal((await f.request("/", { headers: { cookie } })).status, 502);
	const other = await fixture(t);
	assert.equal((await other.request("/", { headers: { cookie } })).status, 401);
	assert.equal(other.calls.length, 0);
});

test("constructor refuses non-loopback upstream, shared origin and missing credentials", () => {
	const config = {
		adminOrigin,
		memosOrigin,
		upstream: "http://127.0.0.1:5231",
		credentials,
		verify: async () => owner,
	};
	assert.throws(
		() => new MemosBridge({ ...config, upstream: "http://memos.example.test" }),
	);
	assert.throws(() => new MemosBridge({ ...config, memosOrigin: adminOrigin }));
	assert.throws(() => new MemosBridge({ ...config, credentials: undefined }));
});
