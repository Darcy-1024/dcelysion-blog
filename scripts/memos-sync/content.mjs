import { createHash } from "node:crypto";
import { Marked } from "marked";
import sharp from "sharp";

export const digest = (value) =>
	createHash("sha256").update(value).digest("hex");
const canonical = (value) =>
	Array.isArray(value)
		? value.map(canonical)
		: value && typeof value === "object"
			? Object.fromEntries(
					Object.entries(value)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([key, item]) => [key, canonical(item)]),
				)
			: value;
export const fingerprint = (value) => digest(JSON.stringify(canonical(value)));
// Ignore computed snippets/reactions which can differ between List and Get.
export const semanticMemo = (memo) =>
	memo === null
		? null
		: {
				name: memo.name,
				creator: memo.creator,
				state: memo.state,
				visibility: memo.visibility,
				content: memo.content,
				createTime: memo.createTime,
				updateTime: memo.updateTime,
				parent: memo.parent ?? "",
				pinned: memo.pinned ?? false,
				location: memo.location ?? null,
				attachments: (memo.attachments ?? []).map((a) => ({
					name: a.name,
					filename: a.filename ?? "",
					type: a.type,
					size: String(a.size),
					externalLink: a.externalLink ?? "",
					memo: a.memo,
				})),
				relations: (memo.relations ?? [])
					.filter((r) => r.type === "COMMENT")
					.map((r) => ({
						type: r.type,
						memo: r.memo?.name,
						relatedMemo: r.relatedMemo?.name,
					})),
			};
export const publicMemo = (memo, creator) =>
	memo?.creator === creator &&
	memo.state === "NORMAL" &&
	memo.visibility === "PUBLIC" &&
	!memo.parent &&
	!(memo.relations ?? []).some(
		(r) => r.type === "COMMENT" && r.memo?.name === memo.name,
	);
const imagePattern = /!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/gu;
const parser = new Marked();

export function validateMemo(memo) {
	if (
		!/^memos\/[a-zA-Z0-9_-]+$/u.test(memo?.name) ||
		!/^users\/[a-zA-Z0-9_-]+$/u.test(memo.creator) ||
		!["NORMAL", "ARCHIVED"].includes(memo.state) ||
		!["PUBLIC", "PRIVATE", "PROTECTED", "SPACE"].includes(memo.visibility) ||
		typeof memo.content !== "string" ||
		!Number.isFinite(Date.parse(memo.createTime)) ||
		!Number.isFinite(Date.parse(memo.updateTime)) ||
		!Array.isArray(memo.attachments ?? [])
	)
		throw new Error("Invalid memo contract");
}

function attachmentUid(value) {
	const match = /^attachments\/([a-zA-Z0-9_-]+)$/u.exec(value ?? "");
	if (!match) throw new Error("Invalid attachment identity");
	return match[1];
}

