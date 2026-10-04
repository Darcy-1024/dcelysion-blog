import distribution from "../config/manifests/media-distribution.json";
import settings from "../config/manifests/settings.json";
import {
	dualReady,
	type MediaDistribution,
	parseMediaPolicy,
} from "./media-contract";

export function mediaImageProps(
	src: string,
	lazy = true,
	srcset?: string,
): {
	src?: string;
	srcset?: string;
	"data-media-src"?: string;
	"data-media-srcset"?: string;
} {
	const manifest = distribution as MediaDistribution;
	const policy = parseMediaPolicy(
		(settings as Record<string, unknown>).mediaRouting,
	);
	const ready = (url: string) =>
		manifest.entries.some(
			(entry) => dualReady(entry) && Object.values(entry.sources).includes(url),
		);
	if (
		!lazy ||
		!policy.enabled ||
		!ready(src) ||
		(srcset &&
			!srcset
				.split(",")
				.every((candidate) => ready(candidate.trim().split(/\s+/)[0])))
	)
		return { src, ...(srcset ? { srcset } : {}) };
	return { "data-media-src": src, "data-media-srcset": srcset };
}
