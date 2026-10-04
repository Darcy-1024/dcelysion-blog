import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { DraftError } from "./drafts.js";
import { safeFile } from "./executor.js";
import type { JobService } from "./jobs.js";

export async function servePreview(
	jobs: JobService,
	owner: number,
	id: string,
	name: string,
	res: ServerResponse,
	origin: string,
	req?: IncomingMessage,
) {
	const job = await jobs.get(owner, id);
	if (
		job.kind !== "preview" ||
		job.status !== "succeeded" ||
		!job.effects.built
	)
		throw new DraftError(409, "PREVIEW_NOT_READY");
	const prefix = `/api/previews/${job.id}/`;
	const asset = await safeFile(
		join(jobs.directory(id), "artifact"),
		name || "index.html",
	);
	let contents: Buffer | undefined;
	const extension = extname(asset);
	// Serving path changes only; the page itself is the actual Astro output.
	if (extension === ".html" || extension === ".css") {
		let text = (await readFile(asset)).toString("utf8");
		if (extension === ".html")
			text = text.replace(
				/\b(href|src|poster|action)\s*=\s*(["'])\/(?!\/)([^"']*)\2/giu,
				(_match, key, quote, path) => `${key}=${quote}${prefix}${path}${quote}`,
			);
		text = text.replace(
			/url\(\s*(["']?)\/(?!\/)([^)'"\s]+)\1\s*\)/giu,
			(_match, quote, path) => `url(${quote}${prefix}${path}${quote})`,
		);
		contents = Buffer.from(text);
	}
	const types: Record<string, string> = {
		".html": "text/html; charset=utf-8",
		".css": "text/css; charset=utf-8",
		".js": "text/javascript",
		".json": "application/json",
		".svg": "image/svg+xml",
		".avif": "image/avif",
		".webp": "image/webp",
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".mp3": "audio/mpeg",
		".wav": "audio/wav",
		".flac": "audio/flac",
		".mp4": "video/mp4",
		".txt": "text/plain; charset=utf-8",
		".lrc": "text/plain; charset=utf-8",
		".woff2": "font/woff2",
	};
	res.removeHeader("x-frame-options");
	const size = (await lstat(asset)).size;
	let start = 0;
	let end = size - 1;
	let status = 200;
	if (!contents && req?.headers.range) {
		const range = /^bytes=(\d+)-(\d*)$/u.exec(req.headers.range);
		if (!range) throw new DraftError(416, "MEDIA_RANGE");
		start = Number(range[1]);
		end = range[2] ? Number(range[2]) : end;
		if (
			!Number.isSafeInteger(start) ||
			!Number.isSafeInteger(end) ||
			start > end ||
			end >= size
		)
			throw new DraftError(416, "MEDIA_RANGE");
		status = 206;
	}
	res.writeHead(status, {
		"content-type": types[extension] || "application/octet-stream",
		"cache-control": "no-store, private",
		"x-robots-tag": "noindex, nofollow",
		"x-content-type-options": "nosniff",
		"referrer-policy": "no-referrer",
		...(!contents
			? {
					"accept-ranges": "bytes",
					"content-length": Math.max(0, end - start + 1),
				}
			: {}),
		...(status === 206
			? { "content-range": `bytes ${start}-${end}/${size}` }
			: {}),
		"content-security-policy": `default-src 'none'; sandbox; script-src 'none'; connect-src 'none'; img-src ${origin}${prefix} data:; media-src ${origin}${prefix}; style-src 'unsafe-inline' ${origin}${prefix}; font-src ${origin}${prefix}; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`,
	});
	if (contents) res.end(contents);
	else if (!size) res.end();
	else {
		const stream = createReadStream(asset, { start, end });
		res.on("close", () => stream.destroy());
		stream.on("error", () => res.destroy());
		stream.pipe(res);
	}
}
