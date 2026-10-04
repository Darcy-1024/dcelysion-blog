import {
	cp,
	lstat,
	mkdir,
	readdir,
	readFile,
	readlink,
	rename,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Release } from "../shared/publishing.js";
import { DraftError } from "./drafts.js";
import {
	bytesHash,
	command,
	safeFile,
	tree,
	validateArtifact,
} from "./executor.js";
import { inside } from "./paths.js";

export type Package = {
	digest: string;
	archive: string;
	files: Record<string, string>;
	artifact: string;
	release: string;
};
export interface ReleaseDriver {
	list(): Promise<Release[]>;
	current(): Promise<string | null>;
	install(packageInfo: Package, expected: string | null): Promise<void>;
	rollback(id: string, expected: string | null): Promise<void>;
}
export function releaseId(value: unknown): string {
	if (typeof value !== "string" || !/^\d{8}-[a-f0-9]{12}$/u.test(value))
		throw new DraftError(400, "PATH");
	return value;
}
export async function packageArtifact(directory: string): Promise<Package> {
	const artifact = join(directory, "artifact");
	const files = await validateArtifact(artifact);
	const archive = join(directory, "site.tar.gz");
	await command("tar", ["-czf", archive, "-C", artifact, "."]);
	const digest = bytesHash(await readFile(archive));
	const release =
		new Date().toISOString().slice(0, 10).replaceAll("-", "") +
		"-" +
		digest.slice(0, 12);
	const result = { digest, archive, artifact, files, release };
	await writeFile(join(directory, "package.json"), JSON.stringify(result));
	return result;
}
export async function readPackage(directory: string): Promise<Package> {
	const result = JSON.parse(
		await readFile(await safeFile(directory, "package.json"), "utf8"),
	) as Package;
	if (
		!/^[a-f0-9]{64}$/u.test(result.digest) ||
		releaseId(result.release).slice(-12) !== result.digest.slice(0, 12)
	)
		throw new DraftError(409, "ARTIFACT_INVALID");
	result.archive = await safeFile(directory, "site.tar.gz");
	result.artifact = join(directory, "artifact");
	if (
		bytesHash(await readFile(result.archive)) !== result.digest ||
		JSON.stringify(await validateArtifact(result.artifact)) !==
			JSON.stringify(result.files)
	)
		throw new DraftError(409, "ARTIFACT_INVALID");
	return result;
}
// Test/local adapter; shares Tencent's site.tar.gz, YYYYMMDD-digest, marker and current layout.
// Production uses the Linux endpoint below rather than Windows rename guarantees.
export class LocalReleases implements ReleaseDriver {
	constructor(readonly root: string) {}
	async current() {
		try {
			const path = join(this.root, "current");
			if (process.platform === "win32") {
				if (!(await lstat(path)).isFile())
					throw new DraftError(409, "RELEASE_CONFLICT");
				return releaseId((await readFile(path, "utf8")).trim());
			}
			if (!(await lstat(path)).isSymbolicLink())
				throw new DraftError(409, "RELEASE_CONFLICT");
			const target = resolve(this.root, await readlink(path));
			if (!inside(join(this.root, "releases"), target))
				throw new DraftError(400, "PATH");
			return releaseId(target.split(/[\\/]/u).pop());
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw cause;
		}
	}
	async verified(id: string) {
		releaseId(id);
		const folder = join(this.root, "releases", id);
		const marker = await safeFile(folder, ".release-sha256");
		const digest = (await readFile(marker, "utf8")).trim();
		if (
			!/^[a-f0-9]{64}$/u.test(digest) ||
			digest.slice(0, 12) !== id.slice(-12)
		)
			throw new DraftError(409, "ARTIFACT_INVALID");
		const archive = await safeFile(
			join(this.root, "packages"),
			`${digest}.tar.gz`,
		);
		if (bytesHash(await readFile(archive)) !== digest)
			throw new DraftError(409, "ARTIFACT_INVALID");
		const manifest = JSON.parse(
			await readFile(await safeFile(folder, ".release-files.json"), "utf8"),
		);
		const files = await tree(folder);
		delete files[".release-sha256"];
		delete files[".release-files.json"];
		if (JSON.stringify(files) !== JSON.stringify(manifest))
			throw new DraftError(409, "ARTIFACT_INVALID");
		await validateArtifact(folder, true);
		return digest;
	}
	async list() {
		await mkdir(join(this.root, "releases"), { recursive: true });
		const current = await this.current();
		const result: Release[] = [];
		for (const name of await readdir(join(this.root, "releases"))) {
			if (/^\d{8}-[a-f0-9]{12}$/u.test(name))
				result.push({
					id: name,
					digest: await this.verified(name),
					current: name === current,
				});
		}
		return result.sort((a, b) => b.id.localeCompare(a.id));
	}
	async locked<T>(action: () => Promise<T>) {
		await mkdir(this.root, { recursive: true });
		const lock = join(this.root, ".admin-release.lock");
		try {
			await mkdir(lock);
		} catch {
			throw new DraftError(409, "EXECUTOR_BUSY");
		}
		try {
			return await action();
		} finally {
			const { rmdir } = await import("node:fs/promises");
			await rmdir(lock);
		}
	}
	private async switch(id: string, expected: string | null) {
		if ((await this.current()) !== expected)
			throw new DraftError(409, "RELEASE_CONFLICT");
		await this.verified(id);
		const next = join(this.root, ".current.next");
		try {
			await unlink(next);
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
		}
		if (process.platform === "win32") await writeFile(next, id);
		else await symlink(join(this.root, "releases", id), next, "dir");
		await rename(next, join(this.root, "current"));
	}
	async install(info: Package, expected: string | null) {
		await this.locked(async () => {
			if ((await this.current()) === info.release) {
				await this.verified(info.release);
				return;
			}
			if ((await this.current()) !== expected)
				throw new DraftError(409, "RELEASE_CONFLICT");
			await mkdir(join(this.root, "packages"), { recursive: true });
			await mkdir(join(this.root, "releases"), { recursive: true });
			if (bytesHash(await readFile(info.archive)) !== info.digest)
				throw new DraftError(409, "ARTIFACT_INVALID");
			await cp(
				info.archive,
				join(this.root, "packages", `${info.digest}.tar.gz`),
			);
			const folder = join(this.root, "releases", info.release);
			try {
				await lstat(folder);
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
				await cp(info.artifact, folder, {
					recursive: true,
					errorOnExist: true,
					force: false,
				});
				await writeFile(join(folder, ".release-sha256"), info.digest);
				await writeFile(
					join(folder, ".release-files.json"),
					JSON.stringify(info.files),
				);
			}
			await this.switch(info.release, expected);
		});
	}
	async rollback(id: string, expected: string | null) {
		await this.locked(() => this.switch(releaseId(id), expected));
	}
}
export class TencentReleases implements ReleaseDriver {
	constructor(private host: string) {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9@._-]*$/u.test(host))
			throw new Error("Invalid SSH host");
	}
	private async call(input: Record<string, unknown>) {
		const result = await command(
			"ssh",
			[
				"-o",
				"BatchMode=yes",
				"-o",
				"StrictHostKeyChecking=yes",
				this.host,
				"sudo -n /usr/local/libexec/dcelysion-admin-release",
			],
			undefined,
			JSON.stringify(input),
		);
		return JSON.parse(result);
	}
	async list(): Promise<Release[]> {
		return (await this.call({ action: "list" })).releases;
	}
	async current(): Promise<string | null> {
		return (await this.call({ action: "list" })).current;
	}
	async install(info: Package, expected: string | null) {
		await this.call({ action: "incoming", digest: info.digest });
		await command("scp", [
			"-o",
			"BatchMode=yes",
			"-o",
			"StrictHostKeyChecking=yes",
			info.archive,
			`${this.host}:/srv/dcelysion/admin-incoming/${info.digest}.tar.gz`,
		]);
		await this.call({
			action: "install",
			digest: info.digest,
			id: info.release,
			expected,
		});
	}
	async rollback(id: string, expected: string | null) {
		await this.call({ action: "rollback", id: releaseId(id), expected });
	}
}
