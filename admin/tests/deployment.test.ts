import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { readConfig } from "../server/config.js";
import type { DraftService } from "../server/drafts.js";
import { productionMedia } from "../server/media-config.js";
import { productionPublishing } from "../server/publishing-config.js";

test("生产配置拒绝 HTTP、提供方降级及部分 R2 配置", () => {
	assert.throws(
		() =>
			readConfig({
				NODE_ENV: "production",
				ADMIN_ORIGIN: "http://127.0.0.1:4322",
				ADMIN_ALLOW_INSECURE_LOCAL: "1",
			}),
		/生产后台/,
	);
	assert.throws(
		() =>
			readConfig({
				NODE_ENV: "production",
				ADMIN_ORIGIN: "https://admin.example.invalid",
				ADMIN_ALLOW_INSECURE_LOCAL: "1",
			}),
		/生产后台/,
	);
	assert.equal(
		readConfig({
			NODE_ENV: "production",
			ADMIN_ORIGIN: "https://admin.example.invalid",
		}).ready,
		false,
	);
	assert.throws(
		() =>
			productionPublishing("/repository", "", {} as DraftService, {
				ADMIN_EXECUTOR_STATE_ROOT: "/private",
			}),
		/COMMENT_PROVIDER/,
	);
	assert.throws(
		() =>
			productionPublishing("/repository", "", {} as DraftService, {
				ADMIN_EXECUTOR_STATE_ROOT: "/private",
				ADMIN_BUILD_COMMENT_PROVIDER: "waline",
			}),
		/WALINE_SERVER/,
	);
	assert.equal(productionMedia("/repository", "", {}), null);
	assert.throws(
		() =>
			productionMedia("/repository", "", {
				ADMIN_MEDIA_PRIVATE_ROOT: "/private",
			}),
		/roots/,
	);
	assert.throws(
		() =>
			productionMedia("/repository", "", {
				ADMIN_R2_ENDPOINT: "https://r2.example.invalid",
			}),
		/R2/,
	);
});

test("用途腾讯交付遵循确认开关，独立用途源保留容量地址", async () => {
	const env = {
		ADMIN_MEDIA_PRIVATE_ROOT: resolve("/private-media"),
		ADMIN_MEDIA_PUBLIC_ROOT: resolve("/public-media"),
		ADMIN_MEDIA_PUBLIC_BASE: "https://legacy.example.invalid/admin-v1",
		ADMIN_R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
		ADMIN_R2_PRIVATE_BUCKET: "test-private",
		ADMIN_R2_PUBLIC_BUCKET: "test-legacy-public",
		ADMIN_R2_PREFIX: "admin-v1",
		ADMIN_R2_ACCESS_KEY_ID: "test-only",
		ADMIN_R2_SECRET_ACCESS_KEY: "test-only",
		ADMIN_R2_PRIVATE_CONFIRMED: "1",
		ADMIN_MEDIA_CAPACITY_URL: "https://tencent.example.invalid/media/capacity",
		ADMIN_MEDIA_DESTINATIONS: JSON.stringify({
			gallery: {
				bucket: "test-gallery",
				publicBase: "https://gallery.example.invalid/admin-v1",
				tencentRoot: resolve("/public-media/gallery"),
				tencentBase: "https://tencent.example.invalid/media/gallery",
			},
		}),
	};
	assert.throws(
		() =>
			productionMedia(resolve("/repository"), "postgres://test-only", {
				...env,
				ADMIN_MEDIA_TENCENT_VERIFIED_DELIVERY: "0",
			}),
		/ADMIN_MEDIA_TENCENT_VERIFIED_DELIVERY=1/,
	);
	assert.throws(
		() => productionMedia(resolve("/repository"), "postgres://test-only", env),
		/ADMIN_MEDIA_TENCENT_VERIFIED_DELIVERY=1/,
	);
	const media = productionMedia(
		resolve("/repository"),
		"postgres://test-only",
		{ ...env, ADMIN_MEDIA_TENCENT_VERIFIED_DELIVERY: "1" },
	);
	assert.ok(media);
	try {
		assert.equal(media.config.tencentBase, undefined);
		assert.equal(media.config.capacityUrl, env.ADMIN_MEDIA_CAPACITY_URL);
		assert.equal(
			media.config.destinations?.gallery?.tencentBase,
			"https://tencent.example.invalid/media/gallery",
		);
	} finally {
		await media.close();
	}
});
