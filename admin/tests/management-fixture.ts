// Explicit stage-six mock using the actual overlay read implementation. No production imports/URLs.
import { createRequire } from "node:module";
import { createApi } from "../server/api.js";
import { AuthService } from "../server/auth.js";
import { ManagementService } from "../server/management.js";
import { fixture } from "./fixture.js";

const require = createRequire(import.meta.url);
const { read } =
	require("../../deploy/tencent/waline-overlay/src/lib/management-read.js") as {
		read: (
			models: (name: string) => unknown,
			query: Record<string, unknown>,
		) => Promise<unknown>;
	};
type Row = Record<string, unknown>;
function matches(row: Row, where: Row): boolean {
	return Object.entries(where).every(([key, value]) => {
		if (key === "_logic") return true;
		if (key === "_complex") {
			const nested = value as Row;
			const predicates = Object.entries(nested)
				.filter(([k]) => k !== "_logic")
				.map(([k, v]) => matches(row, { [k]: v }));
			return nested._logic === "or"
				? predicates.some(Boolean)
				: predicates.every(Boolean);
		}
		if (Array.isArray(value)) {
			if (value[0] === "LIKE")
				return String(row[key] || "").includes(String(value[1]).slice(1, -1));
			if (value[0] === "NOT IN") return !value[1].includes(row[key]);
			if (value[0] === "IN")
				return value[1].map(String).includes(String(row[key]));
		}
		return String(row[key] ?? "") === String(value ?? "");
	});
}
export async function managementFixture(
	base?: Awaited<ReturnType<typeof fixture>>,
) {
	const f = base || (await fixture());
	const users: Row[] = [
		{
			objectId: 7,
			display_name: "隔离模拟管理员",
			email: "owner@example.invalid",
			url: "https://example.invalid",
			type: "administrator",
			auth_version: 0,
			password: "secret-hash",
			"2fa": "SECRET-NEVER-EXPOSE",
			createdAt: "2026-10-01",
		},
		{
			objectId: 8,
			display_name: "隔离普通用户",
			email: "user@example.invalid",
			url: "javascript:alert('bad')",
			type: "guest",
			auth_version: 0,
			password: "secret",
			"2fa": "secret",
			createdAt: "2026-10-01",
		},
	];
	const comments: Row[] = [
		{
			objectId: 1,
			comment: "隔离评论，标点！🙂\n<script>window.compromised=true</script>",
			nick: "<img onerror=alert(1)>",
			url: "/posts/example/",
			status: "waiting",
			pid: null,
			rid: null,
			user_id: 8,
			insertedAt: "2026-10-01T00:00:00Z",
			updatedAt: "2026-10-01T00:00:00Z",
		},
		{
			objectId: 2,
			comment: "同一线程回复",
			nick: "普通用户",
			url: "/posts/example/",
			status: "approved",
			pid: 1,
			rid: 1,
			user_id: 8,
			insertedAt: "2026-10-01T00:01:00Z",
			updatedAt: "2026-10-01T00:01:00Z",
		},
		{
			objectId: 3,
			comment: "其他文章，不应混入线程",
			nick: "其他访客",
			url: "/unknown/historical/",
			status: "spam",
			pid: null,
			rid: null,
			user_id: null,
			insertedAt: "2026-10-01T00:02:00Z",
			updatedAt: "2026-10-01T00:02:00Z",
		},
	];
	let fault = "";
	let newPassword = "preview";
	let nextId = 4;
	const requests: { method: string; path: string; input: Row }[] = [];
	const model = (name: string) => {
		const rows = name === "Users" ? users : comments;
		return {
			count: async (where: Row) =>
				rows.filter((row) => matches(row, where)).length,
			select: async (
				where: Row,
				options: {
					field?: string[];
					limit?: number;
					offset?: number;
					order?: { field: string; direction: string }[];
				} = {},
			) => {
				let result = rows
					.filter((row) => matches(row, where))
					.map((row) => ({ ...row }));
				for (const order of [...(options.order || [])].reverse())
					result.sort(
						(a, b) =>
							String(a[order.field]).localeCompare(String(b[order.field])) *
							(order.direction === "desc" ? -1 : 1),
					);
				if (options.limit)
					result = result.slice(
						options.offset || 0,
						(options.offset || 0) + options.limit,
					);
				// Match SQL adapter: append id (does not leak fields not selected).
				if (options.field) {
					options.field.push("id");
					result = result.map((row) =>
						Object.fromEntries(
							["objectId", ...(options.field || [])].map((key) => [
								key,
								row[key],
							]),
						),
					);
				}
				return result;
			},
		};
	};
	const fetcher: typeof fetch = async (input, options) => {
		const url = new URL(String(input));
		const method = options?.method || "GET";
		const body = options?.body ? (JSON.parse(String(options.body)) as Row) : {};
		requests.push({ method, path: url.pathname, input: body });
		if (method === "POST" && url.pathname === "/api/token") {
			if (body.email === "other" && body.password === "preview")
				return Response.json({
					errno: 0,
					data: { ...users[1], token: "fixture-8-0" },
				});
			return Response.json(
				body.email &&
					["preview", users[0].email].includes(String(body.email)) &&
					body.password === newPassword &&
					body.code === "123456"
					? {
							errno: 0,
							data: {
								...users[0],
								token: `fixture-7-${users[0].auth_version}`,
							},
						}
					: { errno: 1 },
			);
		}
		const authHeader = new Headers(options?.headers).get("authorization");
		if (authHeader !== `Bearer fixture-7-${users[0].auth_version}`)
			return new Response("", { status: 401 });
		if (fault === "401" || fault === "403")
			return new Response("", { status: Number(fault) });
		if (fault === "read-timeout" && method === "GET")
			throw new Error("isolated timeout");
		if (url.pathname === "/api/token")
			return Response.json({ errno: 0, data: users[0] });
		if (url.pathname === "/api/management") {
			const query: Row = Object.fromEntries(url.searchParams);
			for (const key of ["id", "page", "pageSize", "userId"])
				if (query[key]) query[key] = Number(query[key]);
			return Response.json({ errno: 0, data: await read(model, query) });
		}
		if (fault === "reject") return Response.json({ errno: 1 });
		const c = /^\/api\/comment\/(\d+)$/u.exec(url.pathname);
		if (c) {
			const row = comments.find((row) => row.objectId === Number(c[1]));
			if (!row) return Response.json({ errno: 1 });
			if (method === "PUT")
				Object.assign(row, body, { updatedAt: new Date().toISOString() });
			if (method === "DELETE")
				for (let i = comments.length - 1; i >= 0; i--)
					if (
						[comments[i].objectId, comments[i].pid, comments[i].rid]
							.map(String)
							.includes(c[1])
					)
						comments.splice(i, 1);
		} else if (url.pathname === "/api/comment" && method === "POST")
			comments.push({
				...body,
				objectId: nextId++,
				user_id: 7,
				status: "approved",
				insertedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			});
		else if (url.pathname === "/api/user" && method === "PUT") {
			if (body.password) {
				newPassword = String(body.password);
				users[0].auth_version = Number(users[0].auth_version) + 1;
				await f.db.query("UPDATE wl_users SET auth_version=$1 WHERE id=7", [
					users[0].auth_version,
				]);
			} else Object.assign(users[0], body);
		} else if (url.pathname === "/api/user/8" && method === "PUT") {
			if (
				users[1].type !== body.expectedType ||
				users[1].auth_version !== body.expectedVersion
			)
				return new Response("", { status: 409 });
			users[1].type = body.type;
			users[1].auth_version = Number(users[1].auth_version) + 1;
		} else return new Response("", { status: 404 });
		if (fault === "write-timeout")
			throw new Error("isolated timeout after write");
		if (fault === "write-500") return new Response("", { status: 500 });
		return Response.json({ errno: 0 });
	};
	const auth = new AuthService(f.config, {
		sessions: f.adapter,
		waline: f.adapter,
		fetcher,
	});
	const management = new ManagementService(f.config, auth, fetcher, {
		source: "隔离内存模拟评论与用户（未连接真实 Waline）",
		securityUrl: "",
		overlay: "模拟 Waline 1.41.6 / management-v1 契约",
	});
	return {
		...f,
		auth,
		management,
		users,
		comments,
		requests,
		setFault: (value: string) => {
			fault = value;
		},
		api: createApi(f.config, auth, f.drafts, null, null, management),
	};
}
