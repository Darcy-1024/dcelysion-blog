/** Resolve stored comment paths only against the configured public blog. */
export function commentLink(path: string, blogOrigin: string): string | null {
	try {
		const base = new URL(blogOrigin);
		if (!["https:", "http:"].includes(base.protocol) || !path.trim())
			return null;
		const target = new URL(path, base.origin);
		if (target.origin !== base.origin || target.username || target.password)
			return null;
		if (
			/^\/dynamic\/[^/]+\/?$/.test(target.pathname) &&
			target.pathname !== "/dynamic/comments/"
		) {
			const result = new URL("/dynamic/comments/", base.origin);
			result.searchParams.set("path", target.pathname.replace(/\/?$/, "/"));
			result.hash = "post-comments";
			return result.href;
		}
		target.hash = "post-comments";
		return target.href;
	} catch {
		return null;
	}
}
