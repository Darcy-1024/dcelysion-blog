import { open, readFile, stat } from "node:fs/promises";

// Single writer under the existing media-worker lease, or one public edge process.
// Append + fsync BEFORE transmission. Failed/aborted requests are not refunded.
export class MediaBudget {
	private queue: Promise<unknown> = Promise.resolve();
	constructor(
		readonly journal: string,
		readonly monthlyBytes: number,
		private now = () => new Date(),
	) {}
	private async usage() {
		const month = this.now().toISOString().slice(0, 7);
		let source = "";
		try {
			if ((await stat(this.journal)).size > 8 * 1024 * 1024)
				throw new Error("Rotate retained budget journals before admission");
			source = await readFile(this.journal, "utf8");
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
		}
		let used = 0;
		for (const line of source.split("\n").filter(Boolean)) {
			const record = JSON.parse(line);
			if (
				!/^\d{4}-\d{2}$/.test(record.month) ||
				!Number.isSafeInteger(record.bytes) ||
				record.bytes <= 0
			)
				throw new Error("Invalid media budget journal");
			if (record.month === month) used += record.bytes;
		}
		return { month, used };
	}
	async available() {
		await this.queue.catch(() => {});
		return (await this.usage()).used < this.monthlyBytes;
	}
	reserve(bytes: number) {
		const operation = this.queue
			.catch(() => {})
			.then(async () => {
				if (!Number.isSafeInteger(bytes) || bytes <= 0)
					throw new Error("Invalid media bytes");
				const { month, used } = await this.usage();
				if (used + bytes > this.monthlyBytes)
					throw new Error("MEDIA_MONTHLY_BUDGET");
				const file = await open(this.journal, "a", 0o600);
				try {
					await file.writeFile(`${JSON.stringify({ month, bytes })}\n`);
					await file.sync();
				} finally {
					await file.close();
				}
			});
		this.queue = operation;
		return operation;
	}
}
