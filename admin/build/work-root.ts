import { lstat, mkdir, realpath, statfs } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export function diskFilesystem(type: number | bigint) {
	return Number(type) !== 0x01021994 && Number(type) !== 0x858458f6;
}
export async function prepareWorkRoot(value: string | undefined) {
	if (!value || !isAbsolute(value))
		throw new Error("BUILDER_DISK_ROOT_REQUIRED");
	const root = resolve(value);
	await mkdir(root, { mode: 0o700, recursive: true });
	const info = await lstat(root);
	if (
		!info.isDirectory() ||
		info.isSymbolicLink() ||
		(await realpath(root)) !== root ||
		info.uid !== process.getuid?.() ||
		(info.mode & 0o077) !== 0
	)
		throw new Error("BUILDER_DISK_ROOT_UNSAFE");
	await diskSpace(root);
	return root;
}
export async function diskSpace(root: string) {
	const info = await statfs(root, { bigint: true });
	if (
		!diskFilesystem(info.type) ||
		info.bavail * info.bsize < 2n * 1024n * 1024n * 1024n
	)
		throw new Error("BUILDER_DISK_RESERVE");
}
