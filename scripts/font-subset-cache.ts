import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import subsetFont from "subset-font";

type SubsetOptions = NonNullable<Parameters<typeof subsetFont>[2]>;

function digest(key: string, bytes: Buffer): Buffer {
	return createHash("sha256").update(key).update(bytes).digest();
}

function isWoff2(bytes: Buffer): boolean {
	return (
		bytes.length >= 48 &&
		bytes.toString("ascii", 0, 4) === "wOF2" &&
		bytes.readUInt32BE(8) === bytes.length
	);
}

async function writeAtomic(
	file: string,
	bytes: Buffer | string,
): Promise<void> {
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporary, bytes, { flag: "wx" });
		await fs.rename(temporary, file);
	} finally {
		await fs.unlink(temporary).catch(() => {});
	}
}

export class FontSubsetCache {
	private readonly used = new Set<string>();
	private writable = true;
	private hits = 0;
	private misses = 0;

	constructor(
		private readonly dir: string,
		private readonly algorithm: string,
		private readonly generate: typeof subsetFont = subsetFont,
	) {}

	async getOrGenerate(
		font: Buffer,
		fontHash: string,
		chars: string,
		options: SubsetOptions,
	): Promise<Buffer> {
		// HarfBuzz takes a Unicode set; scan order must not turn an identical set into a miss.
		const characters = [...new Set(chars)].sort();
		const key = createHash("sha256")
			.update(JSON.stringify([this.algorithm, fontHash, characters, options]))
			.digest("hex");
		const entry = `${key}.bin`;
		const file = path.join(this.dir, entry);
		this.used.add(entry);
		const cached = await fs.readFile(file).catch(() => undefined);
		if (cached) {
			// Bind the checksum to the input key as well as the bytes.
			const bytes = cached.subarray(32);
			if (isWoff2(bytes) && cached.subarray(0, 32).equals(digest(key, bytes))) {
				this.hits++;
				return bytes;
			}
		}

		this.misses++;
		const bytes = await this.generate(font, chars, options);
		if (this.writable) {
			try {
				if (!isWoff2(bytes)) throw new Error("Invalid WOFF2 output");
				await writeAtomic(file, Buffer.concat([digest(key, bytes), bytes]));
			} catch (error) {
				this.writable = false;
				console.warn("   Could not write font subset cache:", error);
			}
		}
		return bytes;
	}

	async finish(): Promise<void> {
		console.log(
			`   Font subset cache: ${this.hits} hit(s), ${this.misses} miss(es).`,
		);
		if (!this.writable) return;
		try {
			// Preserve other files and keep the next restored archive bounded to this build.
			for (const entry of await fs.readdir(this.dir, { withFileTypes: true })) {
				if (
					entry.isFile() &&
					/^[a-f0-9]{64}\.bin$/.test(entry.name) &&
					!this.used.has(entry.name)
				) {
					await fs.unlink(path.join(this.dir, entry.name));
				}
			}
			await writeAtomic(
				path.join(this.dir, "manifest.json"),
				JSON.stringify([...this.used].sort()),
			);
		} catch (error) {
			console.warn("   Could not finalize font subset cache:", error);
		}
	}
}

export async function openFontSubsetCache(): Promise<
	FontSubsetCache | undefined
> {
	if (process.env.BLOG_FONT_SUBSET_CACHE !== "1") return;
	try {
		const algorithm = createHash("sha256").update(process.version);
		for (const file of [
			"../pnpm-lock.yaml",
			"./subset-fonts.ts",
			"./font-subsets.ts",
			"./font-subset-cache.ts",
		]) {
			const bytes = await fs.readFile(new URL(file, import.meta.url));
			algorithm.update(createHash("sha256").update(bytes).digest());
		}
		const dir = path.resolve("cache/build/font-subsets");
		await fs.mkdir(dir, { recursive: true });
		await fs.rm(path.join(dir, "manifest.json"), { force: true });
		return new FontSubsetCache(dir, algorithm.digest("hex"));
	} catch (error) {
		console.warn("   Font subset cache unavailable:", error);
		return undefined;
	}
}
