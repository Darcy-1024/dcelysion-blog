import { resolve } from "node:path";

export type AdminConfig = {
	port: number;
	host: string;
	origin: string;
	cookieSecure: boolean;
	databaseUrl: string;
	walineDatabaseUrl: string;
	walineUrl: string;
	walineSecurityUrl: string;
	ownerId: number;
	contentRoot: string;
	blogOrigin: string;
	ready: boolean;
	missing: string[];
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
	const port = Number(env.ADMIN_PORT || 4322);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
		throw new Error("ADMIN_PORT 无效");
	const host = env.ADMIN_HOST || "127.0.0.1";
	const origin = env.ADMIN_ORIGIN || `http://127.0.0.1:${port}`;
	const parsed = new URL(origin);
	if (
		env.NODE_ENV === "production" &&
		(parsed.protocol !== "https:" || env.ADMIN_ALLOW_INSECURE_LOCAL === "1")
	)
		throw new Error("生产后台要求 HTTPS 且禁止 ADMIN_ALLOW_INSECURE_LOCAL");
	if (
		parsed.origin !== origin ||
		!["http:", "https:"].includes(parsed.protocol)
	)
		throw new Error("ADMIN_ORIGIN 必须是纯站点来源");
	const insecureLocal =
		env.ADMIN_ALLOW_INSECURE_LOCAL === "1" &&
		["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
		["127.0.0.1", "localhost", "::1"].includes(host);
	if (parsed.protocol !== "https:" && !insecureLocal)
		throw new Error(
			"后台仅允许 HTTPS；本地 HTTP 须显式启用 ADMIN_ALLOW_INSECURE_LOCAL=1",
		);
	const ownerId = Number(env.ADMIN_OWNER_WALINE_ID);
	const blogOrigin = env.ADMIN_BLOG_ORIGIN || "https://blog.dcelysion.cn";
	const blog = new URL(blogOrigin);
	if (
		blog.origin !== blogOrigin ||
		!["http:", "https:"].includes(blog.protocol)
	)
		throw new Error("ADMIN_BLOG_ORIGIN 必须是纯站点来源");
	const missing = [
		"ADMIN_DATABASE_URL",
		"ADMIN_WALINE_DATABASE_URL",
		"ADMIN_WALINE_URL",
		"ADMIN_OWNER_WALINE_ID",
	].filter((key) => !env[key]);
	if (
		env.ADMIN_OWNER_WALINE_ID &&
		(!Number.isSafeInteger(ownerId) || ownerId < 1)
	)
		throw new Error("ADMIN_OWNER_WALINE_ID 无效");
	if (env.ADMIN_WALINE_URL) {
		const waline = new URL(env.ADMIN_WALINE_URL);
		if (
			waline.pathname !== "/" ||
			waline.username ||
			waline.password ||
			waline.search ||
			waline.hash ||
			!["http:", "https:"].includes(waline.protocol)
		)
			throw new Error("ADMIN_WALINE_URL 无效");
		if (
			waline.protocol === "http:" &&
			!["127.0.0.1", "localhost", "[::1]"].includes(waline.hostname)
		)
			throw new Error("Waline HTTP 仅允许本地回环地址");
	}
	const securityUrl =
		env.ADMIN_WALINE_SECURITY_URL ||
		(env.ADMIN_WALINE_URL?.startsWith("https://")
			? `${env.ADMIN_WALINE_URL.replace(/\/$/u, "")}/ui/profile`
			: "");
	if (securityUrl) {
		const security = new URL(securityUrl);
		if (
			security.pathname !== "/ui/profile" ||
			security.username ||
			security.password ||
			security.search ||
			security.hash ||
			(security.protocol !== "https:" &&
				!(
					insecureLocal &&
					security.protocol === "http:" &&
					["127.0.0.1", "localhost", "[::1]"].includes(security.hostname)
				))
		)
			throw new Error(
				"ADMIN_WALINE_SECURITY_URL 必须是受信任的 /ui/profile 地址",
			);
	}
	return {
		port,
		host,
		origin,
		cookieSecure: parsed.protocol === "https:",
		ready: missing.length === 0,
		missing,
		databaseUrl: env.ADMIN_DATABASE_URL || "",
		walineDatabaseUrl: env.ADMIN_WALINE_DATABASE_URL || "",
		walineUrl: (env.ADMIN_WALINE_URL || "").replace(/\/$/u, ""),
		walineSecurityUrl: securityUrl,
		ownerId,
		contentRoot: resolve(env.ADMIN_CONTENT_ROOT || process.cwd()),
		blogOrigin,
	};
}
