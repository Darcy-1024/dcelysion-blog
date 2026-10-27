export const fixedCommentSourceNames: ReadonlyMap<string, string> = new Map([
	["/guestbook/", "留言板"],
	["/about/", "关于我"],
	["/friends/", "友链"],
]);

function trustedOrigin(value: string): string | null {
	try {
		const url = new URL(value);
		return ["https:", "http:"].includes(url.protocol) &&
			!url.username &&
			!url.password
			? url.origin
			: null;
	} catch {
		return null;
	}
}

function hasControl(value: string): boolean {
	return Array.from(value).some((character) => {
		const code = character.charCodeAt(0);
		return code < 32 || code === 127;
	});
}

/** Lookup key only: callers must preserve the original comment URL and fingerprint. */
export function normalizeCommentSource(
	path: string,
	blogOrigin: string,
): string | null {
	const origin = trustedOrigin(blogOrigin);
	if (
		!origin ||
		!path ||
		path.length > 2048 ||
		/[\s\\]/u.test(path) ||
		hasControl(path) ||
		path.startsWith("//")
	)
		return null;
	try {
		if (!path.startsWith("/") && !/^https?:\/\//i.test(path)) return null;
		// Reject traversal before URL() can silently canonicalize it.
		const rawPath = path.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/, 1)[0];
		for (const segment of rawPath.split("/")) {
			const decoded = decodeURIComponent(segment);
			if (
				decoded === "." ||
				decoded === ".." ||
				/[%/\\]/u.test(decoded) ||
				hasControl(decoded)
			)
				return null;
		}
		const target = new URL(path, origin);
		if (target.origin !== origin || target.username || target.password)
			return null;
		const pathname = target.pathname.replace(/\/+$/, "");
		if (pathname.includes("//")) return null;
		const canonical = `${pathname
			.split("/")
			.map((segment) => encodeURIComponent(decodeURIComponent(segment)))
			.join("/")}/`;
		if (
			canonical === "/dynamic/" &&
			/^#dynamic-[a-zA-Z0-9_-]+$/.test(target.hash)
		)
			return canonical + target.hash;
		return canonical;
	} catch {
		return null;
	}
}
