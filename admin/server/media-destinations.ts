import { isAbsolute, resolve } from "node:path";
import {
	type MediaDestination,
	type MediaPurpose,
	mediaPurposes,
} from "../shared/media.js";
import { pathName } from "./executor.js";

export function mediaDestinations(
	value: string | undefined,
	privateBucket: string | undefined,
	prefix: string | undefined,
) {
	const destinations: Partial<Record<MediaPurpose, MediaDestination>> = {};
	if (!value) return destinations;
	const parsed: unknown = JSON.parse(value);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("Media destinations must be a purpose mapping");
	for (const [purpose, input] of Object.entries(parsed)) {
		if (
			!mediaPurposes.includes(purpose as MediaPurpose) ||
			!input ||
			typeof input !== "object" ||
			Array.isArray(input)
		)
			throw new Error("Invalid media purpose configuration");
		const item = input as Record<string, unknown>;
		if (
			Object.keys(item).some(
				(key) =>
					![
						"bucket",
						"publicBase",
						"tencentRoot",
						"tencentBase",
						"prefix",
					].includes(key),
			)
		)
			throw new Error("Unknown media destination setting");
		if (
			typeof item.bucket !== "string" ||
			item.bucket === privateBucket ||
			!/^[a-z0-9][a-z0-9-]{2,62}$/u.test(item.bucket)
		)
			throw new Error("Public destination must use a separate R2 bucket");
		const objectPrefix = item.prefix ?? prefix;
		if (typeof objectPrefix !== "string")
			throw new Error("Media destination prefix required");
		pathName(objectPrefix);
		for (const key of ["publicBase", "tencentBase"]) {
			const url = item[key];
			if (key === "tencentBase" && url === undefined) continue;
			if (typeof url !== "string")
				throw new Error("Media destination URL required");
			const base = new URL(url);
			if (
				base.protocol !== "https:" ||
				base.username ||
				base.password ||
				base.search ||
				base.hash ||
				(key === "publicBase" &&
					base.pathname.replace(/^\/|\/$/gu, "") !== objectPrefix) ||
				(key === "tencentBase" && !base.pathname.startsWith("/media/"))
			)
				throw new Error("Invalid media destination HTTPS base/prefix");
		}
		if (typeof item.tencentRoot !== "string" || !isAbsolute(item.tencentRoot))
			throw new Error("Absolute media destination Tencent root required");
		destinations[purpose as MediaPurpose] = {
			purpose: purpose as MediaPurpose,
			version: 1,
			bucket: item.bucket,
			prefix: objectPrefix,
			publicBase: item.publicBase as string,
			tencentRoot: resolve(item.tencentRoot),
			...(item.tencentBase ? { tencentBase: item.tencentBase as string } : {}),
		};
	}
	return destinations;
}
