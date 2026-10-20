// The administrator pins one trusted, separate HTTPS origin. No browser PAT,
// query parameters, arbitrary paths, credential forwarding or same-origin proxy.
export function memosOrigin(
	value: string | undefined,
	adminOrigin: string,
): string {
	if (!value) return "";
	const parsed = new URL(value);
	if (
		parsed.protocol !== "https:" ||
		parsed.origin !== value ||
		!/^([a-z0-9-]+\.)+[a-z0-9-]+$/iu.test(parsed.hostname) ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash ||
		parsed.origin === adminOrigin
	)
		throw new Error(
			"ADMIN_MEMOS_ORIGIN 必须是独立的受信 HTTPS 来源，不含路径或凭据",
		);
	return parsed.origin;
}

export function adminCsp(origin = "", bridgeEnabled = false) {
	return `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-src 'self'${origin ? ` ${origin}` : ""}; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'${origin && bridgeEnabled ? ` ${origin}` : ""}`;
}

export function memosUpstream(value: string): string {
	const url = new URL(value);
	const loopback = ["127.0.0.1", "[::1]"].includes(url.hostname);
	// The sole named exception is an operator-provisioned alias on a dedicated
	// internal Docker network. Never accept browser-selected upstream addresses.
	const privateDocker = url.origin === "http://dc-memos-origin:5230";
	if (
		url.protocol !== "http:" ||
		(!loopback && !privateDocker) ||
		url.origin !== value ||
		url.username ||
		url.password
	)
		throw new Error(
			"Memos 上游必须是精确回环来源或专用私网别名 dc-memos-origin:5230",
		);
	return url.origin;
}