export async function convertMemo(
	memo,
	client,
	{
		maxAttachmentBytes = 20 * 1024 * 1024,
		maxTotalAttachmentBytes = 128 * 1024 * 1024,
	} = {},
) {
	const attachments = memo.attachments ?? [];
	const byUid = new Map();
	for (const attachment of attachments) {
		const uid = attachmentUid(attachment.name);
		if (
			byUid.has(uid) ||
			attachment.externalLink ||
			attachment.memo !== memo.name ||
			!/^image\/(jpeg|png|avif|webp|gif)$/u.test(attachment.type) ||
			!/^\d+$/u.test(String(attachment.size)) ||
			BigInt(attachment.size) > BigInt(maxAttachmentBytes)
		)
			throw new Error("Unsupported or unsafe attachment");
		byUid.set(uid, attachment);
	}
	const tokens = parser.lexer(memo.content);
	let parsedImages = 0;
	parser.walkTokens(tokens, (token) => {
		if (token.type === "html")
			throw new Error("Raw HTML is not supported; original left unchanged");
		if (["link", "image"].includes(token.type)) {
			if (token.type === "link") {
				if (
					!/^(https?:|mailto:|#)/iu.test(token.href) ||
					token.href.startsWith(client.base.origin) ||
					/\/file\/attachments\//iu.test(token.href)
				)
					throw new Error("Unsafe/internal link");
			} else {
				parsedImages++;
				if (!new RegExp(`^${imagePattern.source}$`, "u").test(token.raw))
					throw new Error("Only inline attachment images are supported");
			}
		}
	});
	const matches = [...memo.content.matchAll(imagePattern)];
	// Avoid transforming code fences, reference images, or syntax the current frontend misreads.
	if (matches.length !== parsedImages)
		throw new Error("Ambiguous image syntax");
	const used = new Set();
	const imported = new Map();
	const files = new Map();
	const originals = new Map();
	async function importImage(uid) {
		if (imported.has(uid)) return imported.get(uid);
		const attachment = byUid.get(uid);
		if (!attachment) throw new Error("Image is not an owned attachment");
		const original = await client.bytes(
			`/file/attachments/${uid}`,
			maxAttachmentBytes,
		);
		client.attachmentBytes = (client.attachmentBytes ?? 0) + original.length;
		if (client.attachmentBytes > maxTotalAttachmentBytes)
			throw new Error("Run attachment byte limit exceeded");
		if (BigInt(original.length) !== BigInt(attachment.size))
			throw new Error("Attachment length mismatch");
		const image = sharp(original, {
			animated: true,
			limitInputPixels: 40_000_000,
			failOn: "warning",
		});
		const metadata = await image.metadata();
		const formats = {
			jpeg: "image/jpeg",
			png: "image/png",
			avif: "image/avif",
			heif: "image/avif",
			webp: "image/webp",
			gif: "image/gif",
		};
		if (
			formats[metadata.format] !== attachment.type ||
			!metadata.width ||
			!metadata.height ||
			metadata.width * metadata.height > 40_000_000 ||
			(metadata.pages ?? 1) > 100
		)
			throw new Error("Unsupported image data");
		// Force decoding every frame before accepting an animation; never flatten it.
		await image.clone().raw().toBuffer();
		const animated = (metadata.pages ?? 1) > 1;
		if (animated && !["gif", "webp"].includes(metadata.format))
			throw new Error("Unsupported animation");
		const exported = animated
			? original
			: await sharp(original, {
					limitInputPixels: 40_000_000,
					failOn: "warning",
				})
					.rotate()
					.avif({ quality: 80, effort: 6 })
					.toBuffer();
		const outputMeta = await sharp(exported, { animated: true }).metadata();
		if (metadata.hasAlpha && !outputMeta.hasAlpha)
			throw new Error("Image transparency lost");
		const path = `images/memos-image-${digest(exported)}.${animated ? metadata.format : "avif"}`;
		files.set(path, exported);
		originals.set(digest(original), original);
		imported.set(uid, {
			path,
			originalSha256: digest(original),
			sha256: digest(exported),
		});
		return imported.get(uid);
	}
	let body = "";
	let offset = 0;
	for (const match of matches) {
		const url = new URL(match[2], client.base);
		const resource =
			/^\/file\/attachments\/([a-zA-Z0-9_-]+)(?:\/[^/]*)?$/u.exec(url.pathname);
		if (
			url.origin !== client.base.origin ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			!resource
		)
			throw new Error("Only same-instance attachment images are supported");
		const uid = resource[1];
		used.add(uid);
		const item = await importImage(uid);
		body +=
			memo.content.slice(offset, match.index) +
			match[0].replace(match[2], `./${item.path}`);
		offset = match.index + match[0].length;
	}
	body += memo.content.slice(offset);
	for (const uid of byUid.keys()) {
		if (used.has(uid)) continue;
		const item = await importImage(uid);
		body += `\n\n![图片](./${item.path})`;
	}
	if (/\/file\/attachments\//iu.test(body) || body.includes(client.base.origin))
		throw new Error("Unresolved private instance reference");
	return { body, files, originals, attachments: Object.fromEntries(imported) };
}

export function publicationTime(date, timezone) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-GB", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		})
			.formatToParts(date)
			.map((p) => [p.type, p.value]),
	);
	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
