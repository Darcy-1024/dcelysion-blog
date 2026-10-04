import type { Conflict, DraftDetail } from "../shared/contracts.js";

export type SaveRequest = {
	requestId: string;
	revision: number;
	source: string;
};
export type SaveResult =
	| { ok: true; data: DraftDetail }
	| { ok: false; error: { code: string; details?: Conflict } };
// One in-flight request per editor. Keep its immutable snapshot for uncertain network retries.
export class EditorSession {
	source: string;
	savedSource: string;
	revision: number;
	state: "saved" | "dirty" | "saving" | "failed" | "conflict" = "saved";
	error = "";
	conflict: Conflict | null = null;
	pending: SaveRequest | null = null;
	busy = false;
	disposed = false;
	constructor(
		public detail: DraftDetail,
		private transport: (request: SaveRequest) => Promise<SaveResult>,
		private changed: () => void,
	) {
		this.source = this.savedSource = detail.draft.source;
		this.revision = detail.draft.revision;
		if (detail.sourceState.changed && !detail.draft.snapshot) {
			this.state = "conflict";
			this.conflict = { reason: "source", saved: detail };
		}
	}
	get dirty() {
		return this.source !== this.savedSource || this.pending !== null;
	}
	edit(source: string) {
		this.source = source;
		if (!this.busy && this.state !== "conflict" && this.state !== "failed")
			this.state = this.dirty ? "dirty" : "saved";
		this.changed();
	}
	async save() {
		if (this.disposed || this.busy || this.state === "conflict" || !this.dirty)
			return;
		const request = this.pending || {
			requestId: crypto.randomUUID(),
			revision: this.revision,
			source: this.source,
		};
		this.pending = request;
		this.busy = true;
		this.state = "saving";
		this.error = "";
		this.changed();
		try {
			const result = await this.transport(request);
			if (this.disposed) return;
			if (!result.ok) {
				this.error = result.error.code;
				if (
					["INPUT", "PATH", "REQUEST_REUSE", "NOT_FOUND"].includes(
						result.error.code,
					)
				)
					this.pending = null;
				if (result.error.details) {
					this.conflict = result.error.details;
					this.state = "conflict";
					this.pending = null;
				} else this.state = "failed";
			} else {
				this.detail = result.data;
				this.revision = result.data.draft.revision;
				this.savedSource = request.source;
				this.pending = null;
				this.state = this.dirty ? "dirty" : "saved";
				if (result.data.sourceState.changed && !result.data.draft.snapshot) {
					this.conflict = { reason: "source", saved: result.data };
					this.state = "conflict";
				}
			}
		} catch {
			if (!this.disposed) {
				this.state = "failed";
				this.error = "NETWORK";
			}
		} finally {
			this.busy = false;
			if (!this.disposed) this.changed();
		}
	}
	dispose() {
		this.disposed = true;
	}
}
export function textareaChange(previous: string, next: string): string {
	const normalized = previous.replace(/\r\n|\r/gu, "\n");
	if (normalized === next) return previous;
	let first = 0;
	while (
		first < normalized.length &&
		first < next.length &&
		normalized[first] === next[first]
	)
		first++;
	let last = 0;
	while (
		last < normalized.length - first &&
		last < next.length - first &&
		normalized[normalized.length - 1 - last] === next[next.length - 1 - last]
	)
		last++;
	const offset = (position: number) => {
		let original = 0;
		let index = 0;
		while (index < position) {
			original += previous.slice(original, original + 2) === "\r\n" ? 2 : 1;
			index++;
		}
		return original;
	};
	return (
		previous.slice(0, offset(first)) +
		next
			.slice(first, next.length - last)
			.replaceAll(
				"\n",
				previous.includes("\r\n")
					? "\r\n"
					: previous.includes("\r")
						? "\r"
						: "\n",
			) +
		previous.slice(offset(normalized.length - last))
	);
}
