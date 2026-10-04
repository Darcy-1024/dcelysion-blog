import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { backupState, restoreState } from "../server/state-backup.js";

test("离线快照保留空目录和中文文件，拒绝未停写及秘密文件", async () => {
	const parent = await mkdtemp(join(tmpdir(), "dc-admin-backup-test-"));
	const source = join(parent, "source");
	await mkdir(join(source, "pg_twophase"), { recursive: true });
	await writeFile(join(source, "正文.md"), "保留原文！🙂");
	await assert.rejects(() =>
		backupState(
			parent,
			join(parent, "admin-recovery-unacknowledged"),
			{ data: source },
			{},
			false,
		),
	);
	const snapshot = join(parent, "admin-recovery-snapshot");
	await backupState(parent, snapshot, { data: source }, {}, true);
	const target = join(parent, "admin-recovery-target");
	await restoreState(parent, target, snapshot);
	assert.equal(
		await readFile(join(target, "data/正文.md"), "utf8"),
		"保留原文！🙂",
	);
	assert.equal(
		(await stat(join(target, "data/pg_twophase"))).isDirectory(),
		true,
	);
	await writeFile(join(source, ".ENV"), "synthetic");
	await assert.rejects(() =>
		backupState(
			parent,
			join(parent, "admin-recovery-secret"),
			{ data: source },
			{},
			true,
		),
	);
});
