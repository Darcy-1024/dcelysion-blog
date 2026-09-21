import { getImage } from "astro:assets";
import { getCollection } from "astro:content";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import type { ImageMetadata } from "astro";
import type { DynamicImage, DynamicImagePreview } from "@/types/dynamic";
import {
	dynamicSearchText,
	dynamicSlug,
	sortDynamics,
} from "@/utils/dynamic-utils";

const markdownImagePattern = /!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g;

const dynamicImageFiles = import.meta.glob<ImageMetadata>(
	"/src/content/dynamic/images/**/*.{png,jpg,jpeg,webp,avif,gif,svg}",
	{
		eager: true,
		import: "default",
	},
);

const resolveDynamicImage = (
	src: string,
): { src: string; metadata?: ImageMetadata } => {
	if (!src.startsWith("./images/")) return { src };
	const sourcePath = `/src/content/dynamic/${src.slice(2)}`;
	const metadata = dynamicImageFiles[sourcePath];
	return { src: metadata?.src || src, metadata };
};

const previewCache = new Map<
	string,
	Promise<DynamicImagePreview | undefined>
>();

const createDynamicImagePreview = (
	metadata: ImageMetadata,
): Promise<DynamicImagePreview | undefined> => {
	const cached = previewCache.get(metadata.src);
	if (cached) return cached;

	const preview = (async () => {
		if (metadata.format === "svg") return undefined;
		try {
			const result = await getImage({
				src: metadata,
				width: Math.min(960, metadata.width),
				widths: [320, 640, 960],
				format: "webp",
				quality: 80,
			});
			return {
				src: result.src,
				...(result.srcSet.attribute ? { srcSet: result.srcSet.attribute } : {}),
				width: metadata.width,
				height: metadata.height,
			};
		} catch (error) {
			console.warn(
				`[dynamic] Failed to generate preview for ${metadata.src}; using original image.`,
				error,
			);
			return undefined;
		}
	})();
	previewCache.set(metadata.src, preview);
	return preview;
};

export async function GET(): Promise<Response> {
	const processor = await createMarkdownProcessor();
	const dynamics = sortDynamics(
		(await getCollection("dynamic")).filter((d) =>
			import.meta.env.PROD ? !d.data.draft : true,
		),
	);
	const data = await Promise.all(
		dynamics.map(async (entry) => {
			const extractedImages: Array<{
				image: DynamicImage;
				metadata?: ImageMetadata;
			}> = [];
			const markdown = (entry.body || "").replace(
				markdownImagePattern,
				(_match, alt: string, src: string, title?: string) => {
					const resolved = resolveDynamicImage(src);
					extractedImages.push({
						image: {
							alt,
							src: resolved.src,
							...(title ? { title } : {}),
						},
						metadata: resolved.metadata,
					});
					return "";
				},
			);
			const images = await Promise.all(
				extractedImages.map(async ({ image, metadata }) => {
					if (!metadata) return image;
					const preview = await createDynamicImagePreview(metadata);
					return preview ? { ...image, preview } : image;
				}),
			);
			const rendered = await processor.render(markdown);

			return {
				id: dynamicSlug(entry.id),
				published: entry.data.published.getTime(),
				html: rendered.code,
				images,
				searchText: dynamicSearchText(entry),
				pinned: entry.data.pinned || false,
				location: entry.data.location.trim(),
			};
		}),
	);

	return new Response(JSON.stringify(data), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
		},
	});
}
