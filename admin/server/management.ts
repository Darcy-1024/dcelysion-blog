import { createHash } from "node:crypto";
import type {
	Account,
	Comment,
	ManagementInfo,
	Page,
	Thread,
	User,
} from "../shared/management.js";
import type { AuthService, Owner } from "./auth.js";
import type { AdminConfig } from "./config.js";
import { listContent } from "./content.js";

export class ManagementError extends Error {
	constructor(
		public status: number,
		public code: string,
	) {
		super(code);
	}
}
const invalid = () => {
	throw new ManagementError(400, "MANAGEMENT_INPUT");
};
export function objectId(value: unknown): string {
	if (!/^[1-9][0-9]{0,9}$/u.test(String(value)) || Number(value) > 2147483647)
		return invalid();
	return String(value);
}
function text(value: unknown, max: number, required = false): string {
	if (
		typeof value !== "string" ||
		value.length > max ||
		(required && !value.trim()) ||
		value.includes(String.fromCharCode(0))
	)
		return invalid();
	return value;
}
function fields(input: Record<string, unknown>, allowed: string[]) {
	if (Object.keys(input).some((key) => !allowed.includes(key))) invalid();
}
function safeUrl(value: unknown) {
	const url = text(value, 500);
	if (!url) return url;
	try {
		const parsed = new URL(url);
		if (
			!["http:", "https:"].includes(parsed.protocol) ||
			parsed.username ||
			parsed.password
		)
			return invalid();
	} catch {
		return invalid();
	}
	return url;
}
const fingerprint = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Raw = Record<string, unknown>;
function raw(value: unknown): Raw {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ManagementError(502, "WALINE_RESPONSE");
	return value as Raw;
}
function string(value: unknown) {
	return value == null ? "" : String(value);
}
function comment(value: unknown): Comment {
	const row = raw(value);
	const result = {
		objectId: objectId(row.objectId),
		comment: string(row.comment),
		nick: string(row.nick),
		url: string(row.url),
		status: (row.status || "approved") as Comment["status"],
		pid: string(row.pid),
		rid: string(row.rid),
		user_id: string(row.user_id),
		insertedAt: string(row.insertedAt),
		updatedAt: string(row.updatedAt),
	};
	if (!["approved", "waiting", "spam"].includes(result.status))
		throw new ManagementError(502, "WALINE_RESPONSE");
	return { ...result, fingerprint: fingerprint(result) };
}
function user(value: unknown): User {
	const row = raw(value);
	const result = {
		objectId: objectId(row.objectId),
		display_name: string(row.display_name),
		email: string(row.email),
		url: string(row.url),
		type: string(row.type).startsWith("verify:")
			? "unverified"
			: string(row.type),
		label: string(row.label),
	};
	return {
		...result,
		fingerprint: fingerprint({
			...result,
			version: row.auth_version,
			updated: row.updatedAt,
		}),
	};
}
function page<T>(value: unknown, mapper: (row: unknown) => T): Page<T> {
	const row = raw(value);
	for (const key of ["total", "page", "pageSize", "pages"])
		if (
			!Number.isSafeInteger(row[key]) ||
			Number(row[key]) < (key === "page" || key === "pageSize" ? 1 : 0)
		)
			throw new ManagementError(502, "WALINE_RESPONSE");
	if (!Array.isArray(row.items))
		throw new ManagementError(502, "WALINE_RESPONSE");
	return {
		items: row.items.map(mapper),
		total: Number(row.total),
		page: Number(row.page),
		pageSize: Number(row.pageSize),
		pages: Number(row.pages),
	};
}

