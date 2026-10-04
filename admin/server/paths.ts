import { isAbsolute, relative, resolve, sep } from "node:path";
export function inside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return (
		!isAbsolute(rel) &&
		rel !== ".." &&
		!rel.startsWith(`..${sep}`) &&
		!resolve(target).startsWith("\\\\")
	);
}
