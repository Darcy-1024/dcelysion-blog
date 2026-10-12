import { readFile } from "node:fs/promises";

// The operator's private whole-interface monitor writes this short-lived file.
// No browser/manifest value can grant admission. Missing or stale means deny.
export async function hostMediaPermit(
	path: string | undefined,
	now = Date.now(),
) {
	if (!path) return false;
	try {
		const source = await readFile(path, "utf8");
		if (Buffer.byteLength(source) > 1024) return false;
		const permit = JSON.parse(source);
		return (
			permit.allowed === true &&
			Number.isSafeInteger(permit.expiresAt) &&
			permit.expiresAt > now &&
			permit.expiresAt <= now + 60000
		);
	} catch {
		return false;
	}
}
