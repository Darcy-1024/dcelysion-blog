import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Owner } from "./auth.js";
import { memosUpstream } from "./memos.js";
import type { MemosFrontend } from "./memos-frontend.js";

export type MemosCredentials = {
	username: string;
	password: string;
	expectedUser: string;
};
export type MemosBridgeOptions = {
	adminOrigin: string;
	memosOrigin: string;
	upstream: string;
	credentialsFile?: string;
	credentials?: MemosCredentials;
	frontend?: MemosFrontend;
	verify: (token: string) => Promise<Owner | null>;
	fetcher?: typeof fetch;
	now?: () => number;
	/** Bounded overrides for isolated fixtures and smaller installations. */
	maxBodyBytes?: number;
	maxResponseBytes?: number;
	timeoutMs?: number;
};
type Identity = { adminToken: string; owner: Owner; expires: number };
type BridgeSession = Identity & {
	expectedUser: string;
	username: string;
	accessToken: string;
	accessExpires: number;
	refreshCookie: string;
	refreshing?: Promise<void>;
};
const cookieName = "__Host-dc_memos_bridge";
const authProcedure = "/memos.api.v1.AuthService/";
const refreshPaths = new Set([
	`${authProcedure}RefreshToken`,
	"/api/v1/auth/refresh",
]);
const signoutPaths = new Set([
	`${authProcedure}SignOut`,
	"/api/v1/auth/signout",
]);
const safeUserMethods = new Set([
	"GetUser",
	"BatchGetUsers",
	"GetUserStats",
	"ListAllUserStats",
	"GetUserSetting",
	"ListUserSettings",
	"UpdateUserSetting",
	"ListMemoViews",
	"GetMemoView",
	"CreateMemoView",
	"UpdateMemoView",
	"DeleteMemoView",
]);
const profileFields = new Set([
	"display_name",
	"email",
	"avatar_url",
	"description",
]);
const updateUserPath = "/memos.api.v1.UserService/UpdateUser";
const utf8 = new TextDecoder("utf-8", { fatal: true });
function protobufFields(
	bytes: Uint8Array,
): Array<{ field: number; value: Uint8Array }> {
	const fields: Array<{ field: number; value: Uint8Array }> = [];
	let offset = 0;
	const varint = (): number => {
		let value = 0;
		for (let shift = 0; shift <= 28 && offset < bytes.length; shift += 7) {
			const byte = bytes[offset++];
			value += (byte & 127) * 2 ** shift;
			if (!(byte & 128)) return value;
		}
		return failure(400, "invalid_argument");
	};
	while (offset < bytes.length) {
		const tag = varint();
		const field = Math.floor(tag / 8);
		if (field < 1 || tag % 8 !== 2) return failure(403, "permission_denied");
		const length = varint();
		if (length > bytes.length - offset) return failure(400, "invalid_argument");
		fields.push({ field, value: bytes.subarray(offset, offset + length) });
		offset += length;
	}
	return fields;
}
function profileUpdate(body: Buffer, session: BridgeSession): void {
	if (body.length > 4 * 1024 * 1024) failure(413, "resource_exhausted");
	try {
		const request = protobufFields(body);
		if (
			request.length !== 2 ||
			request[0].field !== 1 ||
			request[1].field !== 2
		)
			failure(403, "permission_denied");
		const user = protobufFields(request[0].value);
		const seen = new Set<number>();
		for (const entry of user) {
			if (seen.has(entry.field) || ![1, 3, 4, 5, 6, 7].includes(entry.field))
				failure(403, "permission_denied");
			seen.add(entry.field);
			if (
				entry.field === 1 &&
				utf8.decode(entry.value) !== session.expectedUser
			)
				failure(403, "permission_denied");
			if (entry.field === 3 && utf8.decode(entry.value) !== session.username)
				failure(403, "permission_denied");
		}
		if (!seen.has(1)) failure(403, "permission_denied");
		const mask = protobufFields(request[1].value);
		if (!mask.length || mask.length > profileFields.size)
			failure(403, "permission_denied");
		const paths = new Set<string>();
		for (const entry of mask) {
			if (entry.field !== 1) failure(403, "permission_denied");
			const path = utf8.decode(entry.value);
			if (!profileFields.has(path) || paths.has(path))
				failure(403, "permission_denied");
			paths.add(path);
		}
	} catch (error) {
		if (error instanceof BridgeError) throw error;
		failure(400, "invalid_argument");
	}
}
class BridgeError extends Error {
	constructor(
		public status: number,
		public code: string,
	) {
		super(code);
	}
}
const failure = (status: number, code: string): never => {
	throw new BridgeError(status, code);
};
function origin(value: string): URL {
	const url = new URL(value);
	if (
		url.protocol !== "https:" ||
		url.origin !== value ||
		url.username ||
		url.password
	)
		throw new Error("Memos bridge requires exact HTTPS origins");
	return url;
}
function credentialShape(value: unknown): MemosCredentials {
	const c = value as Partial<MemosCredentials> | null;
	if (
		!c ||
		typeof c.username !== "string" ||
		!/^[a-zA-Z0-9_-]{1,100}$/u.test(c.username) ||
		typeof c.password !== "string" ||
		!c.password ||
		c.password.length > 4096 ||
		typeof c.expectedUser !== "string" ||
		!/^users\/[a-zA-Z0-9_-]{1,100}$/u.test(c.expectedUser)
	)
		throw new Error("Invalid private Memos author credentials");
	return {
		username: c.username,
		password: c.password,
		expectedUser: c.expectedUser,
	};
}
async function privateCredentials(filename: string): Promise<MemosCredentials> {
	if (!path.isAbsolute(filename))
		throw new Error("Memos credentials path must be absolute");
	let current = path.parse(filename).root;
	for (const part of filename
		.slice(current.length)
		.split(path.sep)
		.filter(Boolean)) {
		current = path.join(current, part);
		if ((await fs.lstat(current)).isSymbolicLink())
			throw new Error("Memos credential links refused");
	}
	const stat = await fs.stat(filename);
	if (
		!stat.isFile() ||
		stat.size > 8192 ||
		(process.platform !== "win32" && stat.mode & 0o077)
	)
		throw new Error("Memos credentials require a private bounded file");
	return credentialShape(JSON.parse(await fs.readFile(filename, "utf8")));
}
function varint(value: bigint): Buffer {
	const bytes: number[] = [];
	let remaining = value;
	do {
		bytes.push(Number(remaining & 127n) | (remaining > 127n ? 128 : 0));
		remaining >>= 7n;
	} while (remaining);
	return Buffer.from(bytes);
}
/** v0.31.0 RefreshTokenResponse: access_token=1, expires_at=2 (Timestamp). */
export function encodeMemosRefresh(
	accessToken: string,
	expiresAt: number,
): Buffer {
	const token = Buffer.from(accessToken);
	const seconds = BigInt(Math.floor(expiresAt / 1000));
	const nanos = BigInt(Math.floor(expiresAt % 1000) * 1_000_000);
	const timestamp = Buffer.concat([
		Buffer.from([8]),
		varint(seconds),
		...(nanos ? [Buffer.from([16]), varint(nanos)] : []),
	]);
	return Buffer.concat([
		Buffer.from([10]),
		varint(BigInt(token.length)),
		token,
		Buffer.from([18]),
		varint(BigInt(timestamp.length)),
		timestamp,
	]);
}
async function responseBytes(
	response: Response,
	limit: number,
): Promise<Buffer> {
	const declared = response.headers.get("content-length");
	if (declared && Number(declared) > limit) {
		await response.body?.cancel();
		return failure(502, "resource_exhausted");
	}
	const reader = response.body?.getReader();
	if (!reader) return Buffer.alloc(0);
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.length;
			if (size > limit) return failure(502, "resource_exhausted");
			chunks.push(part.value);
		}
		return Buffer.concat(chunks);
	} finally {
		await reader.cancel().catch(() => {});
	}
}
async function requestBytes(
	req: IncomingMessage,
	limit: number,
	timeout: number,
): Promise<Buffer> {
	if (Number(req.headers["content-length"] || 0) > limit)
		return failure(413, "resource_exhausted");
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const finish = (error?: Error) => {
			clearTimeout(timer);
			req.removeListener("data", data);
			req.removeListener("end", end);
			req.removeListener("error", errorHandler);
			req.removeListener("aborted", aborted);
			if (error) {
				req.resume();
				reject(error);
			} else resolve(Buffer.concat(chunks));
		};
		const data = (chunk: Buffer) => {
			size += chunk.length;
			if (size > limit) finish(new BridgeError(413, "resource_exhausted"));
			else chunks.push(chunk);
		};
		const end = () => finish();
		const errorHandler = () => finish(new BridgeError(400, "invalid_argument"));
		const aborted = () => finish(new BridgeError(400, "invalid_argument"));
		const timer = setTimeout(
			() => finish(new BridgeError(408, "deadline_exceeded")),
			timeout,
		);
		req.on("data", data);
		req.once("end", end);
		req.once("error", errorHandler);
		req.once("aborted", aborted);
	});
}
function permitted(pathname: string, method: string): boolean {
	if (pathname.startsWith(authProcedure))
		return ["GetCurrentUser", "RefreshToken", "SignOut"].includes(
			pathname.slice(authProcedure.length),
		);
	if (pathname.startsWith("/memos.api.v1.")) {
		const match = /^\/memos\.api\.v1\.([A-Za-z]+)Service\/([A-Za-z]+)$/u.exec(
			pathname,
		);
		if (!match) return false;
		if (match[1] === "User")
			return safeUserMethods.has(match[2]) || pathname === updateUserPath;
		if (match[1] === "Instance")
			return [
				"GetInstanceProfile",
				"GetInstanceSetting",
				"BatchGetInstanceSettings",
			].includes(match[2]);
		return ["Memo", "Attachment", "Space"].includes(match[1]);
	}
	if (pathname.startsWith("/api/")) {
		if (
			[
				"/api/v1/auth/me",
				"/api/v1/auth/refresh",
				"/api/v1/auth/signout",
			].includes(pathname)
		)
			return true;
		if (/^\/api\/v1\/(memos|attachments|spaces)(?:\/|:|$)/u.test(pathname))
			return true;
		if (/^\/api\/v1\/users(?:\/|:|$)/u.test(pathname)) {
			if (
				/personalAccessTokens|linkedIdentities|webhooks|notifications/u.test(
					pathname,
				)
			)
				return false;
			return (
				method === "GET" ||
				/^\/api\/v1\/users\/[^/]+\/(settings|views)(?:\/|$)/u.test(pathname)
			);
		}
		return method === "GET" && /^\/api\/v1\/instance\//u.test(pathname);
	}
	return method === "GET" || method === "HEAD";
}

