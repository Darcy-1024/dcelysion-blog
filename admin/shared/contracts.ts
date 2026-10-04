import type { DraftKind } from "./configuration.js";
import type { Metadata } from "./editor.js";
export type Draft = {
	id: string;
	kind: DraftKind;
	baseDependencies?: Record<string, string>;
	path: string;
	contentId: string;
	sourceId: string | null;
	baseCommit: string | null;
	baseBlob: string | null;
	baseHash: string | null;
	baseSource: string | null;
	source: string;
	revision: number;
	copiedFrom: string | null;
	snapshot: boolean;
	createdAt: string;
	updatedAt: string;
};
export type SourceState = {
	changed: boolean;
	reason: "changed" | "deleted" | "collision" | null;
	current: string | null;
};
export type DraftDetail = {
	draft: Draft;
	metadata: Metadata;
	sourceState: SourceState;
};
export type Conflict = { reason: "revision" | "source"; saved: DraftDetail };
