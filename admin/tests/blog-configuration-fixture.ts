// Trusted local full-blog build input. No unpublished content, .env or production writes.
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { command } from "../server/executor.js";
import { fixtureWav } from "./configuration-fixture.js";

const root = await mkdtemp(join(tmpdir(), "dc-blog-config-stage5-"));
const tracked = (await command("git", ["ls-files", "-z"], process.cwd()))
	.split("\0")
	.filter(Boolean);
const allowed = (name: string) =>
	/^(?:src\/|public\/|scripts\/|workers\/sites-static\/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|astro\.config\.mjs$|tsconfig\.json$)/u.test(
		name,
	) &&
	!name.startsWith("src/content/posts/") &&
	!name.startsWith("src/content/dynamic/") &&
	!/^(?:public\/(?:gallery|assets\/(?:music|videos))\/)/u.test(name);
const extras = [
	"src/config/manifest-adapters.ts",
	"src/config/manifests/music.json",
	"src/config/manifests/gallery.json",
	"src/config/manifests/settings.json",
];
for (const name of new Set([...tracked.filter(allowed), ...extras])) {
	const target = join(root, name);
	await mkdir(dirname(target), { recursive: true });
	await copyFile(resolve(name), target);
}
await symlink(
	resolve("node_modules"),
	join(root, "node_modules"),
	process.platform === "win32" ? "junction" : "dir",
);
await mkdir(join(root, "src/content/posts"), { recursive: true });
await mkdir(join(root, "src/content/dynamic"), { recursive: true });
await writeFile(
	join(root, "src/content/posts/fixture.md"),
	"---\ntitle: 公开配置验证 fixture\npublished: 2026-10-01\ndraft: false\n---\n\n仅本地公开构建验证，🙂\n",
);
await writeFile(
	join(root, "src/content/dynamic/fixture.md"),
	"---\npublished: 2026-10-01\ndraft: false\n---\n\n公开 fixture 动态\n",
);
const media = join(root, "public/__fixture");
await mkdir(media, { recursive: true });
await writeFile(join(media, "audio.wav"), fixtureWav());
await sharp({
	create: { width: 1800, height: 1200, channels: 3, background: "#659ad4" },
})
	.png()
	.toFile(join(media, "original.png"));
await sharp(join(media, "original.png"))
	.resize({ width: 1200 })
	.webp()
	.toFile(join(media, "preview.webp"));
await writeFile(
	join(root, "src/config/manifests/music.json"),
	JSON.stringify(
		{
			version: 1,
			tracks: [
				{
					id: "fixture-song",
					name: "本地 fixture 曲目",
					artist: "fixture",
					url: "/__fixture/audio.wav",
					cover: "/__fixture/preview.webp",
					lrc: "[00:00.00]本地试听",
				},
			],
		},
		null,
		2,
	),
);
await writeFile(
	join(root, "src/config/manifests/gallery.json"),
	JSON.stringify(
		{
			version: 1,
			albums: [
				{
					id: "fixture-album",
					name: "本地 fixture 相册",
					description: "仅构建验收",
					photos: [
						{
							id: "fixture-photo",
							original: "/__fixture/original.png",
							preview: "/__fixture/preview.webp",
							width: 1200,
							height: 800,
						},
					],
				},
			],
		},
		null,
		2,
	),
);
const settings = JSON.parse(
	await readFile(join(root, "src/config/manifests/settings.json"), "utf8"),
);
settings.title = "第五阶段 fixture 站点";
settings.navbarTitle = settings.title;
await writeFile(
	join(root, "src/config/manifests/settings.json"),
	JSON.stringify(settings, null, 2),
);
for (const [name, addition] of [
	[
		"siteConfig",
		"if (siteConfig.vndb) { siteConfig.vndb.userId = ''; siteConfig.vndb.downloadCovers = false; }",
	],
	["commentConfig", "commentConfig.type = 'none';"],
])
	await writeFile(
		join(root, `src/config/${name}.ts`),
		(await readFile(join(root, `src/config/${name}.ts`), "utf8")) +
			"\n// Explicit local fixture overrides\n" +
			addition +
			"\n",
	);
console.log(root);
