import { readFile } from "node:fs/promises";
import {
	type ConfigurationKind,
	configurationPaths,
	configurationReferences,
	parseConfiguration,
	serializeConfiguration,
} from "../shared/configuration.js";
import type { Draft } from "../shared/contracts.js";
import { type MediaPlan, mediaPositions } from "../shared/media.js";
import { DraftError, hash } from "./drafts.js";
import { safeFile } from "./executor.js";
import type { MediaService } from "./media.js";

export const configurationDependencies = {
	music: ["src/config/musicConfig.ts", "src/config/manifest-adapters.ts"],
	gallery: [
		"src/config/galleryConfig.ts",
		"src/config/manifest-adapters.ts",
		"src/utils/gallery-utils.ts",
		"src/types/galleryConfig.ts",
		"src/constants/gallery-previews.json",
	],
	settings: [
		"src/config/siteConfig.ts",
		"src/utils/media-contract.ts",
		"src/utils/media-client.ts",
		"src/config/displaySettingsConfig.ts",
	],
} as const;
export async function dependencyState(root: string, kind: ConfigurationKind) {
	const values: Record<string, string> = {};
	for (const name of configurationDependencies[kind]) {
		try {
			values[name] = hash(await readFile(await safeFile(root, name), "utf8"));
		} catch {
			throw new DraftError(409, "CONFIG_ADAPTER_MISSING");
		}
	}
	return values;
}
export function normalizeConfiguration(
	kind: ConfigurationKind,
	source: string,
	baseline?: string,
) {
	try {
		return serializeConfiguration(parseConfiguration(kind, source, baseline));
	} catch (cause) {
		throw new DraftError(422, "CONFIG_INVALID", {
			message: (cause as Error).message,
		});
	}
}
export async function configurationMedia(
	owner: number,
	draft: Pick<Draft, "kind" | "source" | "baseSource">,
	media: MediaService | null,
	preview = false,
	previous?: string,
): Promise<MediaPlan | undefined> {
	const kind = draft.kind as ConfigurationKind;
	const data = parseConfiguration(
		kind,
		draft.source,
		draft.baseSource || undefined,
	);
	const refs = configurationReferences(kind, data);
	const old = configurationReferences(
		kind,
		parseConfiguration(kind, previous || draft.baseSource || draft.source),
	).map((ref) => ref.value);
	const synthetic = refs.map((ref) => `<img src="${ref.value}">`).join("\n");
	if (!media) {
		if (draft.source.includes("/__managed-media/"))
			throw new DraftError(503, "MEDIA_NOT_CONFIGURED");
		return undefined;
	}
	await media.validateSource(owner, synthetic);
	const plan = await media.plan(owner, synthetic, preview);
	const resolved = mediaPositions(plan.source);
	for (let i = 0; i < refs.length; i++) {
		const ref = refs[i];
		const replacement = resolved[i]?.url;
		if (!replacement) throw new DraftError(422, "MEDIA_REFERENCE");
		const dep = plan.dependencies.find(
			(d) =>
				replacement === d.url ||
				replacement === `/__admin_media/${d.object.key}`,
		);
		if (dep) {
			const record = await media.get(owner, dep.id);
			if (
				record.kind !== ref.role ||
				(record.purpose !== undefined &&
					((kind === "gallery" && record.purpose !== "gallery") ||
						(kind === "music" && record.purpose !== "music"))) ||
				(record.deleted && !old.includes(ref.value))
			)
				throw new DraftError(422, "MEDIA_ROLE");
			if (ref.role === "image" && ref.field === "original") {
				if (dep.variant !== "original") throw new DraftError(422, "MEDIA_ROLE");
				// Populate trusted properties from the same immutable original, never client hashes.
				ref.record.sha256 = record.original.sha256;
				ref.record.objectKey = record.original.key;
				ref.record.width = record.width;
				ref.record.height = record.height;
				const associated = String(ref.record.preview || "");
				if (
					associated &&
					associated !== `/__managed-media/${dep.id}/preview` &&
					associated !==
						plan.dependencies.find(
							(d) => d.id === dep.id && d.variant === "preview",
						)?.url
				)
					throw new DraftError(422, "MEDIA_ROLE");
			}
		}
		ref.record[ref.field] = replacement;
	}
	const source = serializeConfiguration(data);
	if (source.includes("/__managed-media/"))
		throw new DraftError(422, "MEDIA_REFERENCE");
	return { ...plan, source };
}
export function configurationPath(kind: ConfigurationKind, path: string) {
	if (path !== `${kind}.json`) throw new DraftError(400, "PATH");
	return configurationPaths[kind];
}
