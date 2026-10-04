import { open, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseFile } from "music-metadata";
import sharp from "sharp";
import type { Media } from "../shared/media.js";
import { DraftError } from "./drafts.js";

export const mediaLimits = {
	image: 20 * 1024 * 1024,
	audio: 64 * 1024 * 1024,
	video: 128 * 1024 * 1024,
	text: 256 * 1024,
	pixels: 24_000_000,
};
sharp.cache({ memory: 32, files: 8, items: 16 });
sharp.concurrency(1);
export async function inspectUpload(
	file: string,
	name: string,
	size: number,
	previewPath: string,
) {
	const handle = await open(file, "r");
	const head = Buffer.alloc(64);
	await handle.read(head, 0, head.length, 0);
	await handle.close();
	let kind: Media["kind"];
	let ext: string;
	let mime: string;
	if (head.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
		kind = "image";
		ext = "jpg";
		mime = "image/jpeg";
	} else if (
		head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	) {
		kind = "image";
		ext = "png";
		mime = "image/png";
	} else if (
		head.toString("ascii", 0, 4) === "RIFF" &&
		head.toString("ascii", 8, 12) === "WEBP"
	) {
		kind = "image";
		ext = "webp";
		mime = "image/webp";
	} else if (/^GIF8[79]a/.test(head.toString("ascii"))) {
		kind = "image";
		ext = "gif";
		mime = "image/gif";
	} else if (
		head.toString("ascii", 4, 8) === "ftyp" &&
		/avif|avis/.test(head.toString("ascii", 8, 40))
	) {
		kind = "image";
		ext = "avif";
		mime = "image/avif";
	} else if (head.toString("ascii", 0, 4) === "fLaC") {
		kind = "audio";
		ext = "flac";
		mime = "audio/flac";
	} else if (
		head.toString("ascii", 0, 4) === "RIFF" &&
		head.toString("ascii", 8, 12) === "WAVE"
	) {
		kind = "audio";
		ext = "wav";
		mime = "audio/wav";
	} else if (
		head.toString("ascii", 0, 3) === "ID3" ||
		(head[0] === 255 && (head[1] & 0xe0) === 0xe0 && (head[1] & 6) !== 0)
	) {
		kind = "audio";
		ext = "mp3";
		mime = "audio/mpeg";
	} else if (
		head.toString("ascii", 4, 8) === "ftyp" &&
		/isom|iso2|mp4[12]|avc1/.test(head.toString("ascii", 8, 40))
	) {
		kind = "video";
		ext = "mp4";
		mime = "video/mp4";
	} else if (/\.(?:txt|lrc)$/iu.test(name) && size <= mediaLimits.text) {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(
			await readFile(file),
		);
		if (
			[...text].some(
				(c) => c.charCodeAt(0) < 32 && !["\t", "\r", "\n"].includes(c),
			) ||
			/<\s*[!?/a-z]/iu.test(text)
		)
			throw new DraftError(422, "MEDIA_TYPE");
		kind = "text";
		ext = extname(name).slice(1).toLowerCase();
		mime = "text/plain; charset=utf-8";
	} else throw new DraftError(422, "MEDIA_TYPE");
	if (size > mediaLimits[kind]) throw new DraftError(422, "MEDIA_SIZE");
	// Extension is never used to choose binary type; misleading names are rejected.
	const suffix = extname(name).slice(1).toLowerCase();
	if (suffix !== ext && !(ext === "jpg" && suffix === "jpeg"))
		throw new DraftError(422, "MEDIA_TYPE");
	if (kind === "image") {
		const image = sharp(file, {
			limitInputPixels: mediaLimits.pixels,
			failOn: "warning",
			sequentialRead: true,
		});
		const metadata = await image.metadata();
		if (
			!metadata.width ||
			!metadata.height ||
			metadata.width * metadata.height > mediaLimits.pixels ||
			(metadata.pages || 1) > 1
		)
			throw new DraftError(422, "MEDIA_PIXELS");
		await image
			.rotate()
			.resize({
				width: 1200,
				height: 1200,
				fit: "inside",
				withoutEnlargement: true,
			})
			.webp({ quality: 78 })
			.timeout({ seconds: 15 })
			.toFile(previewPath);
		return {
			kind,
			ext,
			mime,
			width: metadata.width,
			height: metadata.height,
			previewPath,
		};
	}
	if (kind === "audio") {
		const metadata = await parseFile(file, {
			skipCovers: true,
			duration: false,
		});
		if (
			!metadata.format.codec ||
			!metadata.format.sampleRate ||
			!metadata.format.numberOfChannels ||
			metadata.format.numberOfChannels > 8
		)
			throw new DraftError(422, "MEDIA_TYPE");
	}
	if (kind === "video") await inspectMp4(file, size);
	return { kind, ext, mime };
}
// Bounded structural MP4 validation; this does not transcode or promise codec/browser compatibility.
async function inspectMp4(file: string, size: number) {
	const handle = await open(file, "r");
	let position = 0;
	let moov = false;
	let data = false;
	let boxes = 0;
	try {
		while (position < size) {
			if (++boxes > 10000) throw new DraftError(422, "MEDIA_TYPE");
			const header = Buffer.alloc(16);
			if ((await handle.read(header, 0, 16, position)).bytesRead < 8)
				throw new DraftError(422, "MEDIA_TYPE");
			let length = header.readUInt32BE(0);
			let start = 8;
			if (length === 1) {
				const n = header.readBigUInt64BE(8);
				if (n > BigInt(size)) throw new DraftError(422, "MEDIA_TYPE");
				length = Number(n);
				start = 16;
			}
			if (length === 0) length = size - position;
			if (length < start || position + length > size)
				throw new DraftError(422, "MEDIA_TYPE");
			const type = header.toString("ascii", 4, 8);
			if (type === "mdat" && length > start) data = true;
			if (type === "moov") {
				if (length > 4 * 1024 * 1024) throw new DraftError(422, "MEDIA_TYPE");
				const contents = Buffer.alloc(length - start);
				await handle.read(contents, 0, contents.length, position + start);
				let video = false;
				let count = 0;
				function visit(bytes: Buffer, depth: number) {
					if (depth > 6) throw new DraftError(422, "MEDIA_TYPE");
					for (let offset = 0; offset < bytes.length; ) {
						if (offset + 8 > bytes.length || ++count > 10000)
							throw new DraftError(422, "MEDIA_TYPE");
						const n = bytes.readUInt32BE(offset);
						const t = bytes.toString("ascii", offset + 4, offset + 8);
						if (n < 8 || offset + n > bytes.length)
							throw new DraftError(422, "MEDIA_TYPE");
						if (
							t === "hdlr" &&
							n >= 20 &&
							bytes.toString("ascii", offset + 16, offset + 20) === "vide"
						)
							video = true;
						if (["trak", "mdia", "minf", "stbl"].includes(t))
							visit(bytes.subarray(offset + 8, offset + n), depth + 1);
						offset += n;
					}
				}
				visit(contents, 0);
				moov = video;
			}
			position += length;
		}
		if (!moov || !data) throw new DraftError(422, "MEDIA_TYPE");
	} finally {
		await handle.close();
	}
}
