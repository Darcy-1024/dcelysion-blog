/**
 * 请求去重与会话内短期缓存工具
 * 避免同页面多个组件或 Swup 跨页导航时重复请求同一静态接口
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 32;

const pendingFetches = new Map<string, Promise<unknown>>();
const resolvedCache = new Map<string, { expiresAt: number; value: unknown }>();

export function fetchWithDedup<T>(url: string): Promise<T> {
	const cached = resolvedCache.get(url);
	if (cached) {
		if (Date.now() < cached.expiresAt) {
			return Promise.resolve(cached.value as T);
		}
		resolvedCache.delete(url);
	}

	const pending = pendingFetches.get(url);
	if (pending) return pending as Promise<T>;

	const promise = fetch(url)
		.then(async (r) => {
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const data = (await r.json()) as T;
			if (resolvedCache.size >= MAX_CACHE_ENTRIES) {
				const oldestKey = resolvedCache.keys().next().value;
				if (oldestKey !== undefined) resolvedCache.delete(oldestKey);
			}
			resolvedCache.set(url, {
				expiresAt: Date.now() + CACHE_TTL_MS,
				value: data,
			});
			return data;
		})
		.finally(() => pendingFetches.delete(url));
	pendingFetches.set(url, promise);
	return promise;
}
