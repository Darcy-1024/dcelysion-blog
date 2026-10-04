// Snapshot the current worktree without staging it or copying secrets/generated caches.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, lstat, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(".");
const output = resolve(process.argv[2] || "cache/admin-launch-20261004");
if (
	!output.startsWith(`${root}\\cache\\`) &&
	!output.startsWith(`${root}/cache/`)
)
	throw new Error("Output must be inside the ignored cache directory");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const candidates = git(
	"ls-files",
	"--cached",
	"--others",
	"--exclude-standard",
	"-z",
).split("\0");
const tracked = new Set(git("ls-files", "-z").split("\0"));
const changes = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
	encoding: "utf8",
})
	.split("\0")
	.filter(Boolean)
	.map((line) => ({ path: line.slice(3), status: line.slice(0, 2) }));
const excluded = [];
const entries = [];
for (const name of [...new Set(candidates)].filter(Boolean).sort()) {
	const allowed =
		/^(?:admin|deploy\/tencent|docs|scripts|src|public|workers|\.github)\//.test(
			name,
		) ||
		name === ".openai/hosting.json" ||
		/^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|astro\.config\.mjs|svelte\.config\.js|postcss\.config\.mjs|pagefind\.yml|vercel\.json|wrangler\.jsonc|tsconfig\.json|biome\.json|_frontmatter\.json|tailwind\.config\.[^/]+|README(?:\.[a-z]+)?\.md|LICENSE|CONTRIBUTING\.md|\.gitattributes|\.gitignore|\.npmrc)$/.test(
			name,
		);
	const forbidden =
		/(?:^|\/)(?:node_modules|dist|cache|\.astro|\.git|\.agents|\.codex|\.env(?:\.[^/]*)?)\//.test(
			name,
		) ||
		(/(?:^|\/)\.env(?:\.[^/]*)?$/.test(name) &&
			!name.endsWith(".env.example")) ||
		/\.(?:pem|key|dump|log|sqlite|db)$/.test(name);
	if (!allowed || forbidden) {
		excluded.push(name);
		continue;
	}
	const path = resolve(root, name);
	const st = await lstat(path);
	if (!st.isFile() || st.isSymbolicLink())
		throw new Error(`Not a regular file: ${name}`);
	const bytes = await readFile(path);
	entries.push({
		path: name,
		bytes: bytes.length,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		status: tracked.has(name) ? "tracked" : "new",
	});
}
await mkdir(output, { recursive: true });
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const manifest = {
	schema: 1,
	createdAt: new Date().toISOString(),
	sourceBase: git("rev-parse", "HEAD"),
	sourceBranch: git("branch", "--show-current"),
	version: pkg.version,
	node: pkg.engines.node,
	packageManager: pkg.packageManager,
	migrations: entries.filter((e) =>
		/^admin\/server\/migrations\//.test(e.path),
	),
	worktreeChanges: changes.filter((change) =>
		entries.some(
			(entry) =>
				entry.path === change.path || entry.path.startsWith(change.path),
		),
	),
	excluded,
	entries,
};
await writeFile(
	`${output}/source-manifest.json`,
	JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
	`${output}/source-files.txt`,
	entries.map((e) => e.path).join("\n") + "\n",
);
for (const e of entries) {
	const target = `${output}/source/${e.path}`;
	await mkdir(dirname(target), { recursive: true });
	await copyFile(e.path, target);
}
execFileSync("tar", [
	"-czf",
	`${output}/source.tar.gz`,
	"-C",
	`${output}/source`,
	".",
]);
const buildEntries = entries.filter(
	(e) =>
		/^(?:admin|src\/(?:config|types|utils|constants|i18n))\//.test(e.path) ||
		/^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.json)$/.test(
			e.path,
		),
);
if (process.argv.includes("--source-only")) {
	const bytes = await readFile(`${output}/source.tar.gz`);
	const archive = {
		name: "source.tar.gz",
		bytes: bytes.length,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
	await writeFile(
		`${output}/source-archive.json`,
		JSON.stringify(archive, null, 2) + "\n",
	);
	console.log(JSON.stringify({ files: entries.length, archive }));
	process.exit(0);
}
for (const e of buildEntries) {
	const target = `${output}/build-input/${e.path}`;
	await mkdir(dirname(target), { recursive: true });
	await copyFile(e.path, target);
}
await writeFile(
	`${output}/build-input/manifest.json`,
	JSON.stringify({ ...manifest, entries: buildEntries }, null, 2),
);
execFileSync("tar", [
	"-czf",
	`${output}/build-input.tar.gz`,
	"-C",
	`${output}/build-input`,
	".",
]);
const archives = [];
for (const name of ["source.tar.gz", "build-input.tar.gz"]) {
	const bytes = await readFile(`${output}/${name}`);
	archives.push({
		name,
		bytes: bytes.length,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	});
}
await writeFile(
	`${output}/archives.json`,
	JSON.stringify(archives, null, 2) + "\n",
);
console.log(
	JSON.stringify({
		files: entries.length,
		buildFiles: buildEntries.length,
		archives,
	}),
);
