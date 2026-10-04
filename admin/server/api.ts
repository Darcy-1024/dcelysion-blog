import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	AnalyticsInputError,
	AnalyticsService,
	analyticsSettings,
} from "./analytics.js";
import type { AuthService } from "./auth.js";
import type { AdminConfig } from "./config.js";
import { type ContentQuery, listContent } from "./content.js";
import {
	contentKind,
	DraftError,
	type DraftService,
	draftKind,
	uuid,
} from "./drafts.js";
import type { JobService } from "./jobs.js";
import { ManagementError, ManagementService, objectId } from "./management.js";
import type { MediaService } from "./media.js";
import { OverviewService } from "./overview.js";
import { servePreview } from "./preview.js";

export function createApi(
	config: AdminConfig,
	auth: AuthService | null,
	drafts: DraftService | null,
	jobs: JobService | null = null,
	media: MediaService | null = null,
	management: ManagementService | null = auth
		? new ManagementService(config, auth)
		: null,
	analytics: AnalyticsService = new AnalyticsService(
		analyticsSettings(),
		config.contentRoot,
	),
	overview: OverviewService = new OverviewService(
		config.contentRoot,
		drafts,
		management,
	),
) {
	const cookieName = config.cookieSecure ? "__Host-dc_admin" : "dc_admin_local";
	const attempts = new Map<string, { count: number; until: number }>();
	function send(res: ServerResponse, status: number, body: unknown) {
		res.writeHead(status, {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
		});
		res.end(JSON.stringify(body));
	}
	function error(
		res: ServerResponse,
		status: number,
		code: string,
		message: string,
	) {
		send(res, status, { ok: false, error: { code, message } });
	}
	function cookie(req: IncomingMessage) {
		const part = (req.headers.cookie || "")
			.split(";")
			.map((entry) => entry.trim())
			.find((entry) => entry.startsWith(`${cookieName}=`));
		return part?.slice(cookieName.length + 1) || "";
	}
	function setCookie(res: ServerResponse, value: string, maxAge: number) {
		res.setHeader(
			"set-cookie",
			`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.cookieSecure ? "; Secure" : ""}`,
		);
	}
	function rateKey(req: IncomingMessage, identity: string) {
		return createHash("sha256")
			.update(
				`${req.socket.remoteAddress || "unknown"}\0${identity.toLocaleLowerCase()}`,
			)
			.digest("hex");
	}
	function allowLogin(key: string) {
		const now = Date.now();
		for (const [entry, value] of attempts)
			if (value.until < now) attempts.delete(entry);
		if (attempts.size >= 10000 && !attempts.has(key)) return false;
		const row = attempts.get(key);
		if (!row || row.until < now) {
			attempts.set(key, { count: 1, until: now + 15 * 60_000 });
			return true;
		}
		row.count++;
		return row.count <= 5;
	}
	function parseQuery(url: URL): ContentQuery {
		const kind = url.pathname.endsWith("/posts") ? "posts" : "dynamic";
		const status = url.searchParams.get("status") || "all";
		const page = Number(url.searchParams.get("page") || 1);
		const pageSize = Number(url.searchParams.get("pageSize") || 15);
		const search = url.searchParams.get("search") || "";
		if (
			!["all", "published", "draft"].includes(status) ||
			!Number.isSafeInteger(page) ||
			page < 1 ||
			!Number.isSafeInteger(pageSize) ||
			pageSize < 1 ||
			pageSize > 50 ||
			search.length > 150
		)
			throw new Error("筛选参数无效");
		return {
			kind,
			status: status as ContentQuery["status"],
			page,
			pageSize,
			search,
		};
	}
	async function body(req: IncomingMessage, limit = 4096) {
		if (!req.headers["content-type"]?.startsWith("application/json"))
			throw new Error("需要 JSON 请求");
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of req) {
			size += chunk.length;
			if (size > limit) throw new Error("请求过大");
			chunks.push(chunk);
		}
		const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error("JSON object required");
		return value as Record<string, unknown>;
	}
	async function managedBody(req: IncomingMessage, limit = 4096) {
		try {
			return await body(req, limit);
		} catch {
			throw new ManagementError(400, "MANAGEMENT_INPUT");
		}
	}
	async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
		if (url.pathname === "/api/status" && req.method === "GET") {
			return send(res, 200, {
				ok: true,
				data: {
					configured: config.ready,
					missing: config.missing,
					blogOrigin: config.blogOrigin,
				},
			});
		}
		if (!auth) return error(res, 503, "NOT_CONFIGURED", "后台服务尚未配置");
		if (!["GET", "POST"].includes(req.method || ""))
			return error(res, 405, "METHOD", "请求方法不支持");
		if (req.method === "POST" && req.headers.origin !== config.origin)
			return error(res, 403, "ORIGIN", "请求来源不匹配");
		if (url.pathname === "/api/login" && req.method === "POST") {
			let input: Record<string, unknown>;
			try {
				input = await body(req);
			} catch {
				return error(res, 400, "INPUT", "登录信息格式无效");
			}
			const identity = input.identity;
			const password = input.password;
			const code = input.code || "";
			if (
				typeof identity !== "string" ||
				typeof password !== "string" ||
				typeof code !== "string" ||
				identity.length < 1 ||
				identity.length > 255 ||
				password.length < 1 ||
				password.length > 1024 ||
				code.length > 16
			) {
				return error(res, 400, "INPUT", "登录信息格式无效");
			}
			const key = rateKey(req, identity);
			const ipKey = rateKey(req, "*");
			const identityAllowed = allowLogin(key);
			const ipAllowed = allowLogin(ipKey);
			if (!identityAllowed || !ipAllowed)
				return error(res, 429, "RATE_LIMIT", "尝试过多，请稍后重试");
			try {
				const session = await auth.login(identity, password, code);
				if (!session)
					return error(res, 401, "LOGIN_FAILED", "账号或验证信息不正确");
				attempts.delete(key);
				attempts.delete(ipKey);
				setCookie(res, session.token, 8 * 60 * 60);
				return send(res, 200, {
					ok: true,
					data: {
						id: session.owner.id,
						name: session.owner.name,
						expires: session.expires.toISOString(),
					},
				});
			} catch {
				return error(res, 503, "AUTH_UPSTREAM", "身份服务暂时不可用");
			}
		}
		if (url.pathname === "/api/logout" && req.method === "POST") {
			try {
				await auth.revoke(cookie(req));
				await auth.audit(null, "logout", "success");
				setCookie(res, "", 0);
				return send(res, 200, { ok: true, data: null });
			} catch {
				setCookie(res, "", 0);
				return error(res, 503, "SESSION_STORE", "会话撤销失败，请稍后重试");
			}
		}
		let owner: Awaited<ReturnType<AuthService["verify"]>>;
		try {
			owner = await auth.verify(cookie(req));
		} catch {
			return error(res, 503, "AUTH_UPSTREAM", "身份状态暂时无法验证");
		}
		if (!owner) return error(res, 401, "UNAUTHORIZED", "请重新登录");
		if (
			req.method === "GET" &&
			["/api/analytics", "/api/overview", "/api/overview/host"].includes(
				url.pathname,
			)
		) {
			try {
				if (url.pathname !== "/api/analytics" && url.search)
					throw new AnalyticsInputError();
				const data =
					url.pathname === "/api/analytics"
						? await analytics.report(url.searchParams)
						: url.pathname === "/api/overview/host"
							? await overview.host()
							: await overview.report(owner, cookie(req));
				return send(res, 200, { ok: true, data });
			} catch (cause) {
				return error(
					res,
					cause instanceof AnalyticsInputError ? 400 : 503,
					cause instanceof AnalyticsInputError
						? "ANALYTICS_INPUT"
						: "ANALYTICS_UNAVAILABLE",
					"统计参数无效或数据源暂时不可用",
				);
			}
		}
		if (url.pathname === "/api/me" && req.method === "GET")
			return send(res, 200, {
				ok: true,
				data: { id: owner.id, name: owner.name },
			});
		if (url.pathname.startsWith("/api/manage/")) {
			if (!management)
				return error(res, 503, "WALINE_OVERLAY_REQUIRED", "评论管理尚未配置");
			try {
				let data: unknown;
				const path = url.pathname;
				const item =
					/^\/api\/manage\/(comments|users)\/([1-9][0-9]*)(?:\/(status|edit|reply|delete|state))?$/u.exec(
						path,
					);
				if (path === "/api/manage/info" && req.method === "GET")
					data = management.info();
				else if (path === "/api/manage/sessions" && req.method === "GET")
					data = await auth.sessions(cookie(req), owner);
				else if (
					path === "/api/manage/sessions/revoke" &&
					req.method === "POST"
				) {
					const input = await managedBody(req);
					if (
						typeof input.id !== "string" ||
						!/^[0-9a-f-]{36}$/iu.test(input.id) ||
						Object.keys(input).some((key) => !["id", "requestId"].includes(key))
					)
						throw new ManagementError(400, "MANAGEMENT_INPUT");
					const signedOut = await auth.revokeSession(
						input.id,
						cookie(req),
						owner,
					);
					if (signedOut === null)
						throw new ManagementError(404, "MANAGEMENT_NOT_FOUND");
					await auth.managementAudit(
						owner.id,
						"session.revoke",
						"success",
						input.id,
						typeof input.requestId === "string"
							? uuid(input.requestId)
							: randomUUID(),
					);
					if (signedOut) setCookie(res, "", 0);
					data = { signedOut };
				} else if (path === "/api/manage/account" && req.method === "GET")
					data = await management.account(cookie(req), owner);
				else if (
					[
						"/api/manage/account/profile",
						"/api/manage/account/password",
					].includes(path) &&
					req.method === "POST"
				) {
					if (
						path.endsWith("/password") &&
						!allowLogin(rateKey(req, "account-password"))
					)
						throw new ManagementError(429, "RATE_LIMIT");
					data = await management.write(
						cookie(req),
						owner,
						"account",
						String(owner.id),
						path.endsWith("/profile") ? "profile" : "password",
						await managedBody(req, 32000),
					);
					if ((data as { signedOut: boolean }).signedOut) setCookie(res, "", 0);
				} else if (
					["/api/manage/comments", "/api/manage/users"].includes(path) &&
					req.method === "GET"
				)
					data = await management.list(
						cookie(req),
						owner,
						path.endsWith("comments") ? "comment" : "user",
						url.searchParams,
					);
				else if (item && req.method === "GET" && !item[3]) {
					const page = Number(url.searchParams.get("page") || 1);
					if (
						!Number.isSafeInteger(page) ||
						page < 1 ||
						page > 100000 ||
						[...url.searchParams.keys()].some((key) => key !== "page")
					)
						throw new ManagementError(400, "MANAGEMENT_INPUT");
					data = await management.detail(
						cookie(req),
						owner,
						item[1] === "comments" ? "comment" : "user",
						objectId(item[2]),
						page,
					);
				} else if (item && req.method === "POST" && item[3])
					data = await management.write(
						cookie(req),
						owner,
						item[1] === "comments" ? "comment" : "user",
						objectId(item[2]),
						item[3],
						await managedBody(req, 100000),
					);
				else return error(res, 404, "NOT_FOUND", "管理接口不存在");
				return send(res, 200, { ok: true, data });
			} catch (cause) {
				if (cause instanceof ManagementError) {
					if (cause.code === "WALINE_REAUTH") await auth.revoke(cookie(req));
					if (cause.status === 401) setCookie(res, "", 0);
					if (
						cause.code === "WRITE_UNKNOWN" &&
						url.pathname.endsWith("/account/password")
					)
						setCookie(res, "", 0);
					return error(res, cause.status, cause.code, cause.code);
				}
				return error(
					res,
					req.method === "GET" ? 503 : 409,
					req.method === "GET" ? "WALINE_RESPONSE" : "WRITE_UNKNOWN",
					"管理服务暂时无法确认结果",
				);
			}
		}
		if (url.pathname.startsWith("/api/library")) {
			if (!media)
				return error(res, 503, "MEDIA_NOT_CONFIGURED", "媒体库尚未配置");
			try {
				let data: unknown;
				const item =
					/^\/api\/library\/([0-9a-f-]+)(?:\/(original|preview|references|retry|trash|restore))?$/iu.exec(
						url.pathname,
					);
				if (url.pathname === "/api/library" && req.method === "GET")
					data = await media.list(
						owner.id,
						url.searchParams.get("trash") === "1",
						url.searchParams.get("type") || "all",
						Number(url.searchParams.get("page") || 1),
						url.searchParams.get("purpose") || "all",
					);
				else if (
					url.pathname === "/api/library/upload" &&
					req.method === "POST"
				) {
					if (req.headers["content-type"] !== "application/octet-stream")
						throw new DraftError(400, "INPUT");
					req.setTimeout(600_000, () => req.destroy());
					const timer = setTimeout(() => req.destroy(), 600_000);
					try {
						data = await media.upload(
							owner.id,
							uuid(req.headers["x-media-request"]),
							decodeURIComponent(String(req.headers["x-media-name"] || "")),
							Number(req.headers["content-length"]),
							req,
							req.headers["x-media-purpose"],
						);
					} finally {
						clearTimeout(timer);
						req.setTimeout(0);
					}
				} else if (
					item &&
					req.method === "GET" &&
					["original", "preview"].includes(item[2])
				)
					return await media.serve(owner.id, uuid(item[1]), item[2], req, res);
				else if (item && req.method === "GET" && item[2] === "references")
					data = await media.references(owner.id, uuid(item[1]));
				else if (item && req.method === "GET" && !item[2])
					data = await media.get(owner.id, uuid(item[1]));
				else if (item && req.method === "POST" && item[2] === "retry")
					data = await media.retry(owner.id, uuid(item[1]));
				else if (
					item &&
					req.method === "POST" &&
					["trash", "restore"].includes(item[2])
				)
					data = await media.deleted(
						owner.id,
						uuid(item[1]),
						item[2] === "trash",
					);
				else return error(res, 404, "NOT_FOUND", "接口不存在");
				return send(res, 200, { ok: true, data });
			} catch (cause) {
				if (cause instanceof DraftError)
					return error(res, cause.status, cause.code, "媒体操作未完成");
				if (cause instanceof URIError)
					return error(res, 400, "INPUT", "输入格式无效");
				return error(res, 503, "MEDIA_STORE", "媒体存储暂时不可用");
			}
		}
		if (
			/^\/api\/(?:publishing|jobs|releases|previews)(?:\/|$)/u.test(
				url.pathname,
			)
		) {
			if (!jobs)
				return error(res, 503, "TARGET_NOT_CONFIGURED", "发布执行器尚未配置");
			try {
				let data: unknown;
				const preview = /^\/api\/previews\/([0-9a-f-]+)\/(.*)$/iu.exec(
					url.pathname,
				);
				const task = /^\/api\/jobs\/([0-9a-f-]+)(\/retry)?$/iu.exec(
					url.pathname,
				);
				if (preview && req.method === "GET")
					return await servePreview(
						jobs,
						owner.id,
						uuid(preview[1]),
						decodeURIComponent(preview[2]),
						res,
						config.origin,
						req,
					);
				if (url.pathname === "/api/publishing" && req.method === "GET")
					data = await jobs.info();
				else if (
					url.pathname === "/api/publishing/diff" &&
					req.method === "POST"
				)
					data = await jobs.diff(owner.id, await body(req));
				else if (url.pathname === "/api/jobs" && req.method === "GET")
					data = await jobs.list(owner.id);
				else if (url.pathname === "/api/jobs" && req.method === "POST")
					data = await jobs.create(owner.id, await body(req));
				else if (task && !task[2] && req.method === "GET")
					data = await jobs.get(owner.id, uuid(task[1]));
				else if (task?.[2] && req.method === "POST")
					data = await jobs.retry(owner.id, uuid(task[1]));
				else if (url.pathname === "/api/releases" && req.method === "GET")
					data = await jobs.releaseList(url.searchParams.get("targetId") || "");
				else if (
					url.pathname === "/api/releases/rollback" &&
					req.method === "POST"
				)
					data = await jobs.rollback(owner.id, await body(req));
				else return error(res, 404, "NOT_FOUND", "接口不存在");
				return send(res, 200, { ok: true, data });
			} catch (cause) {
				if (cause instanceof DraftError)
					return send(res, cause.status, {
						ok: false,
						error: { code: cause.code, details: cause.details },
					});
				if (cause instanceof SyntaxError || cause instanceof URIError)
					return error(res, 400, "INPUT", "输入格式无效");
				return error(res, 503, "EXECUTOR_FAILED", "执行器暂时不可用");
			}
		}
		if (
			["/api/content/posts", "/api/content/dynamic"].includes(url.pathname) &&
			req.method === "GET"
		) {
			try {
				return send(res, 200, {
					ok: true,
					data: await listContent(config.contentRoot, parseQuery(url)),
				});
			} catch (cause) {
				if (cause instanceof Error && cause.message === "筛选参数无效")
					return error(res, 400, "QUERY", cause.message);
				console.error(
					"admin content read failed",
					cause instanceof Error ? cause.message : "unknown",
				);
				return error(
					res,
					500,
					"CONTENT_READ",
					"内容读取失败，请检查服务端日志",
				);
			}
		}
		if (
			url.pathname.startsWith("/api/drafts") ||
			url.pathname === "/api/media"
		) {
			if (!drafts) return error(res, 503, "NOT_CONFIGURED", "草稿存储尚未配置");
			try {
				let data: unknown;
				if (url.pathname === "/api/media" && req.method === "GET")
					data = await drafts.media(contentKind(url.searchParams.get("kind")));
				else if (url.pathname === "/api/drafts" && req.method === "GET")
					data = await drafts.list(
						owner.id,
						draftKind(url.searchParams.get("kind")),
						Number(url.searchParams.get("page") || 1),
					);
				else if (url.pathname === "/api/drafts" && req.method === "POST")
					data = await drafts.create(owner.id, await body(req, 4 * 524288));
				else {
					const match = /^\/api\/drafts\/([0-9a-f-]+)(\/save)?$/iu.exec(
						url.pathname,
					);
					if (!match) return error(res, 404, "NOT_FOUND", "接口不存在");
					const id = uuid(match[1]);
					if (!match[2] && req.method === "GET")
						data = await drafts.detail(await drafts.get(id, owner.id));
					else if (match[2] && req.method === "POST")
						data = await drafts.save(owner.id, id, await body(req, 4 * 524288));
					else return error(res, 405, "METHOD", "请求方法不支持");
				}
				return send(res, 200, { ok: true, data });
			} catch (cause) {
				if (cause instanceof DraftError)
					return send(res, cause.status, {
						ok: false,
						error: { code: cause.code, details: cause.details },
					});
				if (
					cause instanceof SyntaxError ||
					(cause instanceof Error &&
						["请求过大", "需要 JSON 请求", "JSON object required"].includes(
							cause.message,
						))
				)
					return error(res, 400, "INPUT", "请求格式无效或过大");
				return error(res, 503, "DRAFT_STORE", "草稿存储暂时不可用");
			}
		}
		return error(res, 404, "NOT_FOUND", "接口不存在");
	}
	return api;
}
