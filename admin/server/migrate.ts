import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.ADMIN_MIGRATION_DATABASE_URL;
if (!url)
	throw new Error(
		"缺少 ADMIN_MIGRATION_DATABASE_URL；不要用运行时账号执行迁移",
	);
const directory = fileURLToPath(new URL("./migrations/", import.meta.url));
const client = new pg.Client({ connectionString: url });
try {
	await client.connect();
	for (const name of (await readdir(directory))
		.filter((name) => /^\d+_.*\.sql$/u.test(name))
		.sort()) {
		await client.query(await readFile(`${directory}/${name}`, "utf8"));
	}
	process.stdout.write("后台数据库迁移完成\n");
} finally {
	await client.end();
}
