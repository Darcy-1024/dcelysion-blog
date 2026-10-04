import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createApi } from "../server/api.js";
import { AuthService } from "../server/auth.js";
import { readConfig } from "../server/config.js";
import { DraftService } from "../server/drafts.js";

export const sample =
	'\uFEFF---\r\ntitle: 原标题 # 保留注释\r\npublished: 2026-09-30\r\ntags: [中文, "🙂"]\r\nunknown:\r\n  nested: {a: 1}\r\ndescription: |- # 说明\r\n  第一行\r\n  第二行\r\n---\r\n\r\nimport Badge from "./Badge";\r\n\r\n正文，标点！🙂  \r\n\r\n<Badge />\r\n';
export const dynamic =
	'---\npublished: 2026-09-30 12:00:00\nlocation: 广州\n---\n\n原始动态！🙂  \n\n![一](https://example.invalid/one.avif "标题")\n\n![重复](./images/two.avif)\n\n![重复](./images/two.avif)\n';
export async function fixture(port = 4324, directory?: string) {
	const root = directory || (await mkdtemp(join(tmpdir(), "dc-admin-stage2-")));
	const actualRoot = await realpath(root);
	if (
		dirname(actualRoot) !== (await realpath(tmpdir())) ||
		!basename(actualRoot).startsWith("dc-admin-stage2-")
	)
		throw new Error("隔离验收只能使用系统临时目录中的 dc-admin-stage2-* 目录");
	for (const kind of ["posts", "dynamic"])
		await mkdir(join(root, "src/content", kind), { recursive: true });
	if (!directory) {
		await writeFile(join(root, "src/content/posts/example.mdx"), sample);
		await writeFile(
			join(root, "src/content/dynamic/2026-09-30-120000.md"),
			dynamic,
		);
	}
	const db = new PGlite(join(root, "private-db"));
	const migrations = fileURLToPath(
		new URL("../server/migrations/", import.meta.url),
	);
	for (const name of (await readdir(migrations)).sort())
		await db.exec(await readFile(join(migrations, name), "utf8"));
	await db.exec(
		"CREATE TABLE IF NOT EXISTS wl_users (id integer PRIMARY KEY, display_name text, type text, auth_version integer); INSERT INTO wl_users VALUES (7,'隔离模拟管理员','administrator',0) ON CONFLICT (id) DO NOTHING;",
	);
	const adapter = {
		query: (sql: string, values?: unknown[]) =>
			db.query<Record<string, unknown>>(sql, values),
	};
	const config = readConfig({
		ADMIN_PORT: String(port),
		ADMIN_ORIGIN: `http://127.0.0.1:${port}`,
		ADMIN_ALLOW_INSECURE_LOCAL: "1",
		ADMIN_CONTENT_ROOT: root,
		ADMIN_DATABASE_URL: "postgres://isolated-test",
		ADMIN_WALINE_DATABASE_URL: "postgres://isolated-test",
		ADMIN_WALINE_URL: "http://127.0.0.1:8360",
		ADMIN_OWNER_WALINE_ID: "7",
	});
	const auth = new AuthService(config, {
		sessions: adapter,
		waline: adapter,
		fetcher: async (_url, options) => {
			const input = JSON.parse(String(options?.body));
			const owner = (
				await db.query<{ auth_version: number }>(
					"SELECT auth_version FROM wl_users WHERE id=7",
				)
			).rows[0];
			return Response.json(
				input.identity === "never"
					? { errno: 1 }
					: input.email === "preview" && input.password === "preview"
						? {
								errno: 0,
								data: {
									objectId: 7,
									type: "administrator",
									auth_version: owner.auth_version,
								},
							}
						: { errno: 1 },
			);
		},
	});
	const drafts = new DraftService(root, "", adapter);
	return {
		root,
		db,
		config,
		adapter,
		auth,
		drafts,
		api: createApi(config, auth, drafts),
	};
}
