import { isAbsolute, relative } from "node:path";
import { Readable } from "node:stream";
import type {
	MediaDistribution,
	PublicMedia,
} from "../../src/utils/media-contract.js";
import type { Media, MediaVariant } from "../shared/media.js";
import { DraftError } from "./drafts.js";
import { digest } from "./media-storage.js";

export const distributionPath = "src/config/manifests/media-distribution.json";
export function publicDistribution(
	records: Media[],
	snapshot: string,
	r2Base: string,
	tencentBase?: string,
	capacityUrl?: string,
	probeId?: string,
	requireTencent = true,
	edgeRoot?: string,
): MediaDistribution {
	const entries: PublicMedia[] = [];
	for (const media of records) {
		// New records carry their immutable destination; old records retain legacy URLs.
		const r2 = media.destination?.publicBase || r2Base;
		const tencent = media.destination
			? media.destination.tencentBase
			: tencentBase;
		const localDirectory =
			edgeRoot && media.destination
				? relative(edgeRoot, media.destination.tencentRoot).replaceAll(
						"\\",
						"/",
					)
				: "";
		if (
			edgeRoot &&
			(localDirectory === ".." ||
				localDirectory.startsWith("../") ||
				isAbsolute(localDirectory))
		)
			throw new DraftError(422, "MEDIA_DESTINATION");
		for (const variant of ["original", "preview"] as const) {
			const object = media[variant];
			if (
				!object ||
				!media.publicKeys?.includes(object.key) ||
				(requireTencent && !media.tencentKeys?.includes(object.key)) ||
				!tencent ||
				!/^[a-f0-9]{64}$/.test(object.sha256)
			)
				continue;
			const receipt = media.deliveryReceipts?.[object.key];
			if (
				requireTencent &&
				(!receipt ||
					receipt.sha256 !== object.sha256 ||
					receipt.size !== object.size ||
					receipt.mime !== object.mime)
			)
				continue;
			entries.push({
				...(edgeRoot
					? {
							localKey: localDirectory
								? `${localDirectory}/${object.key}`
								: object.key,
						}
					: {}),
				id: media.id,
				variant,
				key: object.key,
				sha256: object.sha256,
				size: object.size,
				mime: object.mime,
				defaultUrl: `${r2.replace(/\/$/, "")}/${object.key}`,
				sources: {
					r2: `${r2.replace(/\/$/, "")}/${object.key}`,
					tencent: `${tencent.replace(/\/$/, "")}/${object.key}`,
				},
			});
		}
	}
	entries.sort((a, b) =>
		`${a.id}/${a.variant}`.localeCompare(`${b.id}/${b.variant}`),
	);
	return {
		version: 1,
		snapshot,
		entries,
		...(capacityUrl ? { capacityUrl } : {}),
		...(probeId &&
		entries.some((e) => e.id === probeId && e.variant === "original")
			? { probe: { id: probeId, variant: "original" } }
			: {}),
	};
}
export async function verifyTencentDelivery(
	base: string,
	object: MediaVariant,
) {
	const url = `${base.replace(/\/$/, "")}/${object.key}`;
	const signal = AbortSignal.timeout(
		30000 + Math.ceil(object.size / 65536) * 1500,
	);
	const response = await fetch(url, {
		signal,
		redirect: "error",
		headers: { "accept-encoding": "identity" },
	});
	try {
		if (
			response.status !== 200 ||
			!response.body ||
			Number(response.headers.get("content-length")) !== object.size ||
			response.headers.get("content-type") !== object.mime ||
			!response.headers.get("cache-control")?.includes("immutable") ||
			response.headers.get("access-control-allow-origin") !== "*" ||
			response.headers.get("timing-allow-origin") !== "*"
		)
			throw new DraftError(422, "MEDIA_DISTRIBUTION");
		const actual = await digest(
			Readable.fromWeb(
				response.body as import("node:stream/web").ReadableStream,
			),
			object.size,
		);
		if (actual.sha256 !== object.sha256 || actual.size !== object.size)
			throw new DraftError(422, "MEDIA_INTEGRITY");
	} finally {
		await response.body?.cancel().catch(() => {});
	}
	const head = await fetch(url, { signal, redirect: "error", method: "HEAD" });
	if (
		head.status !== 200 ||
		Number(head.headers.get("content-length")) !== object.size ||
		head.headers.get("content-type") !== object.mime
	)
		throw new DraftError(422, "MEDIA_DISTRIBUTION");
	if (object.mime.startsWith("audio/") || object.mime.startsWith("video/")) {
		const range = await fetch(url, {
			signal,
			redirect: "error",
			headers: { Range: "bytes=0-0" },
		});
		try {
			if (
				range.status !== 206 ||
				range.headers.get("content-range") !== `bytes 0-0/${object.size}` ||
				(await range.arrayBuffer()).byteLength !== 1
			)
				throw new DraftError(422, "MEDIA_DISTRIBUTION");
		} finally {
			await range.body?.cancel().catch(() => {});
		}
	}
}
