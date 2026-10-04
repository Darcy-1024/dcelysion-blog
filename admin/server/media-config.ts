import { join, resolve } from "node:path";
import { MediaService } from "./media.js";
import { MediaBudget } from "./media-budget.js";
import { mediaDestinations } from "./media-destinations.js";
import { R2Store } from "./media-storage.js";
export function productionMedia(
	repository: string,
	databaseUrl: string,
	env = process.env,
) {
	const destinations = mediaDestinations(
		env.ADMIN_MEDIA_DESTINATIONS,
		env.ADMIN_R2_PRIVATE_BUCKET,
		env.ADMIN_R2_PREFIX,
	);
	const hasPurposeTencent = Object.values(destinations).some((destination) =>
		Boolean(destination.tencentBase),
	);
	if (hasPurposeTencent && env.ADMIN_MEDIA_TENCENT_VERIFIED_DELIVERY !== "1")
		throw new Error(
			"Purpose Tencent delivery requires ADMIN_MEDIA_TENCENT_VERIFIED_DELIVERY=1",
		);
	const roots = [
		env.ADMIN_MEDIA_PRIVATE_ROOT,
		env.ADMIN_MEDIA_PUBLIC_ROOT,
		env.ADMIN_MEDIA_PUBLIC_BASE,
	];
	const r2 = [
		env.ADMIN_R2_ENDPOINT,
		env.ADMIN_R2_PRIVATE_BUCKET,
		env.ADMIN_R2_PUBLIC_BUCKET,
		env.ADMIN_R2_PREFIX,
		env.ADMIN_R2_ACCESS_KEY_ID,
		env.ADMIN_R2_SECRET_ACCESS_KEY,
	];
	if (roots.some(Boolean) && !roots.every(Boolean))
		throw new Error("Media roots/base must be configured together");
	if (
		r2.some(Boolean) &&
		(!roots.every(Boolean) ||
			!r2.every(Boolean) ||
			env.ADMIN_R2_PRIVATE_CONFIRMED !== "1")
	)
		throw new Error("Partial or unconfirmed R2 configuration is forbidden");
	if (
		!env.ADMIN_MEDIA_PRIVATE_ROOT ||
		!env.ADMIN_MEDIA_PUBLIC_ROOT ||
		!env.ADMIN_MEDIA_PUBLIC_BASE
	)
		return null;
	let store: R2Store | null = null;
	if (
		env.ADMIN_R2_ENDPOINT &&
		env.ADMIN_R2_PRIVATE_BUCKET &&
		env.ADMIN_R2_PUBLIC_BUCKET &&
		env.ADMIN_R2_PREFIX &&
		env.ADMIN_R2_ACCESS_KEY_ID &&
		env.ADMIN_R2_SECRET_ACCESS_KEY &&
		env.ADMIN_R2_PRIVATE_CONFIRMED === "1"
	) {
		const monthly = Number(
			env.ADMIN_MEDIA_SYNC_MONTHLY_BYTES || 80_000_000_000,
		);
		if (
			!Number.isSafeInteger(monthly) ||
			monthly < 1 ||
			monthly > 80_000_000_000
		)
			throw new Error("Sync monthly budget must not exceed 80GB");
		const rate = Number(env.ADMIN_MEDIA_SYNC_BYTES_PER_SECOND || 65536);
		if (!Number.isSafeInteger(rate) || rate < 16384 || rate > 65536)
			throw new Error("Media rate must be 16–64 KiB/s");
		const base = new URL(env.ADMIN_MEDIA_PUBLIC_BASE);
		if (base.pathname.replace(/^\/|\/$/gu, "") !== env.ADMIN_R2_PREFIX)
			throw new Error(
				"Public media base must end with the configured R2 prefix",
			);
		store = new R2Store({
			endpoint: env.ADMIN_R2_ENDPOINT,
			privateBucket: env.ADMIN_R2_PRIVATE_BUCKET,
			publicBucket: env.ADMIN_R2_PUBLIC_BUCKET,
			prefix: env.ADMIN_R2_PREFIX,
			accessKeyId: env.ADMIN_R2_ACCESS_KEY_ID,
			secretAccessKey: env.ADMIN_R2_SECRET_ACCESS_KEY,
			bytesPerSecond: rate,
			budget: new MediaBudget(
				join(resolve(env.ADMIN_MEDIA_PRIVATE_ROOT), "sync-budget.jsonl"),
				monthly,
			),
			publicBase: env.ADMIN_MEDIA_PUBLIC_BASE,
			destinations: Object.values(destinations),
		});
	}
	const tencentBase =
		env.ADMIN_MEDIA_TENCENT_VERIFIED_DELIVERY === "1"
			? env.ADMIN_MEDIA_TENCENT_BASE
			: undefined;
	const capacityUrl =
		tencentBase || hasPurposeTencent ? env.ADMIN_MEDIA_CAPACITY_URL : undefined;
	for (const value of [tencentBase, capacityUrl])
		if (value) {
			const parsed = new URL(value);
			if (
				parsed.protocol !== "https:" ||
				parsed.username ||
				parsed.password ||
				parsed.search ||
				parsed.hash ||
				!parsed.pathname.startsWith("/media/")
			)
				throw new Error(
					"Public Tencent media endpoints require HTTPS /media/ paths",
				);
		}
	return new MediaService(
		{
			repository,
			privateRoot: resolve(env.ADMIN_MEDIA_PRIVATE_ROOT),
			publicRoot: resolve(env.ADMIN_MEDIA_PUBLIC_ROOT),
			publicBase: env.ADMIN_MEDIA_PUBLIC_BASE,
			tencentBase,
			capacityUrl,
			probeId: env.ADMIN_MEDIA_PROBE_ID,
			destinations,
		},
		store,
		databaseUrl,
	);
}