/** Original Memos stays private; every gateway request is tied to a live admin session. */
export class MemosBridge {
	readonly enabled = true;
	private tickets = new Map<string, Identity>();
	private sessions = new Map<string, BridgeSession>();
	private fetcher: typeof fetch;
	private now: () => number;
	private upstream: string;
	private memosHost: string;
	private active = 0;
	private activeFrontend = 0;
	private closed = false;
	private maxBody: number;
	private maxResponse: number;
	private timeout: number;
	constructor(private options: MemosBridgeOptions) {
		origin(options.adminOrigin);
		this.memosHost = origin(options.memosOrigin).host;
		if (options.adminOrigin === options.memosOrigin)
			throw new Error("Memos requires an isolated origin");
		const upstream = memosUpstream(options.upstream);
		if (!options.credentials && !options.credentialsFile)
			throw new Error("Private Memos credentials required");
		this.upstream = upstream;
		this.fetcher = options.fetcher ?? fetch;
		this.now = options.now ?? Date.now;
		this.maxBody = options.maxBodyBytes ?? 20 * 1024 * 1024;
		this.maxResponse = options.maxResponseBytes ?? 64 * 1024 * 1024;
		this.timeout = options.timeoutMs ?? 15000;
		for (const [value, max] of [
			[this.maxBody, 50 * 1024 * 1024],
			[this.maxResponse, 128 * 1024 * 1024],
			[this.timeout, 60000],
		])
			if (!Number.isSafeInteger(value) || value < 1 || value > max)
				throw new Error("Invalid Memos bridge bound");
	}
	private async valid(identity: Identity): Promise<boolean> {
		if (this.closed || identity.expires <= this.now()) return false;
		const owner = await this.options.verify(identity.adminToken);
		return (
			!!owner &&
			owner.id === identity.owner.id &&
			owner.version === identity.owner.version
		);
	}
	async issueTicket(adminToken: string, owner: Owner): Promise<string> {
		for (const [key, ticket] of this.tickets)
			if (ticket.expires <= this.now()) this.tickets.delete(key);
		const identity = {
			adminToken,
			owner: { ...owner },
			expires: this.now() + 30000,
		};
		if (!(await this.valid(identity))) return failure(401, "unauthenticated");
		if (this.tickets.size >= 100) return failure(429, "resource_exhausted");
		const ticket = randomBytes(32).toString("base64url");
		this.tickets.set(ticket, identity);
		return ticket;
	}
	private async upstreamResponse(
		route: string,
		init: RequestInit,
	): Promise<Response> {
		return this.fetcher(`${this.upstream}${route}`, {
			...init,
			redirect: "error",
			signal: AbortSignal.timeout(this.timeout),
		});
	}
	private async authJson(
		route: string,
		body: object,
		session?: BridgeSession,
	): Promise<{ data: Record<string, unknown>; cookie: string }> {
		const response = await this.upstreamResponse(route, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(session
					? {
							authorization: `Bearer ${session.accessToken}`,
							cookie: session.refreshCookie,
						}
					: {}),
			},
			body: JSON.stringify(body),
		});
		const bytes = await responseBytes(response, 256 * 1024);
		if (!response.ok || response.status >= 300)
			return failure(502, "unavailable");
		// v0.31.0 REST gateway carries gRPC response metadata under this header.
		// Consume it only from our fixed private upstream; never forward it to clients.
		const cookie =
			[
				...response.headers.getSetCookie(),
				response.headers.get("grpc-metadata-set-cookie") || "",
			]
				.find((value) => value.startsWith("memos_refresh="))
				?.split(";")[0] || "";
		if (!/^memos_refresh=[A-Za-z0-9_.-]+$/u.test(cookie))
			return failure(502, "unavailable");
		return { data: JSON.parse(bytes.toString("utf8")), cookie };
	}
	private setTokens(
		session: BridgeSession,
		data: Record<string, unknown>,
		cookie: string,
		login: boolean,
	) {
		const token = data.accessToken ?? data.access_token;
		const expires = login
			? (data.accessTokenExpiresAt ?? data.access_token_expires_at)
			: (data.expiresAt ?? data.expires_at);
		const at = typeof expires === "string" ? Date.parse(expires) : Number.NaN;
		if (
			typeof token !== "string" ||
			!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token) ||
			token.length > 16384 ||
			!Number.isFinite(at) ||
			at <= this.now() ||
			at > this.now() + 20 * 60 * 1000
		)
			return failure(502, "unavailable");
		session.accessToken = token;
		session.accessExpires = at;
		session.refreshCookie = cookie;
	}
	private async login(identity: Identity): Promise<BridgeSession> {
		const credentials = this.options.credentials
			? credentialShape(this.options.credentials)
			: await privateCredentials(
					this.options.credentialsFile ?? failure(503, "unavailable"),
				);
		const { data, cookie } = await this.authJson("/api/v1/auth/signin", {
			passwordCredentials: {
				username: credentials.username,
				password: credentials.password,
			},
		});
		const session: BridgeSession = {
			...identity,
			expectedUser: credentials.expectedUser,
			username: credentials.username,
			expires: this.now() + 8 * 60 * 60 * 1000,
			accessToken: "",
			accessExpires: 0,
			refreshCookie: "",
		};
		this.setTokens(session, data, cookie, true);
		const user = data.user as
			| { name?: string; username?: string; role?: string }
			| undefined;
		if (
			!user ||
			user.name !== credentials.expectedUser ||
			user.username !== credentials.username ||
			user.role !== "USER"
		) {
			await this.signout(session);
			return failure(403, "permission_denied");
		}
		if (!(await this.valid(identity))) {
			await this.signout(session);
			return failure(401, "unauthenticated");
		}
		return session;
	}
	private async refresh(session: BridgeSession): Promise<void> {
		if (!session.refreshing)
			session.refreshing = (async () => {
				let renewed: BridgeSession | undefined;
				try {
					const { data, cookie } = await this.authJson(
						"/api/v1/auth/refresh",
						{},
						session,
					);
					renewed = { ...session };
					this.setTokens(renewed, data, cookie, false);
					const response = await this.upstreamResponse("/api/v1/auth/me", {
						headers: { authorization: `Bearer ${renewed.accessToken}` },
					});
					if (!response.ok) {
						await response.body?.cancel();
						return failure(502, "unavailable");
					}
					const current = JSON.parse(
						(await responseBytes(response, 256 * 1024)).toString("utf8"),
					) as { user?: { name?: string; username?: string; role?: string } };
					if (
						current.user?.name !== session.expectedUser ||
						current.user?.username !== session.username ||
						current.user?.role !== "USER"
					) {
						return failure(403, "permission_denied");
					}
					// Publish refreshed credentials only AFTER the author/role proof.
					session.accessToken = renewed.accessToken;
					session.accessExpires = renewed.accessExpires;
					session.refreshCookie = renewed.refreshCookie;
				} catch (error) {
					session.expires = 0;
					await this.signout(renewed ?? session);
					throw error;
				}
			})().finally(() => {
				session.refreshing = undefined;
			});
		await session.refreshing;
	}
	private async signout(session: BridgeSession): Promise<void> {
		try {
			const response = await this.upstreamResponse("/api/v1/auth/signout", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${session.accessToken}`,
					cookie: session.refreshCookie,
				},
				body: "{}",
			});
			await response.body?.cancel();
		} catch {
			/* Access is already denied at the gateway, even if upstream cleanup fails. */
		}
	}
	private headers(res: ServerResponse, policy?: string) {
		res.setHeader("cache-control", "private, no-store");
		res.setHeader("pragma", "no-cache");
		res.setHeader("referrer-policy", "no-referrer");
		res.setHeader("x-content-type-options", "nosniff");
		// Frame policy applies only to this isolated Memos listener. Keep every other directive.
		const policies = (policy || "").split(",").map((value) => {
			const directives = value
				.split(";")
				.map((part) => part.trim())
				.filter((part) => part && !/^frame-ancestors(?:\s|$)/iu.test(part));
			directives.push(`frame-ancestors ${this.options.adminOrigin}`);
			return directives.join("; ");
		});
		res.setHeader("content-security-policy", policies.join(", "));
		res.removeHeader("x-frame-options");
	}
	private cookie(res: ServerResponse, token: string, maxAge: number) {
		res.setHeader(
			"set-cookie",
			`${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`,
		);
	}
	async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		this.headers(res);
		let frontendRequest = false;
		let admitted = false;
		try {
			if (
				req.headers.host !== this.memosHost ||
				!req.url?.startsWith("/") ||
				req.url.startsWith("//") ||
				/[\\\r\n]/u.test(req.url)
			)
				return failure(400, "invalid_argument");
			const url = new URL(req.url, this.options.memosOrigin);
			if (
				url.origin !== this.options.memosOrigin ||
				/%2f|%5c|%2e/iu.test(url.pathname)
			)
				return failure(400, "invalid_argument");
			const pathname = decodeURIComponent(url.pathname);
			if (pathname.includes("%")) return failure(400, "invalid_argument");
			const method = req.method || "GET";
			// Only exact sealed assets get their own capacity. Attachments and
			// unknown paths retain the bounded upstream pool and all auth checks.
			const localAsset = ["GET", "HEAD"].includes(method)
				? this.options.frontend?.asset(pathname)
				: undefined;
			frontendRequest =
				!!localAsset && !localAsset.type.startsWith("text/html");
			if (
				this.closed ||
				(frontendRequest ? this.activeFrontend >= 32 : this.active >= 8)
			)
				return failure(503, "unavailable");
			if (frontendRequest) this.activeFrontend++;
			else this.active++;
			admitted = true;
			if (url.pathname === "/_bridge/entry") {
				if (
					method !== "POST" ||
					req.headers.origin !== this.options.adminOrigin ||
					req.headers["content-type"]?.split(";")[0] !==
						"application/x-www-form-urlencoded"
				)
					return failure(403, "permission_denied");
				const form = new URLSearchParams(
					(await requestBytes(req, 4096, this.timeout)).toString("utf8"),
				);
				const key = form.get("ticket") || "";
				const identity = this.tickets.get(key);
				this.tickets.delete(key);
				if (
					form.getAll("ticket").length !== 1 ||
					!identity ||
					!(await this.valid(identity))
				)
					return failure(401, "unauthenticated");
				for (const [id, session] of this.sessions)
					if (session.expires <= this.now()) this.sessions.delete(id);
				if (this.sessions.size >= 100)
					return failure(429, "resource_exhausted");
				const session = await this.login(identity);
				if (this.sessions.size >= 100) {
					await this.signout(session);
					return failure(429, "resource_exhausted");
				}
				const id = randomBytes(32).toString("base64url");
				this.sessions.set(id, session);
				this.cookie(res, id, 8 * 60 * 60);
				res.writeHead(303, { location: "/" });
				res.end();
				return;
			}
			const cookies = (req.headers.cookie || "")
				.split(";")
				.map((part) => part.trim())
				.filter((part) => part.startsWith(`${cookieName}=`));
			const id =
				cookies.length === 1 ? cookies[0].slice(cookieName.length + 1) : "";
			const session = this.sessions.get(id);
			if (!session || !(await this.valid(session))) {
				this.sessions.delete(id);
				this.cookie(res, "", 0);
				if (session) await this.signout(session);
				return failure(401, "unauthenticated");
			}
			if (
				!["GET", "HEAD"].includes(method) &&
				req.headers.origin !== this.options.memosOrigin
			)
				return failure(403, "permission_denied");
			if (!permitted(pathname, method))
				return failure(403, "permission_denied");
			const body = ["GET", "HEAD"].includes(method)
				? undefined
				: await requestBytes(
						req,
						url.pathname === updateUserPath
							? Math.min(this.maxBody, 4 * 1024 * 1024)
							: this.maxBody,
						this.timeout,
					);
			if (url.pathname === updateUserPath) {
				if (
					method !== "POST" ||
					req.headers["content-type"] !== "application/proto" ||
					!body
				)
					return failure(403, "permission_denied");
				profileUpdate(body, session);
			}
			if (refreshPaths.has(url.pathname) || signoutPaths.has(url.pathname)) {
				if (method !== "POST" || !body || body.length > 4096)
					return failure(400, "invalid_argument");
				const contentType = req.headers["content-type"]?.split(";")[0];
				const binary =
					url.pathname.startsWith(authProcedure) &&
					contentType === "application/proto";
				if (!binary && contentType !== "application/json")
					return failure(415, "invalid_argument");
				if (signoutPaths.has(url.pathname)) {
					this.sessions.delete(id);
					this.cookie(res, "", 0);
					await this.signout(session);
					res.writeHead(200, {
						"content-type": binary ? "application/proto" : "application/json",
					});
					res.end(binary ? Buffer.alloc(0) : "{}");
					return;
				}
				if (session.refreshing || session.accessExpires <= this.now() + 60000)
					await this.refresh(session);
				if (!(await this.valid(session)))
					return failure(401, "unauthenticated");
				res.writeHead(200, {
					"content-type": binary ? "application/proto" : "application/json",
				});
				res.end(
					binary
						? encodeMemosRefresh(session.accessToken, session.accessExpires)
						: JSON.stringify({
								accessToken: session.accessToken,
								expiresAt: new Date(session.accessExpires).toISOString(),
							}),
				);
				return;
			}
			if (session.refreshing || session.accessExpires <= this.now() + 60000)
				await this.refresh(session);
			if (!(await this.valid(session))) return failure(401, "unauthenticated");
			const frontendAsset = ["GET", "HEAD"].includes(method)
				? this.options.frontend?.asset(pathname)
				: undefined;
			if (frontendAsset) {
				res.setHeader("content-type", frontendAsset.type);
				let bytes = frontendAsset.bytes;
				if (frontendAsset.gzip) {
					res.setHeader("vary", "Accept-Encoding");
					const acceptsGzip = (req.headers["accept-encoding"] || "")
						.split(",")
						.some(
							(part) =>
								/^gzip(?:\s*;\s*q=(?:1(?:\.0{0,3})?|0\.\d{1,3}))?$/iu.test(
									part.trim(),
								) && !/;\s*q=0(?:\.0*)?$/iu.test(part.trim()),
						);
					if (acceptsGzip) {
						bytes = frontendAsset.gzip;
						res.setHeader("content-encoding", "gzip");
					}
				}
				res.setHeader("content-length", bytes.length);
				res.writeHead(200);
				res.end(method === "HEAD" ? undefined : bytes);
				return;
			}
			const headers = new Headers();
			for (const key of [
				"content-type",
				"accept",
				"range",
				"if-range",
				"connect-protocol-version",
				"connect-timeout-ms",
			]) {
				const value = req.headers[key];
				if (typeof value === "string") headers.set(key, value);
			}
			if (
				req.headers["content-encoding"] &&
				req.headers["content-encoding"] !== "identity"
			)
				return failure(415, "unimplemented");
			headers.set("authorization", `Bearer ${session.accessToken}`);
			headers.set("cookie", session.refreshCookie);
			const response = await this.upstreamResponse(
				`${url.pathname}${url.search}`,
				{ method, headers, body: body ? new Uint8Array(body) : undefined },
			);
			if (response.status >= 300 && response.status < 400) {
				await response.body?.cancel();
				return failure(502, "unavailable");
			}
			let bytes = await responseBytes(response, this.maxResponse);
			const frontendPage =
				this.options.frontend &&
				["GET", "HEAD"].includes(method) &&
				response.ok &&
				response.headers.get("content-type")?.startsWith("text/html") &&
				!/^\/(?:api|file|_bridge)(?:\/|$)|^\/memos\.api\./u.test(pathname)
					? this.options.frontend.index()
					: undefined;
			if (frontendPage) bytes = frontendPage.bytes;
			if (!(await this.valid(session))) return failure(401, "unauthenticated");
			for (const key of [
				"content-type",
				"content-disposition",
				"content-range",
				"accept-ranges",
			]) {
				const value = response.headers.get(key);
				if (value) res.setHeader(key, value);
			}
			if (frontendPage) res.setHeader("content-type", frontendPage.type);
			this.headers(
				res,
				response.headers.get("content-security-policy") || undefined,
			);
			res.writeHead(response.status);
			res.end(method === "HEAD" ? undefined : bytes);
		} catch (error) {
			if (!res.headersSent) {
				const known = error instanceof BridgeError;
				res.writeHead(known ? error.status : 503, {
					"content-type": "application/json",
				});
				res.end(
					JSON.stringify({
						code: known ? error.code : "unavailable",
						message: "Memos gateway request refused",
					}),
				);
			} else res.destroy();
		} finally {
			if (admitted) {
				if (frontendRequest) this.activeFrontend--;
				else this.active--;
			}
		}
	}
	async close(): Promise<void> {
		this.closed = true;
		this.tickets.clear();
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		for (let i = 0; i < sessions.length; i += 4)
			await Promise.all(
				sessions.slice(i, i + 4).map((session) => this.signout(session)),
			);
	}
}