export class ManagementService {
	private replies = new Map<string, number>();
	constructor(
		private config: AdminConfig,
		private auth: AuthService,
		private fetcher: typeof fetch = fetch,
		private infoOverride?: ManagementInfo,
	) {}
	info(): ManagementInfo {
		if (this.infoOverride) return this.infoOverride;
		return {
			source: this.config.walineUrl,
			securityUrl: this.config.walineSecurityUrl,
			overlay: "Waline 1.41.6 · DcElysion management-v1",
		};
	}
	private async call(
		path: string,
		bearer: string,
		method = "GET",
		input?: unknown,
	): Promise<unknown> {
		let response: Response;
		try {
			response = await this.fetcher(`${this.config.walineUrl}${path}`, {
				method,
				headers: {
					authorization: `Bearer ${bearer}`,
					"content-type": "application/json",
					referer: `${this.config.walineUrl}/ui/`,
				},
				body: input === undefined ? undefined : JSON.stringify(input),
				signal: AbortSignal.timeout(8000),
				redirect: "error",
			});
		} catch {
			throw new ManagementError(
				method === "GET" ? 504 : 409,
				method === "GET" ? "WALINE_TIMEOUT" : "WRITE_UNKNOWN",
			);
		}
		if ([401, 403].includes(response.status))
			throw new ManagementError(
				response.status,
				response.status === 401 ? "WALINE_REAUTH" : "WALINE_FORBIDDEN",
			);
		if (response.status === 409)
			throw new ManagementError(409, "MANAGEMENT_CONFLICT");
		if (!response.ok)
			throw new ManagementError(
				method === "GET" ? 502 : 409,
				method === "GET"
					? response.status === 404
						? "WALINE_OVERLAY_REQUIRED"
						: "WALINE_RESPONSE"
					: "WRITE_UNKNOWN",
			);
		let result: Raw;
		try {
			const reader = response.body?.getReader();
			if (!reader) throw new Error();
			const chunks: Uint8Array[] = [];
			let length = 0;
			while (true) {
				const part = await reader.read();
				if (part.done) break;
				length += part.value.length;
				if (length > 2 * 1024 * 1024) {
					await reader.cancel();
					throw new Error();
				}
				chunks.push(part.value);
			}
			result = raw(JSON.parse(Buffer.concat(chunks).toString("utf8")));
		} catch {
			throw new ManagementError(
				method === "GET" ? 502 : 409,
				method === "GET" ? "WALINE_RESPONSE" : "WRITE_UNKNOWN",
			);
		}
		if (result.errno !== 0) throw new ManagementError(422, "WALINE_REJECTED");
		return result.data;
	}
	private async context(token: string, owner: Owner) {
		const current = await this.auth.verify(token);
		if (
			!current ||
			current.id !== owner.id ||
			current.version !== owner.version
		)
			throw new ManagementError(401, "UNAUTHORIZED");
		const bearer = await this.auth.walineBearer(token, owner);
		if (!bearer) throw new ManagementError(401, "WALINE_REAUTH");
		const identity = raw(await this.call("/api/token", bearer));
		if (
			Number(identity.objectId) !== owner.id ||
			identity.type !== "administrator" ||
			Number(identity.auth_version) !== owner.version
		) {
			await this.auth.revoke(token);
			throw new ManagementError(401, "WALINE_REAUTH");
		}
		return { bearer, identity };
	}
	private query(params: URLSearchParams, resource: string) {
		const allowed = ["page", "pageSize", "search", "status", "path", "userId"];
		for (const key of params.keys())
			if (!allowed.includes(key) || params.getAll(key).length !== 1) invalid();
		const p = Number(params.get("page") || 1);
		const size = Number(params.get("pageSize") || 15);
		if (
			!Number.isSafeInteger(p) ||
			p < 1 ||
			p > 100000 ||
			!Number.isSafeInteger(size) ||
			size < 1 ||
			size > 50
		)
			invalid();
		const query = new URLSearchParams({
			resource,
			page: String(p),
			pageSize: String(size),
		});
		for (const key of ["search", "path"])
			if (params.get(key))
				query.set(key, text(params.get(key), key === "search" ? 150 : 500));
		const status = params.get("status");
		if (status && status !== "all") {
			if (
				!["approved", "waiting", "spam"].includes(status) ||
				resource !== "comment"
			)
				invalid();
			query.set("status", status);
		}
		if (params.get("userId"))
			query.set("userId", objectId(params.get("userId")));
		return query;
	}
	private read(bearer: string, query: URLSearchParams) {
		return this.call(`/api/management?${query}`, bearer);
	}
	async summary(token: string, owner: Owner) {
		const { bearer } = await this.context(token, owner);
		const total = async (resource: string, status?: string) => {
			const query = new URLSearchParams({ resource, page: "1", pageSize: "1" });
			if (status) query.set("status", status);
			const result = raw(await this.read(bearer, query));
			if (!Number.isSafeInteger(result.total) || Number(result.total) < 0)
				throw new ManagementError(502, "WALINE_RESPONSE");
			return Number(result.total);
		};
		const [comments, waiting, users] = await Promise.all([
			total("comment"),
			total("comment", "waiting"),
			total("user"),
		]);
		return { total: comments, waiting, users };
	}
	async list(
		token: string,
		owner: Owner,
		resource: "comment" | "user",
		params: URLSearchParams,
	) {
		const query = this.query(params, resource);
		const { bearer } = await this.context(token, owner);
		const result = page(
			await this.read(bearer, query),
			resource === "comment"
				? (value: unknown) => comment(value) as Comment | User
				: (value: unknown) => user(value),
		);
		if (resource === "comment") {
			const titles = await this.articleTitles();
			for (const item of result.items as Comment[])
				item.article = titles.get(item.url);
		}
		return result;
	}
	private async articleTitles() {
		const map = new Map<string, string>();
		for (const kind of ["posts", "dynamic"] as const) {
			const result = await listContent(this.config.contentRoot, {
				kind,
				status: "all",
				search: "",
				page: 1,
				pageSize: 100000,
			});
			for (const item of result.items) {
				map.set(item.url, item.title);
				map.set(item.commentPath, item.title);
			}
		}
		return map;
	}
	private async detailRaw(
		bearer: string,
		resource: string,
		id: string,
		pageNumber = 1,
	) {
		const value = await this.read(
			bearer,
			new URLSearchParams({
				resource,
				id,
				page: String(pageNumber),
				pageSize: "30",
			}),
		);
		if (!value) throw new ManagementError(404, "MANAGEMENT_NOT_FOUND");
		return raw(value);
	}
	private thread(value: Raw): Thread {
		if (
			!Array.isArray(value.thread) ||
			!Number.isSafeInteger(value.deleteCount)
		)
			throw new ManagementError(502, "WALINE_RESPONSE");
		const result = page({ ...value, items: value.thread }, comment);
		return {
			...result,
			item: comment(value.item),
			thread: result.items,
			deleteCount: Number(value.deleteCount),
		};
	}
	async detail(
		token: string,
		owner: Owner,
		resource: "comment" | "user",
		id: string,
		pageNumber = 1,
	) {
		const { bearer } = await this.context(token, owner);
		const result = await this.detailRaw(
			bearer,
			resource,
			objectId(id),
			pageNumber,
		);
		return resource === "comment" ? this.thread(result) : user(result);
	}
	async account(token: string, owner: Owner): Promise<Account> {
		const { identity } = await this.context(token, owner);
		return { ...user(identity), twoFactorEnabled: !!identity["2fa"] };
	}
	async write(
		token: string,
		owner: Owner,
		resource: "comment" | "user" | "account",
		id: string,
		action: string,
		input: Record<string, unknown>,
	) {
		const { bearer, identity } = await this.context(token, owner);
		const requestId = text(input.requestId, 36, true);
		if (
			!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
				requestId,
			)
		)
			invalid();
		try {
			if (resource === "comment") {
				fields(input, [
					"requestId",
					"fingerprint",
					...(action === "edit" || action === "reply"
						? ["comment"]
						: action === "status"
							? ["status"]
							: []),
				]);
				const detail = this.thread(
					await this.detailRaw(bearer, "comment", objectId(id)),
				);
				if (input.fingerprint !== detail.item.fingerprint)
					throw new ManagementError(409, "MANAGEMENT_CONFLICT");
				if (action === "delete")
					await this.call(`/api/comment/${id}`, bearer, "DELETE");
				else if (action === "status") {
					if (!["approved", "waiting", "spam"].includes(String(input.status)))
						invalid();
					await this.call(`/api/comment/${id}`, bearer, "PUT", {
						status: input.status,
					});
				} else if (action === "edit")
					await this.call(`/api/comment/${id}`, bearer, "PUT", {
						comment: text(input.comment, 20000, true),
					});
				else if (action === "reply") {
					const replyText = text(input.comment, 20000, true);
					const root = detail.item.rid || detail.item.objectId;
					if (detail.item.rid) {
						const rootDetail = this.thread(
							await this.detailRaw(bearer, "comment", objectId(root)),
						);
						if (rootDetail.item.url !== detail.item.url || rootDetail.item.rid)
							throw new ManagementError(409, "MANAGEMENT_CONFLICT");
					}
					for (const [key, expires] of this.replies)
						if (expires <= Date.now()) this.replies.delete(key);
					const key = `${owner.id}:${requestId}`;
					if (this.replies.has(key))
						throw new ManagementError(409, "WRITE_UNKNOWN");
					if (this.replies.size >= 10000)
						throw new ManagementError(503, "MANAGEMENT_BUSY");
					this.replies.set(key, Date.now() + 86400000);
					await this.call("/api/comment", bearer, "POST", {
						comment: replyText,
						url: detail.item.url,
						pid: detail.item.objectId,
						rid: root,
						nick: string(identity.display_name),
						mail: string(identity.email),
						link: string(identity.url),
						ua: "DcElysion Admin",
					});
				} else invalid();
			} else if (resource === "user") {
				fields(input, ["requestId", "fingerprint", "type"]);
				if (action !== "state") invalid();
				const target = await this.detailRaw(bearer, "user", objectId(id));
				if (
					Number(id) === this.config.ownerId ||
					target.type === "administrator"
				)
					throw new ManagementError(403, "OWNER_PROTECTED");
				if (input.fingerprint !== user(target).fingerprint)
					throw new ManagementError(409, "MANAGEMENT_CONFLICT");
				if (
					!["guest", "banned"].includes(String(target.type)) ||
					!["guest", "banned"].includes(String(input.type)) ||
					target.type === input.type
				)
					invalid();
				await this.call(`/api/user/${id}`, bearer, "PUT", {
					_managementState: true,
					type: input.type,
					expectedType: target.type,
					expectedVersion: Number(target.auth_version),
				});
			} else if (action === "profile") {
				fields(input, ["requestId", "fingerprint", "display_name", "url"]);
				if (input.fingerprint !== user(identity).fingerprint)
					throw new ManagementError(409, "MANAGEMENT_CONFLICT");
				const name = text(input.display_name, 100, true);
				if (name.trim() !== name || name.length < 2) invalid();
				await this.call("/api/user", bearer, "PUT", {
					display_name: name,
					...(safeUrl(input.url) ? { url: input.url } : {}),
				});
			} else if (action === "password") {
				fields(input, ["requestId", "password", "currentPassword", "code"]);
				const password = text(input.password, 128, true);
				if (password.length < 8) invalid();
				const verified = raw(
					await this.call("/api/token", "", "POST", {
						email: identity.email,
						password: text(input.currentPassword, 1024, true),
						code: text(input.code, 16),
					}),
				);
				if (
					Number(verified.objectId) !== owner.id ||
					verified.type !== "administrator" ||
					Number(verified.auth_version) !== owner.version ||
					typeof verified.token !== "string"
				)
					throw new ManagementError(401, "WALINE_REAUTH");
				if (!(await this.auth.verify(token)))
					throw new ManagementError(401, "UNAUTHORIZED");
				try {
					await this.call("/api/user", verified.token, "PUT", { password });
				} catch (cause) {
					if (
						cause instanceof ManagementError &&
						cause.code === "WRITE_UNKNOWN"
					)
						await this.auth.revoke(token);
					throw cause;
				}
				await this.auth.revoke(token);
			} else invalid();
			await this.auth.managementAudit(
				owner.id,
				`${resource}.${action}`,
				"success",
				id,
				requestId,
			);
			return {
				requestId,
				signedOut: resource === "account" && action === "password",
			};
		} catch (cause) {
			const code =
				cause instanceof ManagementError ? cause.code : "WRITE_UNKNOWN";
			try {
				await this.auth.managementAudit(
					owner.id,
					`${resource}.${action}`,
					code,
					id,
					requestId,
				);
			} catch {
				/* Never log sensitive upstream bodies. */
			}
			if (cause instanceof ManagementError) throw cause;
			throw new ManagementError(409, "WRITE_UNKNOWN");
		}
	}
}
