import { parseMediaPolicy } from "../../src/utils/media-contract.js";
export type ConfigurationKind = "music" | "gallery" | "settings";
export type DraftKind = "posts" | "dynamic" | ConfigurationKind;
export const isConfiguration = (kind: string): kind is ConfigurationKind =>
	["music", "gallery", "settings"].includes(kind);
export const configurationPaths = {
	music: "src/config/manifests/music.json",
	gallery: "src/config/manifests/gallery.json",
	settings: "src/config/manifests/settings.json",
} as const;
export const settingsFields = [
	"title",
	"subtitle",
	"description",
	"keywords",
	"navbarTitle",
] as const;
export type Track = {
	id: string;
	name: string;
	artist: string;
	url: string;
	cover?: string;
	lrc?: string;
	[key: string]: unknown;
};
export type Photo = {
	id: string;
	original: string;
	preview?: string;
	width?: number;
	height?: number;
	sha256?: string;
	objectKey?: string;
	[key: string]: unknown;
};
export type Album = {
	id: string;
	name: string;
	description?: string;
	date?: string;
	location?: string;
	tags?: string[];
	cover?: string;
	photos?: Photo[];
	password?: string;
	passwordHint?: string;
	[key: string]: unknown;
};
export type Configuration = {
	version: number;
	tracks?: Track[];
	albums?: Album[];
	title?: string;
	subtitle?: string;
	description?: string;
	keywords?: string[];
	navbarTitle?: string;
	[key: string]: unknown;
};
export type ConfigurationReference = {
	record: Record<string, unknown>;
	field: string;
	value: string;
	role: "image" | "audio" | "text";
};
function fail(message: string): never {
	throw new Error(message);
}
function object(value: unknown): asserts value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail("需要普通数据对象");
}
function text(value: unknown, max = 2000): asserts value is string {
	if (
		typeof value !== "string" ||
		value.length > max ||
		[...value].some(
			(char) =>
				char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)),
		)
	)
		fail("文字格式无效");
}
export function validAsset(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		!value ||
		value.length > 2048 ||
		/[\s"'<>\\]/u.test(value) ||
		value.includes("%00")
	)
		return false;
	if (value.startsWith("/"))
		return (
			!value.startsWith("//") &&
			!value.split(/[/?#]/u).some((s) => s === ".." || s === ".") &&
			!value.startsWith("/api/")
		);
	try {
		const parsed = new URL(value);
		return parsed.protocol === "https:" && !parsed.username && !parsed.password;
	} catch {
		return false;
	}
}
export function configurationReferences(
	kind: ConfigurationKind,
	data: Configuration,
): ConfigurationReference[] {
	const refs: ConfigurationReference[] = [];
	const add = (
		record: Record<string, unknown>,
		field: string,
		role: ConfigurationReference["role"],
	) => {
		const value = record[field];
		if (typeof value === "string" && value)
			refs.push({ record, field, value, role });
	};
	if (kind === "music")
		for (const track of data.tracks || []) {
			add(track, "url", "audio");
			add(track, "cover", "image");
			if (track.lrc && !track.lrc.startsWith("[")) add(track, "lrc", "text");
		}
	if (kind === "gallery")
		for (const album of data.albums || []) {
			add(album, "cover", "image");
			for (const photo of album.photos || []) {
				add(photo, "original", "image");
				add(photo, "preview", "image");
			}
		}
	return refs;
}
// Unknown values are retained, but are immutable. The schema only authorizes these fields.
function retained(
	record: Record<string, unknown>,
	base: Record<string, unknown> | undefined,
	fields: string[],
) {
	for (const key of new Set([
		...Object.keys(record),
		...Object.keys(base || {}),
	]))
		if (
			!fields.includes(key) &&
			JSON.stringify(record[key]) !== JSON.stringify(base?.[key])
		)
			fail(`未支持字段只读：${key}`);
}
function records(value: unknown, max: number): Record<string, unknown>[] {
	if (!Array.isArray(value) || value.length > max) fail("列表格式无效");
	const ids = new Set();
	for (const row of value) {
		object(row);
		if (
			typeof row.id !== "string" ||
			!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/u.test(row.id) ||
			ids.has(row.id)
		)
			fail("记录 ID 无效或重复");
		ids.add(row.id);
	}
	return value;
}
export function parseConfiguration(
	kind: ConfigurationKind,
	source: string,
	baseline?: string,
): Configuration {
	const data = JSON.parse(source);
	object(data);
	if (data.version !== 1) fail("清单版本不支持");
	const base = baseline ? JSON.parse(baseline) : undefined;
	if (base) object(base);
	const fields =
		kind === "music"
			? ["version", "tracks"]
			: kind === "gallery"
				? ["version", "albums"]
				: ["version", ...settingsFields, "mediaRouting"];
	retained(data, base || data, fields);
	if (kind === "music")
		for (const row of records(data.tracks, 500)) {
			retained(
				row,
				base?.tracks?.find((v: Track) => v.id === row.id) ||
					(!baseline ? row : undefined),
				["id", "name", "artist", "url", "cover", "lrc"],
			);
			text(row.name, 300);
			text(row.artist, 300);
			if (!validAsset(row.url)) fail("音频 URL 无效");
			if (row.cover !== undefined && row.cover !== "" && !validAsset(row.cover))
				fail("封面 URL 无效");
			if (row.lrc !== undefined) {
				text(row.lrc, 262144);
				if (
					row.lrc !== "" &&
					!String(row.lrc).startsWith("[") &&
					!validAsset(row.lrc)
				)
					fail("歌词需要 LRC 内容或有效地址");
			}
		}
	if (kind === "gallery")
		for (const row of records(data.albums, 100)) {
			const old = base?.albums?.find((v: Album) => v.id === row.id);
			retained(row, old || (!baseline ? row : undefined), [
				"id",
				"name",
				"description",
				"date",
				"location",
				"tags",
				"cover",
				"photos",
			]);
			text(row.name, 300);
			for (const key of ["description", "location"])
				if (row[key] !== undefined) text(row[key]);
			if (
				row.date &&
				(typeof row.date !== "string" ||
					!/^\d{4}-\d{2}-\d{2}$/u.test(row.date) ||
					new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !==
						row.date)
			)
				fail("相册日期无效");
			if (
				row.tags !== undefined &&
				(!Array.isArray(row.tags) ||
					row.tags.length > 50 ||
					!row.tags.every((v) => typeof v === "string" && v.length <= 100))
			)
				fail("标签格式无效");
			if (row.cover && !validAsset(row.cover)) fail("相册封面地址无效");
			if (row.photos !== undefined)
				for (const photo of records(row.photos, 5000)) {
					const oldPhoto = old?.photos?.find((v: Photo) => v.id === photo.id);
					retained(photo, oldPhoto || (!baseline ? photo : undefined), [
						"id",
						"original",
						"preview",
						"width",
						"height",
						"sha256",
						"objectKey",
					]);
					if (
						!validAsset(photo.original) ||
						(photo.preview && !validAsset(photo.preview))
					)
						fail("图片地址无效");
					for (const key of ["width", "height"])
						if (
							photo[key] !== undefined &&
							(!Number.isSafeInteger(photo[key]) ||
								Number(photo[key]) < 1 ||
								Number(photo[key]) > 24000000)
						)
							fail("图片尺寸无效");
					if (
						photo.sha256 !== undefined &&
						(typeof photo.sha256 !== "string" ||
							!/^[a-f0-9]{64}$/u.test(photo.sha256))
					)
						fail("图片 hash 无效");
					if (photo.objectKey !== undefined) text(photo.objectKey, 300);
				}
			if (baseline && old?.photos !== undefined && row.photos === undefined)
				fail("显式图片清单不能恢复为扫描模式");
		}
	if (kind === "settings" && data.mediaRouting !== undefined)
		parseMediaPolicy(data.mediaRouting);
	if (kind === "settings")
		for (const key of settingsFields) {
			if (key === "keywords") {
				if (
					!Array.isArray(data[key]) ||
					data[key].length > 50 ||
					!data[key].every((v) => typeof v === "string" && v.length <= 100)
				)
					fail("关键词格式无效");
			} else text(data[key]);
		}
	return data as Configuration;
}
export const serializeConfiguration = (data: Configuration) =>
	`${JSON.stringify(data, null, 2)}\n`;
export const protectedAsset = (value: string) =>
	value.replace(
		/^\/__managed-media\/([a-f0-9-]{36})\/(original|preview)$/u,
		"/api/library/$1/$2",
	);
