// Memos v0.31.0 lowerCamelCase REST contract. Never writes to the source.
export class ApiError extends Error {
	constructor(status) {
		super(`Memos HTTP ${status}`);
		this.status = status;
	}
}

export class MemosClient {
	constructor({
		baseUrl,
		token,
		timeoutMs = 15000,
		maxPages = 100,
		maxItems = 10000,
		fetchImpl = fetch,
	}) {
		this.base = new URL(baseUrl);
		if (
			this.base.pathname !== "/" ||
			this.base.search ||
			this.base.hash ||
			this.base.username ||
			this.base.password
		)
			throw new Error("baseUrl must be an origin");
		if (
			this.base.protocol !== "https:" &&
			!(
				this.base.protocol === "http:" &&
				["127.0.0.1", "[::1]", "localhost"].includes(this.base.hostname)
			)
		)
			throw new Error("HTTPS or loopback required");
		if (!token || /[\r\n]/u.test(token)) throw new Error("PAT required");
		Object.assign(this, { token, timeoutMs, maxPages, maxItems, fetchImpl });
	}
	async bytes(path, limit = 2 * 1024 * 1024) {
		if (this.deadline && Date.now() >= this.deadline)
			throw new Error("Run deadline exceeded");
		const url = new URL(path, this.base);
		if (url.origin !== this.base.origin)
			throw new Error("Cross-origin request refused");
		// Manual redirects prevent forwarding the PAT, including to another origin.
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const response = await this.fetchImpl(url, {
					headers: { Authorization: `Bearer ${this.token}` },
					redirect: "manual",
					signal: AbortSignal.timeout(
						Math.max(
							1,
							Math.min(
								this.timeoutMs,
								(this.deadline ?? Number.POSITIVE_INFINITY) - Date.now(),
							),
						),
					),
				});
				if (!response.ok) {
					await response.body?.cancel();
					throw new ApiError(response.status);
				}
				if (Number(response.headers.get("content-length")) > limit) {
					await response.body?.cancel();
					throw new Error("Response too large");
				}
				let size = 0;
				const chunks = [];
				for await (const chunk of response.body) {
					size += chunk.length;
					if (size > limit) throw new Error("Response too large");
					chunks.push(chunk);
				}
				return Buffer.concat(chunks);
			} catch (error) {
				if (
					attempt === 2 ||
					(error instanceof ApiError &&
						![429, 500, 502, 503, 504].includes(error.status)) ||
					(!(error instanceof ApiError) &&
						!["TimeoutError", "TypeError"].includes(error.name))
				)
					throw error;
				await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
			}
		}
	}
	async json(path) {
		try {
			return JSON.parse((await this.bytes(path)).toString("utf8"));
		} catch (error) {
			if (error instanceof SyntaxError) throw new Error("Invalid API JSON");
			throw error;
		}
	}
	async pages(path, key, params = {}) {
		const items = [];
		const tokens = new Set();
		let pageToken = "";
		for (let page = 0; page < this.maxPages; page++) {
			const query = new URLSearchParams({
				...params,
				pageSize: "100",
				...(pageToken ? { pageToken } : {}),
			});
			const result = await this.json(`${path}?${query}`);
			// Empty repeated protobuf fields may be omitted; all other shapes fail closed.
			if (
				!result ||
				typeof result !== "object" ||
				Array.isArray(result) ||
				Object.keys(result).some(
					(field) => ![key, "nextPageToken"].includes(field),
				) ||
				(result[key] !== undefined && !Array.isArray(result[key]))
			)
				throw new Error("Invalid list shape");
			items.push(...(result[key] ?? []));
			if (items.length > this.maxItems)
				throw new Error("List item limit: incomplete");
			pageToken = result.nextPageToken ?? "";
			if (typeof pageToken !== "string") throw new Error("Invalid page token");
			if (!pageToken) return items;
			if (tokens.has(pageToken))
				throw new Error("Repeated page token: incomplete");
			tokens.add(pageToken);
		}
		throw new Error("Page limit: incomplete");
	}
	async memo(name) {
		try {
			return await this.json(`/api/v1/${name}`);
		} catch (error) {
			if (error.status === 404) return null;
			throw error;
		}
	}
}
