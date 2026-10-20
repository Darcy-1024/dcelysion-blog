import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	lstat,
	readdir,
	readFile,
	realpath,
	stat,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// Run against a disposable source copy with its own src/public/dist/.astro/cache.
// node_modules may be linked to the installed dependencies; source/output must not be.
const { values } = parseArgs({
	options: {
		root: { type: "string" },
		id: { type: "string" },
		pnpm: { type: "string" },
		"direct-existing-tools": { type: "boolean" },
		help: { type: "boolean" },
	},
});
if (values.help) {
	console.log(
		"node scripts/memos-sync/verify-build.mjs --root <isolated-source> --id <synthetic-id> [--pnpm <absolute-pnpm.cjs>]",
	);
	process.exit(0);
}
assert(values.root && values.id, "--root and --id are required");
const root = await realpath(path.resolve(values.root));
const liveRoot = await realpath(
	fileURLToPath(new URL("../../", import.meta.url)),
);
assert(
	root !== liveRoot,
	"Refusing to build in this script's source repository; provide an isolated source copy",
);
const inside = (base, target) => {
	const relative = path.relative(base, target);
	return (
		relative === "" ||
		(!relative.startsWith(`..${path.sep}`) &&
			relative !== ".." &&
			!path.isAbsolute(relative))
	);
};

async function checkOwnedTree(target) {
	let info;
	try {
		info = await lstat(target);
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
	assert(
		!info.isSymbolicLink(),
		`Source/output links are forbidden: ${target}`,
	);
	assert(
		inside(root, await realpath(target)),
		`Path escapes isolated root: ${target}`,
	);
	if (info.isDirectory()) {
		for (const entry of await readdir(target))
			await checkOwnedTree(path.join(target, entry));
	}
}

for (const name of [
	"src",
	"public",
	"dist",
	".astro",
	"cache",
	".cache",
	".font-cache",
])
	await checkOwnedTree(path.join(root, name));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
assert(pkg.scripts?.build, "Missing package build pipeline");
assert(
	pkg.packageManager?.startsWith("pnpm@"),
	"Expected a pinned pnpm packageManager",
);
const requireFromRoot = createRequire(path.join(root, "package.json"));
const matter = requireFromRoot("gray-matter");
// Use the installed Astro ID implementation, including spaces and Unicode rules.
const astroPackage = requireFromRoot.resolve("astro/package.json");
const { getContentEntryIdAndSlug } = await import(
	pathToFileURL(path.join(path.dirname(astroPackage), "dist/content/utils.js"))
		.href
);
const contentDir = path.join(root, "src/content/dynamic");
const expected = [];
const sourceImages = [];
async function collect(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const filename = path.join(directory, entry.name);
		if (entry.isDirectory()) await collect(filename);
		else if (entry.name.endsWith(".md")) {
			const parsed = matter(await readFile(filename, "utf8"));
			if (parsed.data.draft === true) continue;
			const id = String(
				parsed.data.slug ??
					getContentEntryIdAndSlug({
						entry: pathToFileURL(filename),
						contentDir: pathToFileURL(`${contentDir}${path.sep}`),
						collection: "",
					}).slug,
			).replace(/\.(md|mdx)$/i, "");
			expected.push(id);
			if (id === values.id) {
				const images = [
					...parsed.content.matchAll(
						/!\[[^\]]*\]\((\S+?)(?:\s+["'][^"']*["'])?\)/g,
					),
				].map((match) => match[1]);
				assert(
					images.length > 0,
					"Synthetic fixture must contain at least one local raster image",
				);
				for (const image of images) {
					assert(
						image.startsWith("./images/"),
						`Expected a local fixture image: ${image}`,
					);
					const source = path.resolve(contentDir, image);
					assert(
						inside(contentDir, source),
						"Fixture image escapes content directory",
					);
					sourceImages.push({
						source,
						hash: createHash("sha256")
							.update(await readFile(source))
							.digest("hex"),
					});
				}
			}
		}
	}
}
await collect(contentDir);
assert(
	expected.includes(values.id),
	`Synthetic public source ID not found: ${values.id}`,
);
assert(
	new Set(expected).size === expected.length,
	"Public source has duplicate dynamic IDs",
);

const env = {
	...process.env,
	ASTRO_TELEMETRY_DISABLED: "1",
	npm_config_manage_package_manager_versions: "false",
};
const pathKey =
	Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
env[pathKey] =
	`${path.join(root, "node_modules/.bin")}${path.delimiter}${env[pathKey] ?? ""}`;
// Force the local build branch: never invoke CI release packaging in this harness.
for (const key of ["WORKERS_CI", "GITHUB_ACTIONS", "CF_WORKERS"])
	delete env[key];
