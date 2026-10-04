// Run only trusted repository source, inside the pinned Linux dependency image.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const source = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const require = createRequire("/opt/blog/package.json");
const digest = (path) =>
	createHash("sha256").update(readFileSync(path)).digest("hex");
for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
	if (digest(join(source, file)) !== digest(join("/opt/blog", file)))
		throw new Error(`Dependency image mismatch: ${file}`);
process.chdir(source);
// pnpm 11's automatic dependency check refuses cross-project node_modules links.
// Exact input hashes above establish compatibility; invoke those installed CLIs.
if (
	!process.argv.includes("--reuse-typecheck") &&
	!process.argv.includes("--reuse-build")
) {
	execFileSync(
		process.execPath,
		[
			"/opt/blog/node_modules/typescript/bin/tsc",
			"--noEmit",
			"--project",
			"admin/tsconfig.json",
		],
		{ stdio: "inherit" },
	);
	execFileSync(
		process.execPath,
		[
			"/opt/blog/node_modules/svelte-check/bin/svelte-check",
			"--tsconfig",
			"admin/tsconfig.json",
		],
		{ stdio: "inherit" },
	);
}
// The runner loader does not create .vite-temp inside read-only image dependencies.
if (!process.argv.includes("--reuse-build")) {
	execFileSync(
		process.execPath,
		[
			"/opt/blog/node_modules/vite/bin/vite.js",
			"build",
			"--config",
			"admin/vite.config.ts",
			"--configLoader",
			"runner",
		],
		{ stdio: "inherit" },
	);
	mkdirSync(join(output, "admin/server"), { recursive: true });
	await require("esbuild").build({
		entryPoints: [join(source, "admin/server/index.ts")],
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		external: ["sharp", "vite", "../vite.config.js"],
		banner: {
			js: 'import { createRequire as dcCreateRequire } from "node:module"; const require = dcCreateRequire(import.meta.url);',
		},
		outfile: join(output, "admin/server/index.mjs"),
	});
}
cpSync(join(source, "admin/dist"), join(output, "admin/dist"), {
	recursive: true,
});
cpSync(join(source, "admin/build"), join(output, "admin/build"), {
	recursive: true,
});
cpSync(
	join(source, "admin/server/migrations"),
	join(output, "admin/server/migrations"),
	{ recursive: true },
);
const sharpRoot = realpathSync("/opt/blog/node_modules/sharp");
for (const name of [
	"sharp",
	"semver",
	"detect-libc",
	"@img/colour",
	"@img/sharp-linuxmusl-x64",
	"@img/sharp-libvips-linuxmusl-x64",
]) {
	const dependency =
		name === "sharp" ? sharpRoot : realpathSync(join(dirname(sharpRoot), name));
	const target = join(output, "node_modules", name);
	mkdirSync(target, { recursive: true });
	cpSync(dependency, target, {
		recursive: true,
		dereference: true,
		filter: (path) =>
			!relative(dependency, path).split("/").includes("node_modules"),
	});
}
const candidateRequire = createRequire(join(output, "admin/server/index.mjs"));
const sharp = candidateRequire("sharp");
await sharp({
	create: { width: 1, height: 1, channels: 3, background: "white" },
})
	.webp()
	.toBuffer();
console.log(
	JSON.stringify({
		nativeSharp: sharp.versions.sharp,
		libvips: sharp.versions.vips,
	}),
);
const entries = [];
function walk(directory) {
	for (const name of readdirSync(directory).sort()) {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) walk(path);
		else if (path !== join(output, "manifest.json"))
			entries.push({
				path: relative(output, path),
				bytes: statSync(path).size,
				sha256: digest(path),
			});
	}
}
walk(output);
const inputs = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
writeFileSync(
	join(output, "manifest.json"),
	JSON.stringify(
		{
			schema: 1,
			sourceBase: inputs.sourceBase,
			sourceManifestSHA256: digest(join(source, "manifest.json")),
			node: process.version,
			platform: process.platform,
			arch: process.arch,
			libc: "musl",
			entries,
		},
		null,
		2,
	),
);
console.log(
	JSON.stringify({
		candidateFiles: entries.length,
		serverBundled: true,
		clientBuilt: true,
	}),
);
