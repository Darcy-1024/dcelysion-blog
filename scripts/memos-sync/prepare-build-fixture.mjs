// Local-only synthetic fixture, copied from the current reviewed source (including dirty source files).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { digest } from "./content.mjs";
import { synchronize } from "./index.mjs";
import { noLinks } from "./store.mjs";

const source = fileURLToPath(new URL("../../", import.meta.url));
await noLinks(path.join(source, "cache"));
await fs.mkdir(path.join(source, "cache"), { recursive: true });
const parent = await fs.mkdtemp(path.join(source, "cache/memos-stage2-"));
const root = path.join(parent, "source");
await fs.mkdir(root);
const paths = execFileSync(
	"git",
	["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
	{ cwd: source, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
)
	.split("\0")
	.filter(Boolean);
const manifest = {};
for (const name of paths) {
	if (
		!/^(src\/|public\/|scripts\/|admin\/shared\/|[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(?:json|jsonc|mjs|js|yaml|yml))$/u.test(
			name,
		) &&
		!/^(src|public|scripts|workers|admin\/shared)\//u.test(name)
	)
		continue;
	if (/(^|\/)\.env(?:\.|$)|\.pem$/iu.test(name))
		throw new Error("Secret path in source inventory");
	const from = path.join(source, name);
	await noLinks(from);
	const bytes = await fs.readFile(from);
	manifest[name] = digest(bytes);
	const to = path.join(root, name);
	await fs.mkdir(path.dirname(to), { recursive: true });
	await fs.writeFile(to, bytes);
}
for (const required of [
	"astro.config.mjs",
	"svelte.config.js",
	"postcss.config.mjs",
	"package.json",
	"workers/sites-static/index.js",
])
	await fs.access(path.join(root, required));
await fs.symlink(
	path.join(source, "node_modules"),
	path.join(root, "node_modules"),
	process.platform === "win32" ? "junction" : "dir",
);
const red = await sharp({
	create: {
		width: 1000,
		height: 700,
		channels: 4,
		background: { r: 240, g: 30, b: 40, alpha: 0.7 },
	},
})
	.png()
	.toBuffer();
const blue = await sharp({
	create: { width: 720, height: 1000, channels: 3, background: "#2040e0" },
})
	.png()
	.toBuffer();
const now = new Date("2026-10-18T04:00:00.000Z");
const memo = {
	name: "memos/stage2fixture",
	creator: "users/fixture",
	state: "NORMAL",
	visibility: "PUBLIC",
	createTime: now.toISOString(),
	updateTime: now.toISOString(),
	content:
		"阶段二合成验证，标点、表情原样！😋\n\n![蓝色在前](/file/attachments/blue/blue.png)\n\n中间文字。\n\n![透明红色在后](/file/attachments/red/red.png)",
	attachments: [
		{
			name: "attachments/red",
			memo: "memos/stage2fixture",
			filename: "red.png",
			type: "image/png",
			size: String(red.length),
		},
		{
			name: "attachments/blue",
			memo: "memos/stage2fixture",
			filename: "blue.png",
			type: "image/png",
			size: String(blue.length),
		},
	],
};
const client = {
	base: new URL("http://127.0.0.1:5231"),
	json: async (url) =>
		url.includes("auth/me")
			? { user: { name: memo.creator } }
			: { version: "0.31.0" },
	pages: async (url, _key, params) =>
		url.endsWith("/attachments")
			? memo.attachments
			: params.state === "NORMAL"
				? [memo]
				: [],
	memo: async () => memo,
	bytes: async (url) => (url.endsWith("/red") ? red : blue),
};
const config = {
	instanceId: "stage2-synthetic",
	baseUrl: client.base.origin,
	creator: memo.creator,
	timezone: "Asia/Shanghai",
	outputRoot: root,
	stateDir: path.join(parent, "private-state"),
	publish: false,
};
const receipt = await synchronize(config, { client, dryRun: false, now });
assert.equal(receipt.changes.length, 1);
const id = receipt.changes[0].id;
const history = Object.fromEntries(
	Object.entries(manifest).filter(([name]) =>
		name.startsWith("src/content/dynamic/"),
	),
);
for (const [name, sha] of Object.entries(history))
	assert.equal(digest(await fs.readFile(path.join(root, name))), sha);
await fs.writeFile(
	path.join(parent, "fixture-receipt.json"),
	JSON.stringify(
		{
			root,
			id,
			sourceManifest: manifest,
			historyFilesUnchanged: Object.keys(history).length,
			syntheticBody: memo.content,
			receipt,
		},
		null,
		2,
	),
);
console.log(
	JSON.stringify(
		{
			root,
			id,
			historyFilesUnchanged: Object.keys(history).length,
			receipt: path.join(parent, "fixture-receipt.json"),
		},
		null,
		2,
	),
);
