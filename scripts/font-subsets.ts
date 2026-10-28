/** Read mapped Unicode characters from the format 4/12 cmap tables in an SFNT font. */
export function fontCodepoints(font: Buffer): number[] {
	let cmap = -1;
	for (let i = 0; i < font.readUInt16BE(4); i++) {
		const record = 12 + i * 16;
		if (font.toString("ascii", record, record + 4) === "cmap") {
			cmap = font.readUInt32BE(record + 8);
		}
	}
	if (cmap < 0) throw new Error("Font has no cmap");
	const points = new Set<number>();
	for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
		const record = cmap + 4 + i * 8;
		const platform = font.readUInt16BE(record);
		const encoding = font.readUInt16BE(record + 2);
		if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding)))
			continue;
		const table = cmap + font.readUInt32BE(record + 4);
		const format = font.readUInt16BE(table);
		if (format === 12) {
			for (let g = 0; g < font.readUInt32BE(table + 12); g++) {
				const group = table + 16 + g * 12;
				const start = font.readUInt32BE(group);
				const end = font.readUInt32BE(group + 4);
				const glyph = font.readUInt32BE(group + 8);
				if (end > 0x10ffff) throw new Error("Invalid Unicode cmap range");
				for (let cp = start; cp <= end; cp++) {
					if (glyph + cp - start) points.add(cp);
				}
			}
		} else if (format === 4) {
			const count = font.readUInt16BE(table + 6) / 2;
			for (let segment = 0; segment < count; segment++) {
				const end = font.readUInt16BE(table + 14 + segment * 2);
				const start = font.readUInt16BE(table + 16 + count * 2 + segment * 2);
				const delta = font.readInt16BE(table + 16 + count * 4 + segment * 2);
				const offsetAt = table + 16 + count * 6 + segment * 2;
				const offset = font.readUInt16BE(offsetAt);
				for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
					const raw = offset
						? font.readUInt16BE(offsetAt + offset + (cp - start) * 2)
						: cp;
					const glyph = offset && !raw ? 0 : (raw + delta) & 0xffff;
					if (glyph) points.add(cp);
				}
			}
		}
	}
	if (!points.size)
		throw new Error("Font Unicode cmap is empty or unsupported");
	return [...points].sort((a, b) => a - b);
}

export function unicodeRange(points: number[]): string {
	if (!points.length) throw new Error("Cannot emit an empty unicode-range");
	const ranges: string[] = [];
	for (let i = 0; i < points.length; i++) {
		const start = points[i];
		while (i + 1 < points.length && points[i + 1] === points[i] + 1) i++;
		const end = points[i];
		ranges.push(
			`U+${start.toString(16)}${end === start ? "" : `-${end.toString(16)}`}`,
		);
	}
	return ranges.join(",");
}

/** Keep the existing build text in the core; cover all other mapped points exactly once. */
export function splitCodepoints(points: number[], text: string): number[][] {
	const coreChars = new Set([...text].map((char) => char.codePointAt(0)));
	const core = points.filter((cp) => coreChars.has(cp));
	if (!core.length) throw new Error("Core subset has no mapped characters");
	const other = points.filter((cp) => !coreChars.has(cp));
	const groups = [core];
	for (let i = 0; i < other.length; i += 256)
		groups.push(other.slice(i, i + 256));
	return groups;
}

/** Change only the source and range, retaining Astro's family, metrics and other descriptors. */
export function subsetFace(
	face: string,
	url: string,
	points?: number[],
): string {
	if (!/\bsrc\s*:[^;{}]+/i.test(face)) {
		throw new Error("Cannot rewrite font-face without src");
	}
	let rewritten = face.replace(
		/\bsrc\s*:[^;{}]+/i,
		`src:url("${url}") format("woff2")`,
	);
	if (points) {
		rewritten = rewritten.replace(/\bunicode-range\s*:[^;{}]+;?/gi, "");
		rewritten = rewritten.replace(
			/;?\s*}$/,
			`;unicode-range:${unicodeRange(points)}}`,
		);
	}
	return rewritten;
}
