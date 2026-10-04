import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { glob } from "glob";
import matter from "gray-matter";

import { contentIdentity } from "../shared/identity.js";

import { inside } from "./paths.js";

export type ContentKind = "posts" | "dynamic";
export type ContentItem = {
	id: string;
	title: string;
	published: string;
	publishedDate: string;
	draft: boolean;
	url: string;
	commentPath: string;
	description: string;
	tags: string[];
	category: string;
	format: "md" | "mdx";
};
export type ContentPage = {
	items: ContentItem[];
	total: number;
	page: number;
	pageSize: number;
	pages: number;
};
export type ContentQuery = {
	kind: ContentKind;
	search: string;
	status: "all" | "published" | "draft";
	page: number;
	pageSize: number;
};

export async function contentInventory(
	contentRoot: string,
	kind: ContentKind,
): Promise<ContentItem[]> {
	const folder = resolve(contentRoot, "src", "content", kind);
	const realFolder = await realpath(folder);
	if (!inside(await realpath(contentRoot), realFolder))
		throw new Error("内容目录越界");
	const names = await glob(kind === "posts" ? "**/*.{md,mdx}" : "**/*.md", {
		cwd: folder,
		nodir: true,
		follow: false,
	});
	const items: ContentItem[] = [];
	for (const name of names) {
		const full = resolve(folder, name);
		if (
			!inside(folder, full) ||
			!(await lstat(full)).isFile() ||
			!inside(realFolder, await realpath(full))
		) {
			throw new Error(`内容文件越界或不是常规文件：${name}`);
		}
		const ext = extname(name).toLowerCase();
		if (ext !== ".md" && !(kind === "posts" && ext === ".mdx"))
			throw new Error(`内容扩展名无效：${name}`);
		let data: Record<string, unknown>;
		let body: string;
		let publishedDate: string;
		try {
			const parsed = matter(await readFile(full, "utf8"));
			data = parsed.data;
			body = parsed.content;
			publishedDate =
				/^published:\s*['"]?(\d{4}-\d{2}-\d{2})/mu.exec(parsed.matter)?.[1] ||
				"";
		} catch (error) {
			throw new Error(`解析内容失败：${name}`, { cause: error });
		}
		const date =
			data.published instanceof Date
				? data.published
				: new Date(String(data.published ?? ""));
		if (!Number.isFinite(date.getTime()))
			throw new Error(`published 无效：${name}`);
		publishedDate ||= date.toISOString().slice(0, 10);
		if (kind === "posts" && typeof data.title !== "string")
			throw new Error(`title 无效：${name}`);
		if (data.draft != null && typeof data.draft !== "boolean")
			throw new Error(`draft 无效：${name}`);
		const id = name.replaceAll("\\", "/");
		const slug = contentIdentity(id, await readFile(full, "utf8")).id;
		const plain = body
			.replace(/<[^>]*>|!\[[^\]]*\]\([^)]*\)|[#*_`>[\]]/gu, " ")
			.replace(/\s+/gu, " ")
			.trim();
		const title =
			kind === "posts"
				? String(data.title)
				: plain.slice(0, 72) || "（无文字动态）";
		const item: ContentItem = {
			id,
			commentPath: kind === "posts" ? `/posts/${slug}/` : `/dynamic/${slug}/`,
			title,
			published: date.toISOString(),
			publishedDate,
			draft: data.draft === true,
			url:
				kind === "posts"
					? `/posts/${slug}/`
					: `/dynamic/#dynamic-${slug.replace(/[^a-zA-Z0-9_-]/gu, "-")}`,
			description:
				kind === "posts" ? String(data.description || "") : plain.slice(0, 150),
			tags: Array.isArray(data.tags)
				? data.tags.filter((tag): tag is string => typeof tag === "string")
				: [],
			category: typeof data.category === "string" ? data.category : "",
			format: ext === ".mdx" ? "mdx" : "md",
		};
		items.push(item);
	}
	return items;
}

export async function listContent(
	contentRoot: string,
	query: ContentQuery,
): Promise<ContentPage> {
	const items = await contentInventory(contentRoot, query.kind);
	const search = query.search.trim().toLocaleLowerCase();
	const filtered = items
		.filter(
			(item) =>
				(query.status === "all" ||
					(item.draft ? "draft" : "published") === query.status) &&
				(!search ||
					[item.title, item.id, item.description, item.category, ...item.tags]
						.join(" ")
						.toLocaleLowerCase()
						.includes(search)),
		)
		.sort(
			(a, b) =>
				b.published.localeCompare(a.published) || a.id.localeCompare(b.id),
		);
	return {
		items: filtered.slice(
			(query.page - 1) * query.pageSize,
			query.page * query.pageSize,
		),
		total: filtered.length,
		page: query.page,
		pageSize: query.pageSize,
		pages: Math.ceil(filtered.length / query.pageSize),
	};
}
