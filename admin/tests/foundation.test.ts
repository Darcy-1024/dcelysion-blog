import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { AuthService, digest } from "../server/auth.js";
import { readConfig } from "../server/config.js";
import { listContent } from "../server/content.js";

const env = {
	ADMIN_PORT: "4322",
	ADMIN_ORIGIN: "http://127.0.0.1:4322",
	ADMIN_ALLOW_INSECURE_LOCAL: "1",
	ADMIN_DATABASE_URL: "postgres://test",
	ADMIN_WALINE_DATABASE_URL: "postgres://test",
	ADMIN_WALINE_URL: "http://127.0.0.1:8360",
	ADMIN_OWNER_WALINE_ID: "7",
};

test("配置缺失不会启用默认管理员；HTTP 仅显式本地允许", () => {
	const missing = readConfig({ ADMIN_ALLOW_INSECURE_LOCAL: "1" });
	assert.equal(missing.ready, false);
	assert.equal(missing.ownerId, Number.NaN);
	assert.throws(() =>
		readConfig({ ...env, ADMIN_ORIGIN: "http://example.com" }),
	);
	assert.equal(readConfig(env).cookieSecure, false);
	assert.equal(
		readConfig({ ...env, ADMIN_ORIGIN: "https://admin.example.com" })
			.cookieSecure,
		true,
	);
});

test("Waline 账号、2FA、版本与会话撤销在隔离数据库中验证", async () => {
	const db = new PGlite();
	try {
		const migration = await readFile(
			fileURLToPath(
				new URL("../server/migrations/001_base.sql", import.meta.url),
			),
			"utf8",
		);
		await db.exec(migration);
		await db.exec(
			"CREATE TABLE wl_users (id integer PRIMARY KEY, display_name text, type text, auth_version integer); INSERT INTO wl_users VALUES (7,'博主','administrator',0),(8,'其他管理员','administrator',0),(9,'普通用户','guest',0)",
		);
		let responseUser = { objectId: 7, type: "administrator", auth_version: 0 };
		const fakeFetch: typeof fetch = async (_url, options) => {
			const input = JSON.parse(String(options?.body));
			return Response.json(
				input.password === "right" && input.code === "123456"
					? { errno: 0, data: responseUser }
					: { errno: 1 },
			);
		};
		const testDb = {
			query: (sql: string, values?: unknown[]) =>
				db.query<Record<string, unknown>>(
					sql,
					values as Parameters<typeof db.query>[1],
				),
		};
		const adapters = {
			sessions: testDb,
			waline: testDb,
			fetcher: fakeFetch,
		};
		const auth = new AuthService(readConfig(env), adapters);
		assert.equal(await auth.login("博主", "right", "wrong"), null);
		assert.equal(await auth.login("博主", "wrong", "123456"), null);
		responseUser = { objectId: 8, type: "administrator", auth_version: 0 };
		assert.equal(await auth.login("其他管理员", "right", "123456"), null);
		responseUser = { objectId: 9, type: "guest", auth_version: 0 };
		assert.equal(await auth.login("普通用户", "right", "123456"), null);
		responseUser = { objectId: 7, type: "administrator", auth_version: 0 };
		const session = await auth.login("博主", "right", "123456");
		assert.ok(session);
		assert.equal(
			(
				await db.query<{ count: number }>(
					"SELECT count(*)::int AS count FROM dc_admin.sessions",
				)
			).rows[0].count,
			1,
		);
		assert.deepEqual(await auth.verify(session.token), session.owner);
		const restarted = new AuthService(readConfig(env), adapters);
		assert.equal((await restarted.verify(session.token))?.id, 7);
		await db.exec("UPDATE wl_users SET auth_version=auth_version+1 WHERE id=7");
		assert.equal(await restarted.verify(session.token), null);
		const revoked = await db.query<{ revoked_at: Date }>(
			"SELECT revoked_at FROM dc_admin.sessions WHERE token_digest=$1",
			[digest(session.token)],
		);
		assert.ok(revoked.rows[0].revoked_at);
		responseUser = { objectId: 7, type: "administrator", auth_version: 1 };
		const next = await auth.login("博主", "right", "123456");
		assert.ok(next);
		await db.exec("UPDATE wl_users SET type='banned' WHERE id=7");
		assert.equal(await auth.verify(next.token), null);
		await db.exec("UPDATE wl_users SET type='administrator' WHERE id=7");
		const third = await auth.login("博主", "right", "123456");
		assert.ok(third);
		await auth.revoke(third.token);
		assert.equal(await restarted.verify(third.token), null);
		const expired = await auth.login("博主", "right", "123456");
		assert.ok(expired);
		await db.query(
			"UPDATE dc_admin.sessions SET expires_at=now()-interval '1 second' WHERE token_digest=$1",
			[digest(expired.token)],
		);
		assert.equal(await auth.verify(expired.token), null);
		const live = await auth.login("博主", "right", "123456");
		assert.ok(live);
		const failing = new AuthService(readConfig(env), {
			...adapters,
			waline: {
				query: async () => {
					throw new Error("offline");
				},
			},
		});
		await assert.rejects(() => failing.verify(live.token));
	} finally {
		await db.close();
	}
});

test("真实仓库内容的 MDX、草稿和分页读取", async () => {
	const root = fileURLToPath(new URL("../../", import.meta.url));
	const page = await listContent(root, {
		kind: "posts",
		search: "mdx-example",
		status: "draft",
		page: 1,
		pageSize: 3,
	});
	assert.equal(page.items.length, 1);
	assert.equal(page.items[0].format, "mdx");
	assert.equal(page.items[0].url, "/posts/mdx-example/");
	const dynamic = await listContent(root, {
		kind: "dynamic",
		search: "2026-09-26-225100",
		status: "all",
		page: 1,
		pageSize: 1,
	});
	assert.equal(dynamic.items.length, 1);
	assert.equal(dynamic.items[0].id, "2026-09-26-225100.md");
	assert.equal(dynamic.items[0].publishedDate, "2026-09-26");
});

test("异常 frontmatter 明确失败，嵌套目录和筛选分页可用", async () => {
	const root = await mkdtemp(join(tmpdir(), "dc-admin-content-"));
	const posts = join(root, "src", "content", "posts");
	try {
		await mkdir(join(posts, "nested"), { recursive: true });
		await writeFile(
			join(posts, "nested", "a.mdx"),
			"---\ntitle: Nested\npublished: 2026-09-29\ndraft: true\n---\nBody",
		);
		await writeFile(
			join(posts, "b.md"),
			"---\ntitle: Public\npublished: 2026-09-28\n---\nBody",
		);
		const query = {
			kind: "posts" as const,
			search: "",
			status: "all" as const,
			page: 1,
			pageSize: 1,
		};
		const first = await listContent(root, query);
		assert.equal(first.total, 2);
		assert.equal(first.pages, 2);
		assert.equal(first.items[0].id, "nested/a.mdx");
		assert.equal(
			(await listContent(root, { ...query, status: "published" })).items[0].id,
			"b.md",
		);
		await writeFile(
			join(posts, "bad.md"),
			"---\ntitle: Oops\npublished: invalid\n---\nBody",
		);
		await assert.rejects(
			() => listContent(root, query),
			/published 无效：bad.md/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
