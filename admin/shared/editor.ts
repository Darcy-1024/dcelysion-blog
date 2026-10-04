import { isAlias, isMap, isScalar, isSeq, parseDocument, visit } from "yaml";
import { type DraftKind, isConfiguration } from "./configuration.js";

export type Metadata = {
	values: Record<string, unknown>;
	editable: string[];
	errors: string[];
};
export const fields = {
	posts: ["title", "published", "category", "tags", "image", "draft"],
	dynamic: ["published", "location", "pinned", "draft"],
};
function validPublished(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d{2}-\d{2}(?:[ Tt]\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?:[ \t]*(?:Z|[+-]\d{1,2}(?::?\d{2})?))?)?$/u.test(
			value,
		)
	)
		return false;
	const date = new Date(value);
	const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
	return (
		Number.isFinite(date.getTime()) &&
		Number.isFinite(calendar.getTime()) &&
		calendar.toISOString().slice(0, 10) === value.slice(0, 10)
	);
}
export function frontmatter(source: string) {
	const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/u.exec(source);
	if (!opening) return null;
	const rest = source.slice(opening[0].length);
	const closing = /^---[ \t]*(?:\r?\n|$)/mu.exec(rest);
	if (!closing) return null;
	return {
		start: opening[0].length,
		end: opening[0].length + closing.index,
		yaml: rest.slice(0, closing.index),
		bodyStart: opening[0].length + closing.index + closing[0].length,
	};
}
function parse(source: string) {
	const fm = frontmatter(source);
	if (!fm) throw new Error("缺少完整 frontmatter 分隔符；请在源码中修复");
	const doc = parseDocument(fm.yaml, {
		keepSourceTokens: true,
		prettyErrors: false,
		logLevel: "silent",
		uniqueKeys: true,
	});
	if (
		doc.errors.length ||
		doc.warnings.length ||
		!isMap(doc.contents) ||
		doc.contents.flow
	)
		throw new Error("YAML 无法可靠解析为普通映射；表单已禁用，源码仍可保存");
	let references = false;
	visit(doc, (_key, node) => {
		if (
			isAlias(node) ||
			(node && typeof node === "object" && "anchor" in node && node.anchor)
		)
			references = true;
	});
	if (
		references ||
		doc.contents.items.some(
			(item) =>
				!isScalar(item.key) ||
				typeof item.key.value !== "string" ||
				item.key.value === "<<",
		)
	)
		throw new Error("YAML 引用或复杂键仅支持源码编辑");
	return { fm, map: doc.contents };
}
function simple(node: unknown): boolean {
	if (isScalar(node))
		return (
			!node.anchor &&
			!node.tag &&
			!!node.range &&
			node.range[1] > node.range[0] &&
			node.type !== "BLOCK_LITERAL" &&
			node.type !== "BLOCK_FOLDED"
		);
	return (
		isSeq(node) &&
		node.flow === true &&
		!node.anchor &&
		!node.tag &&
		!node.comment &&
		node.items.every((item) => isScalar(item) && !item.comment && simple(item))
	);
}
export function inspect(source: string, kind: DraftKind): Metadata {
	if (isConfiguration(kind)) return { values: {}, editable: [], errors: [] };
	try {
		const { fm, map } = parse(source);
		const values: Record<string, unknown> = {};
		const editable: string[] = [];
		for (const field of fields[kind]) {
			const pair = map.items.find(
				(item) => isScalar(item.key) && item.key.value === field,
			);
			const node = pair?.value;
			if (!pair) {
				editable.push(field);
				continue;
			}
			if (isScalar(node)) values[field] = node.value;
			else if (isSeq(node) && node.items.every(isScalar))
				values[field] = node.items.map((item) =>
					isScalar(item) ? item.value : null,
				);
			const range = node && "range" in node ? node.range : null;
			if (
				simple(node) &&
				range &&
				!(
					typeof values[field] === "string" &&
					/[\r\n]/u.test(values[field] as string)
				) &&
				!(
					Array.isArray(values[field]) &&
					(values[field] as unknown[]).some(
						(value) => typeof value === "string" && /[\r\n]/u.test(value),
					)
				) &&
				!fm.yaml.slice(range[0], range[1]).includes("\n")
			)
				editable.push(field);
		}
		const errors: string[] = [];
		if (kind === "posts" && typeof values.title !== "string")
			errors.push("title 需要文字");
		for (const name of kind === "posts"
			? ["published", "updated"]
			: ["published"]) {
			const date = map.get(name, true);
			if (name === "updated" && date === undefined) continue;
			if (
				!isScalar(date) ||
				date.type !== "PLAIN" ||
				!validPublished(date.value)
			)
				errors.push(`${name} 需要无引号的有效日期，时间须含秒`);
		}
		for (const name of ["draft", "pinned"]) {
			const value = map.get(name);
			if (value !== undefined && typeof value !== "boolean")
				errors.push(`${name} 需要布尔值`);
		}
		for (const name of kind === "posts"
			? [
					"title",
					"image",
					"description",
					"lang",
					"author",
					"sourceLink",
					"licenseName",
					"licenseUrl",
					"password",
					"passwordHint",
					"series",
					"prevTitle",
					"prevSlug",
					"nextTitle",
					"nextSlug",
				]
			: ["location"]) {
			const value = map.get(name);
			if (value !== undefined && typeof value !== "string")
				errors.push(`${name} 需要文字`);
		}
		if (kind === "posts") {
			const category = map.get("category");
			if (category != null && typeof category !== "string")
				errors.push("category 需要文字或 null");
			const tags = map.get("tags", true);
			if (
				tags !== undefined &&
				(!isSeq(tags) ||
					!tags.items.every(
						(item) => isScalar(item) && typeof item.value === "string",
					))
			)
				errors.push("tags 需要文字数组");
			for (const name of ["comment", "typography"])
				if (map.get(name) !== undefined && typeof map.get(name) !== "boolean")
					errors.push(`${name} 需要布尔值`);
			if (
				map.get("seriesOrder") !== undefined &&
				typeof map.get("seriesOrder") !== "number"
			)
				errors.push("seriesOrder 需要数字");
		}
		return { values, editable, errors };
	} catch (cause) {
		return {
			values: {},
			editable: [],
			errors: [cause instanceof Error ? cause.message : "YAML 无效"],
		};
	}
}
export function patchField(
	source: string,
	kind: DraftKind,
	field: string,
	value: unknown,
): string {
	if (isConfiguration(kind)) throw new Error("配置需要结构化表单");
	const info = inspect(source, kind);
	if (!info.editable.includes(field)) throw new Error("该字段仅支持源码编辑");
	if (
		field === "tags"
			? !Array.isArray(value) ||
				!value.every((item) => typeof item === "string")
			: field === "draft" || field === "pinned"
				? typeof value !== "boolean"
				: typeof value !== "string"
	)
		throw new Error("字段值类型无效");
	if (JSON.stringify(info.values[field]) === JSON.stringify(value))
		return source;
	const { fm, map } = parse(source);
	const pair = map.items.find(
		(item) => isScalar(item.key) && item.key.value === field,
	);
	const serialized =
		field === "published" && validPublished(value)
			? value
			: JSON.stringify(value);
	if (serialized === undefined) throw new Error("字段值无效");
	if (!pair)
		return (
			source.slice(0, fm.end) +
			`${field}: ${serialized}${source.includes("\r\n") ? "\r\n" : "\n"}` +
			source.slice(fm.end)
		);
	const node = pair.value;
	const range = node && "range" in node ? node.range : null;
	if (!range) throw new Error("该字段仅支持源码编辑");
	return (
		source.slice(0, fm.start + range[0]) +
		serialized +
		source.slice(fm.start + range[1])
	);
}
export type ImageReference = {
	start: number;
	end: number;
	raw: string;
	url: string;
};
export function images(source: string): {
	items: ImageReference[];
	sortable: boolean;
} {
	const start = frontmatter(source)?.bodyStart ?? 0;
	const body = source.slice(start);
	// Only whole-line, simple inline images outside fenced/code/MDX syntax are sortable.
	if (/`|~~~|^ {4}|^\t|<|^import\s|^export\s|!\[[^\n]*\]\[/mu.test(body))
		return { items: [], sortable: false };
	const items: ImageReference[] = [];
	const pattern =
		/^!\[[^\]\r\n]*\]\(([^\s()]+)(?:[ \t]+(?:"[^"\r\n]*"|'[^'\r\n]*'))?\)[ \t]*\r?$/gmu;
	for (const match of body.matchAll(pattern)) {
		const raw = match[0].replace(/\r$/u, "");
		items.push({
			start: start + match.index,
			end: start + match.index + raw.length,
			raw,
			url: match[1],
		});
	}
	const count = (body.match(/!\[/gu) || []).length;
	return { items, sortable: items.length === count };
}
export function moveImage(source: string, from: number, to: number): string {
	const info = images(source);
	if (!info.sortable || !info.items[from] || !info.items[to])
		throw new Error("复杂图片语法请在源码中排序");
	const refs = info.items.map((item) => item.raw);
	const [moved] = refs.splice(from, 1);
	refs.splice(to, 0, moved);
	let result = source;
	for (let i = info.items.length - 1; i >= 0; i--)
		result =
			result.slice(0, info.items[i].start) +
			refs[i] +
			result.slice(info.items[i].end);
	return result;
}
export function insertImage(
	source: string,
	url: string,
	alt: string,
	at: number,
): string {
	if (
		!/^(?:https?:\/\/|\.?\.?\/|\/)[^\s()<>"']+$/u.test(url) ||
		/[[\]\r\n]/u.test(alt)
	)
		throw new Error("图片地址或说明格式无效");
	const eol = source.includes("\r\n") ? "\r\n" : "\n";
	return `${source.slice(0, at)}${eol}![${alt}](${url})${eol}${source.slice(at)}`;
}
