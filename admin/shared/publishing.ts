import type { Draft } from "./contracts.js";
import type { MediaPlan } from "./media.js";
export type PublishTarget = {
	id: string;
	label: string;
	branch: string;
	remote: string;
	deploy: boolean;
	pages: boolean;
	mode: "local-fixture" | "tencent";
	fingerprint: string;
};
export type JobEffects = {
	base?: string;
	commit?: string;
	built?: boolean;
	digest?: string;
	release?: string;
	previous?: string | null;
	pushed?: boolean;
	installed?: boolean;
	buildMode?: string;
	distributionHash?: string;
};
export type Job = {
	id: string;
	draftId: string;
	revision: number;
	snapshot: Draft;
	mediaPlan?: MediaPlan;
	target: PublishTarget;
	kind: "preview" | "publish";
	status: "queued" | "running" | "failed" | "succeeded";
	stage: string;
	effects: JobEffects;
	error: string | null;
	attempt: number;
	createdAt: string;
	logs: { stage: string; message: string; created_at: string }[];
};
export type Release = { id: string; digest: string; current: boolean };
export type PublishingInfo = {
	targets: PublishTarget[];
	buildMode: string;
	available: boolean;
	reason: string | null;
};
