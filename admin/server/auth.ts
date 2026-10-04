import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import type { AdminConfig } from "./config.js";

export type Owner = { id: number; name: string; version: number };
export type Session = { token: string; owner: Owner; expires: Date };
type Queryable = {
	query(
		sql: string,
		values?: unknown[],
	): Promise<{ rows: Record<string, unknown>[] }>;
};

export function digest(token: string): Buffer {
	return createHash("sha256").update(token).digest();
}

export class AuthService {
	private bridges = new Map<
		string,
		{ bearer: string; owner: Owner; expires: number }
	>();
	private pool: Queryable;
	private walinePool: Queryable;
	private ownedPools: pg.Pool[] = [];
	constructor(
		private config: AdminConfig,
		adapters?: {
			sessions: Queryable;
			waline: Queryable;
			fetcher?: typeof fetch;
		},
	) {
		if (adapters) {
			this.pool = adapters.sessions;
			this.walinePool = adapters.waline;
			this.fetcher = adapters.fetcher || fetch;
		} else {
			const sessions = new pg.Pool({
				connectionString: config.databaseUrl,
				max: 5,
			});
			const waline = new pg.Pool({
				connectionString: config.walineDatabaseUrl,
				max: 3,
			});
			this.pool = sessions;
			this.walinePool = waline;
			this.ownedPools = [sessions, waline];
			this.fetcher = fetch;
		}
	}
	private fetcher: typeof fetch;
	async close() {
		this.bridges.clear();
		await Promise.all(this.ownedPools.map((pool) => pool.end()));
	}
	private async currentOwner(id: number): Promise<Owner | null> {
		if (id !== this.config.ownerId) return null;
		const result = await this.walinePool.query(
			"SELECT id, display_name, type, auth_version FROM wl_users WHERE id = $1",
			[id],
		);
		const row = result.rows[0];
		return row?.type === "administrator" &&
			Number.isSafeInteger(Number(row.auth_version))
			? {
					id: Number(row.id),
					name: String(row.display_name),
					version: Number(row.auth_version),
				}
			: null;
	}
	async login(
		identity: string,
		password: string,
		code: string,
	): Promise<Session | null> {
		const response = await this.fetcher(`${this.config.walineUrl}/api/token`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				referer: `${this.config.walineUrl}/ui/`,
			},
			body: JSON.stringify({ email: identity, password, code }),
			signal: AbortSignal.timeout(8000),
		});
		if (!response.ok) throw new Error("Waline 连接失败");
		const result: unknown = await response.json();
		if (!result || typeof result !== "object")
			throw new Error("Waline 响应无效");
		const value = result as {
			errno?: unknown;
			data?: {
				objectId?: unknown;
				type?: unknown;
				auth_version?: unknown;
				token?: unknown;
			};
		};
		if (value.errno !== 0) {
			await this.audit(null, "login", "denied");
			return null;
		}
		const user = value.data;
		const id = Number(user?.objectId);
		if (
			!Number.isSafeInteger(id) ||
			user?.type !== "administrator" ||
			id !== this.config.ownerId
		) {
			await this.audit(null, "login", "denied");
			return null;
		}
		const owner = await this.currentOwner(id);
		if (!owner || owner.version !== Number(user?.auth_version)) {
			await this.audit(null, "login", "denied");
			return null;
		}
		const token = randomBytes(32).toString("base64url");
		const expires = new Date(Date.now() + 8 * 60 * 60 * 1000);
		await this.pool.query(
			"INSERT INTO dc_admin.sessions (token_digest,user_id,auth_version,expires_at) VALUES ($1,$2,$3,$4)",
			[digest(token), id, owner.version, expires],
		);
		for (const [key, bridge] of this.bridges)
			if (bridge.expires <= Date.now()) this.bridges.delete(key);
		if (
			typeof user?.token === "string" &&
			user.token.length <= 8192 &&
			this.bridges.size < 1000
		)
			this.bridges.set(digest(token).toString("hex"), {
				bearer: user.token,
				owner,
				expires: expires.getTime(),
			});
		await this.audit(id, "login", "success");
		return { token, owner, expires };
	}
	async verify(token: string): Promise<Owner | null> {
		if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
		const session = await this.pool.query(
			"SELECT user_id,auth_version FROM dc_admin.sessions WHERE token_digest=$1 AND revoked_at IS NULL AND expires_at > now()",
			[digest(token)],
		);
		const row = session.rows[0];
		if (!row) {
			this.bridges.delete(digest(token).toString("hex"));
			return null;
		}
		const owner = await this.currentOwner(Number(row.user_id));
		if (!owner || owner.version !== Number(row.auth_version)) {
			await this.revoke(token);
			return null;
		}
		return owner;
	}
	async revoke(token: string) {
		if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return;
		this.bridges.delete(digest(token).toString("hex"));
		await this.pool.query(
			"UPDATE dc_admin.sessions SET revoked_at=now() WHERE token_digest=$1",
			[digest(token)],
		);
	}
	async walineBearer(token: string, owner: Owner) {
		const bridge = this.bridges.get(digest(token).toString("hex"));
		if (
			!bridge ||
			bridge.expires <= Date.now() ||
			bridge.owner.id !== owner.id ||
			bridge.owner.version !== owner.version
		)
			return null;
		return bridge.bearer;
	}
	async sessions(token: string, owner: Owner) {
		const result = await this.pool.query(
			"SELECT public_id,created_at,expires_at,token_digest FROM dc_admin.sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC",
			[owner.id],
		);
		return result.rows.map((row) => ({
			id: row.public_id,
			created: row.created_at,
			expires: row.expires_at,
			current: Buffer.from(row.token_digest as Uint8Array).equals(
				digest(token),
			),
		}));
	}
	async revokeSession(id: string, token: string, owner: Owner) {
		const result = await this.pool.query(
			"UPDATE dc_admin.sessions SET revoked_at=now() WHERE public_id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING token_digest",
			[id, owner.id],
		);
		const key = result.rows[0]?.token_digest;
		if (!key) return null;
		this.bridges.delete(Buffer.from(key as Uint8Array).toString("hex"));
		return Buffer.from(key as Uint8Array).equals(digest(token));
	}
	async managementAudit(
		id: number,
		action: string,
		result: string,
		object: string,
		requestId: string,
	) {
		await this.pool.query(
			"INSERT INTO dc_admin.audit(actor_id,action,result,object_id,request_id) VALUES ($1,$2,$3,$4,$5)",
			[id, action, result, object, requestId],
		);
	}
	async audit(id: number | null, action: string, result: string) {
		await this.pool.query(
			"INSERT INTO dc_admin.audit (actor_id,action,result) VALUES ($1,$2,$3)",
			[id, action, result],
		);
	}
	async cleanup() {
		for (const [key, bridge] of this.bridges)
			if (bridge.expires <= Date.now()) this.bridges.delete(key);
		await this.pool.query(
			"DELETE FROM dc_admin.sessions WHERE expires_at < now() - interval '1 day'",
		);
	}
}
