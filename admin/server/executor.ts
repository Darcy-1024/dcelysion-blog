import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { DraftError } from "./drafts.js";
import { inside } from "./paths.js";

const runFile = promisify(execFile);
// The executor owns command selection. No caller supplies a shell or raw arguments.
export async function command(
	program: string,
	args: string[],
	cwd?: string,
	input?: string,
) {
	const env: NodeJS.ProcessEnv = {
		PATH: process.env.PATH,
		SystemRoot: process.env.SystemRoot,
		TEMP: process.env.TEMP,
		TMP: process.env.TMP,
		HOME: process.env.HOME,
		USERPROFILE: process.env.USERPROFILE,
		GIT_TERMINAL_PROMPT: "0",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
		GIT_LFS_SKIP_SMUDGE: "1",
	};
	if (input === undefined)
		return (
			await runFile(program, args, {
				cwd,
				env,
				timeout: 60_000,
				maxBuffer: 16 * 1024 * 1024,
				windowsHide: true,
			})
		).stdout;
	return new Promise<string>((accept, reject) => {
		const child = spawn(program, args, {
			cwd,
			env,
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let output = "";
		let size = 0;
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error("EXECUTOR_TIMEOUT"));
		}, 60_000);
		child.stdout.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > 1024 * 1024) {
				child.kill();
				reject(new Error("EXECUTOR_OUTPUT"));
			} else output += chunk.toString();
		});
		// Raw process output is never returned in API errors or task logs.
		child.stderr.resume();
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) accept(output);
			else reject(new Error("EXECUTOR_COMMAND"));
		});
		child.stdin.end(input);
	});
}
export const bytesHash = (value: Buffer | string) =>
	createHash("sha256").update(value).digest("hex");
export function pathName(name: string) {
	if (
		!name ||
		isAbsolute(name) ||
		name.includes("\\") ||
		/[:\0%?#]/u.test(name) ||
		name
			.split("/")
			.some(
				(p) =>
					!p ||
					p === "." ||
					p === ".." ||
					p.startsWith(".env") ||
					/[. ]$/u.test(p),
			)
	)
		throw new DraftError(400, "PATH");
	return name;
}
export async function safeFile(root: string, name: string) {
	pathName(name);
	if ((await lstat(root)).isSymbolicLink()) throw new DraftError(400, "PATH");
	const base = await realpath(root);
	const file = resolve(base, name);
	if (!inside(base, file)) throw new DraftError(400, "PATH");
	let part = base;
	for (const segment of name.split("/")) {
		part = join(part, segment);
		if ((await lstat(part)).isSymbolicLink()) throw new DraftError(400, "PATH");
	}
	if (!inside(base, await realpath(file)) || !(await lstat(file)).isFile())
		throw new DraftError(400, "PATH");
	return file;
}
export async function tree(root: string) {
	if ((await lstat(root)).isSymbolicLink()) throw new DraftError(400, "PATH");
	const files: Record<string, string> = {};
	let total = 0;
	async function visit(folder: string, prefix = "") {
		for (const entry of await readdir(folder, { withFileTypes: true })) {
			const name = pathName(prefix + entry.name);
			const full = join(folder, entry.name);
			const info = await lstat(full);
			if (info.isSymbolicLink()) throw new DraftError(400, "PATH");
			if (info.isDirectory()) await visit(full, `${name}/`);
			else if (info.isFile()) {
				total += info.size;
				if (total > 512 * 1024 * 1024 || Object.keys(files).length >= 30000)
					throw new DraftError(400, "ARTIFACT_LIMIT");
				const checksum = createHash("sha256");
				for await (const bytes of createReadStream(full))
					checksum.update(bytes);
				files[name] = checksum.digest("hex");
			} else throw new DraftError(400, "PATH");
		}
	}
	await visit(await realpath(root));
	return files;
}
export async function validateArtifact(root: string, releaseMetadata = false) {
	const files = await tree(root);
	if (
		!releaseMetadata &&
		(files[".release-sha256"] || files[".release-files.json"])
	)
		throw new DraftError(400, "ARTIFACT_INVALID");
	for (const name of ["index.html", "404.html", "pagefind/pagefind.js"])
		if (!files[name] || !(await readFile(await safeFile(root, name))).length)
			throw new DraftError(400, "ARTIFACT_INVALID");
	if (!Object.keys(files).some((name) => name.startsWith("_astro/")))
		throw new DraftError(400, "ARTIFACT_INVALID");
	if (
		Object.keys(files).some((name) =>
			/(?:^|\/)(?:\.git|private-db|admin)(?:\/|$)/u.test(name),
		)
	)
		throw new DraftError(400, "ARTIFACT_INVALID");
	return files;
}
export async function writeControlled(
	root: string,
	name: string,
	value: string | Buffer,
) {
	pathName(name);
	const file = resolve(root, name);
	if (!inside(root, file)) throw new DraftError(400, "PATH");
	// Used only inside fresh executor-owned trees; symlinks are never imported.
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, value);
}
