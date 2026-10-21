// Rebuild a reviewed frontend from the exact upstream archive, never generated edits.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [archive, workspace, output] = process.argv
	.slice(2)
	.map((value) => path.resolve(value));
if (
	!archive ||
	!workspace ||
	!output ||
	output.startsWith(workspace + path.sep)
)
	throw new Error(
		"Usage: node build.mjs <upstream.tar.gz> <new-workspace> <new-output>",
	);
const proof = JSON.parse(
	await fs.readFile(path.join(here, "provenance.json"), "utf8"),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const patch = path.join(here, "emoji.patch");
if (
	hash(await fs.readFile(archive)) !== proof.archiveSHA256 ||
	hash(await fs.readFile(patch)) !== proof.patchSHA256
)
	throw new Error("Pinned source or patch digest mismatch");
if (Number(process.versions.node.split(".")[0]) < 24)
	throw new Error("Node 24 required");
await fs.mkdir(workspace); // Intentionally refuses existing checkouts and drafts.
await fs.mkdir(output);
const run = (cmd, args, cwd = workspace, env = process.env) =>
	execFileSync(cmd, args, { cwd, stdio: "inherit", env });
run("tar", ["-xzf", archive, "--strip-components=1", "-C", workspace]);
if (
	hash(await fs.readFile(path.join(workspace, "web/pnpm-lock.yaml"))) !==
	proof.lockSHA256
)
	throw new Error("Dependency lock mismatch");
run("git", ["init", "--quiet"]);
run("git", ["apply", "--unidiff-zero", "--check", patch]);
run("git", ["apply", "--unidiff-zero", patch]);
for (const entry of proof.sourceFiles) {
	if (
		hash(await fs.readFile(path.join(workspace, entry.path))) !==
		entry.afterSHA256
	)
		throw new Error(`Patched source mismatch: ${entry.path}`);
}
const web = path.join(workspace, "web");
const pnpm = (...args) =>
	run("corepack", ["pnpm@11.0.1", ...args], web, {
		...process.env,
		NODE_ENV:
			args[0] === "release"
				? "production"
				: args[0] === "test"
					? "test"
					: "development",
	});
pnpm("install", "--frozen-lockfile");
pnpm("lint");
pnpm(
	"test",
	"tests/insert-menu.test.tsx",
	"tests/editor-controller.test.ts",
	"tests/formatting-toolbar.test.tsx",
	"tests/locale-resources.test.ts",
	"--maxWorkers=1",
	"--testTimeout=20000",
);
pnpm("release");
await fs.cp(path.join(workspace, "server/frontend/dist"), output, {
	recursive: true,
});
await fs.copyFile(
	path.join(workspace, "LICENSE"),
	path.join(output, "LICENSE.txt"),
);
const entries = [];
async function walk(parent) {
	for (const item of await fs.readdir(parent, { withFileTypes: true })) {
		const file = path.join(parent, item.name);
		if (item.isSymbolicLink()) throw new Error("Frontend links refused");
		if (item.isDirectory()) await walk(file);
		else if (item.isFile()) {
			const bytes = await fs.readFile(file);
			entries.push({
				path: path.relative(output, file).split(path.sep).join("/"),
				bytes: bytes.length,
				sha256: hash(bytes),
			});
		}
	}
}
await walk(output);
entries.sort((a, b) => a.path.localeCompare(b.path));
await fs.writeFile(
	path.join(output, "frontend-manifest.json"),
	JSON.stringify(
		{
			schema: 1,
			upstreamCommit: proof.upstreamCommit,
			patchSHA256: proof.patchSHA256,
			entries,
		},
		null,
		2,
	),
);
console.log(JSON.stringify({ status: "built", files: entries.length, output }));