function run(command, args, capture = false) {
	return new Promise((resolve, reject) => {
		let output = "";
		const child = spawn(command, args, {
			cwd: root,
			env,
			stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
			windowsHide: true,
		});
		if (capture)
			child.stdout.on("data", (data) => {
				output += data;
			});
		child.once("error", reject);
		child.once("exit", (code, signal) =>
			code === 0
				? resolve(output.trim())
				: reject(
						new Error(`Build command failed: exit=${code} signal=${signal}`),
					),
		);
	});
}
if (values["direct-existing-tools"]) {
	const isolatedConfig = path.join(root, ".memos-build.config.mjs");
	await writeFile(
		isolatedConfig,
		'import config from "./astro.config.mjs";\nexport default {...config, cacheDir:"./cache/astro", vite:{...config.vite, cacheDir:"./cache/vite"}};\n',
	);
	// pnpm 11 may auto-install in a copied workspace. Execute the SAME build steps
	// via existing tools so a dependency junction cannot trigger installation/removal.
	for (const step of pkg.scripts.build.split(/\s+&&\s+/u)) {
		const args = step.split(/\s+/u);
		if (args[0] === "npx" && args[1] === "tsx") {
			const tsx = path.join(
				path.dirname(requireFromRoot.resolve("tsx/package.json")),
				"dist/cli.mjs",
			);
			await run(process.execPath, [tsx, ...args.slice(2)]);
		} else if (args[0] === "astro") {
			await run(process.execPath, [
				path.join(path.dirname(astroPackage), "bin/astro.mjs"),
				...args.slice(1),
				"--config",
				path.basename(isolatedConfig),
			]);
		} else if (args[0] === "node") await run(process.execPath, args.slice(1));
		else throw new Error(`Unsupported direct build step: ${step}`);
	}
} else if (values.pnpm) {
	assert(
		path.isAbsolute(values.pnpm),
		"--pnpm must be an absolute installed pnpm JS entrypoint",
	);
	assert(
		/\.(cjs|mjs|js)$/i.test(values.pnpm),
		"--pnpm must point to pnpm's JS entrypoint",
	);
	const actual = await run(process.execPath, [values.pnpm, "--version"], true);
	assert.equal(
		actual,
		pkg.packageManager.split("@")[1].split("+")[0],
		"Installed pnpm differs from packageManager",
	);
	await run(process.execPath, [values.pnpm, "build"]);
} else {
	// Invoke Corepack's JS entrypoint with Node, avoiding .cmd shell quoting on Windows.
	const corepack = path.join(
		path.dirname(process.execPath),
		"node_modules/corepack/dist/corepack.js",
	);
	await stat(corepack);
	await run(process.execPath, [corepack, "pnpm", "build"]);
}

const dist = path.join(root, "dist");
const records = JSON.parse(
	await readFile(path.join(dist, "api/dynamic.json"), "utf8"),
);
assert(Array.isArray(records), "dynamic.json must be an array");
const ids = records.map((record) => record.id);
assert.equal(new Set(ids).size, ids.length, "Built dynamic IDs must be unique");
assert.deepEqual(
	[...ids].sort(),
	[...expected].sort(),
	"Built public dynamic IDs differ from source; history may be missing",
);
const record = records.find((item) => item.id === values.id);
assert(
	record && Number.isFinite(record.published),
	"Synthetic record is missing or invalid",
);
assert.equal(
	record.images?.length,
	sourceImages.length,
	"Synthetic image count differs from source",
);
const verifiedResources = new Set();
async function verifyResource(resource) {
	assert(
		typeof resource === "string" &&
			resource.startsWith("/") &&
			!resource.startsWith("//"),
		`Expected local output resource: ${resource}`,
	);
	const filename = path.resolve(
		dist,
		`.${decodeURIComponent(resource.split(/[?#]/)[0])}`,
	);
	assert(inside(dist, filename), `Output resource escapes dist: ${resource}`);
	assert(
		inside(dist, await realpath(filename)),
		`Output resource link escapes dist: ${resource}`,
	);
	assert(
		(await stat(filename)).isFile(),
		`Missing output resource: ${resource}`,
	);
	assert((await stat(filename)).size > 0, `Empty output resource: ${resource}`);
	verifiedResources.add(resource);
	return filename;
}
for (const [index, image] of record.images.entries()) {
	const original = await verifyResource(image.src);
	const source = sourceImages[index];
	assert.equal(
		createHash("sha256")
			.update(await readFile(original))
			.digest("hex"),
		source.hash,
		"Built original image bytes/order differ from fixture",
	);
	if (!/\.svg$/i.test(source.source)) {
		assert(
			image.preview?.src,
			"Raster preview missing (silent fallback is not a verification pass)",
		);
		await verifyResource(image.preview.src);
		// Astro can omit srcSet when the original is smaller than all requested widths.
		for (const item of (image.preview.srcSet || "").split(",").filter(Boolean))
			await verifyResource(item.trim().split(/\s+/)[0]);
	}
	assert.equal(
		createHash("sha256")
			.update(await readFile(source.source))
			.digest("hex"),
		source.hash,
		"Build changed source image bytes",
	);
}
await verifyResource("/dynamic/index.html");
await verifyResource("/dynamic/comments/index.html");
console.log(
	JSON.stringify(
		{
			status: "passed",
			root,
			fullPackageBuild: pkg.scripts.build,
			runner: values["direct-existing-tools"]
				? "direct-existing-tools"
				: "pnpm",
			syntheticId: values.id,
			publicDynamicRecords: ids.length,
			historyRecordsRetained: ids.length - 1,
			verifiedResources: [...verifiedResources],
			commentPath: `/dynamic/${values.id}/`,
			limitations:
				"Local full-build and artifact verification only; no browser interaction, Memos server access, Git commit/push or deployment.",
		},
		null,
		2,
	),
);
