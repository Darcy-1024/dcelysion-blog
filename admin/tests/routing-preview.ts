// Trusted local-only blog fixture. Copies source without existing posts/MDX or secrets.

import { spawn } from "node:child_process";
import {
	cp,
	mkdir,
	readFile,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, relative, resolve } from "node:path";
import { listenLocal } from "./local-listener.js";
import { routingFixture } from "./routing-fixture.js";

const workspace = process.cwd();
const root = resolve(workspace, "cache/stage8-routing-blog");
await mkdir(root, { recursive: true });
const video = join(root, "fixture.mp4");
await new Promise<void>((done, reject) => {
	const child = spawn(
		"ffmpeg",
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-y",
			"-f",
			"lavfi",
			"-i",
			"color=c=blue:s=160x90:r=12:d=8",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-movflags",
			"+faststart",
			video,
		],
		{ windowsHide: true },
	);
	child.on("error", reject);
	child.on("exit", (code) =>
		code === 0 ? done() : reject(new Error(`ffmpeg ${code}`)),
	);
});
const f = await routingFixture(video);
await writeFile(
	join(root, "fixture-info.json"),
	JSON.stringify({ manifest: f.manifest, root: f.root }, null, 2),
);
for (const name of [
	"src",
	"public",
	"scripts",
	"workers",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"astro.config.mjs",
	"tsconfig.json",
]) {
	try {
		await cp(join(workspace, name), join(root, name), {
			recursive: true,
			filter: (path) =>
				!relative(workspace, path)
					.replaceAll("\\", "/")
					.match(
						/^(src\/content(?:\/|$)|public\/(gallery|assets\/(music|videos))(?:\/|$))/,
					),
		});
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
	}
}
const astroPath = join(root, "astro.config.mjs");
await writeFile(
	astroPath,
	(await readFile(astroPath, "utf8")).replace(
		"export default defineConfig({",
		'export default defineConfig({ cacheDir: "./.stage8-astro-cache",',
	),
);
try {
	await stat(join(root, "node_modules"));
} catch {
	await symlink(
		join(workspace, "node_modules"),
		join(root, "node_modules"),
		"junction",
	);
}
for (const name of ["posts", "dynamic", "spec", "projects"])
	await mkdir(join(root, "src/content", name), { recursive: true });
for (const name of ["about", "friends", "guestbook"])
	await writeFile(
		join(root, "src/content/spec", `${name}.md`),
		"---\ntitle: Local fixture\n---\nTrusted local fixture.\n",
	);
await writeFile(
	join(root, "src/content/posts/media-fixture.md"),
	`---\ntitle: 媒体选路可信正文\npublished: 2026-10-01\ndescription: local fixture\n---\n首屏不会等待选路。\n\n![正文双来源图片](${f.url("photo")})\n`,
);
const settingsPath = join(root, "src/config/manifests/settings.json");
const settings = JSON.parse(await readFile(settingsPath, "utf8"));
settings.mediaRouting.enabled = true;
settings.mediaRouting.timeoutMs = 2500;
await writeFile(settingsPath, JSON.stringify(settings));
await writeFile(
	join(root, "src/config/manifests/media-distribution.json"),
	JSON.stringify(f.manifest),
);
await writeFile(
	join(root, "src/config/manifests/music.json"),
	JSON.stringify({
		version: 1,
		tracks: ["song1", "song2"].map((id) => ({
			id,
			name: `本地 ${id}`,
			artist: "fixture",
			url: f.url(id),
			cover: f.url("preview"),
			lrc: f.url("lyric"),
		})),
	}),
);
await writeFile(
	join(root, "src/config/manifests/gallery.json"),
	JSON.stringify({
		version: 1,
		albums: [
			{
				id: "route-local",
				name: "本地双来源相册",
				cover: f.url("preview"),
				photos: [
					{ id: "photo", original: f.url("photo"), preview: f.url("preview") },
				],
			},
		],
	}),
);
await writeFile(
	join(root, "src/config/backgroundWallpaper.ts"),
	`import type { BackgroundWallpaperConfig } from "@/types/backgroundWallpaper"; export const backgroundWallpaper: BackgroundWallpaperConfig = { mode: "banner", playerEnable: true, src: { desktop: "/favicon/favicon.ico", mobile: "/favicon/favicon.ico", playerUrl: ${JSON.stringify([f.url("video1"), f.url("video2")])} }, common: { playerMode: "order" } };`,
);
await writeFile(
	join(root, "src/config/analyticsConfig.ts"),
	"export const analyticsConfig = {};\n",
);
const commentPath = join(root, "src/config/commentConfig.ts");
await writeFile(
	commentPath,
	(await readFile(commentPath, "utf8")).replace(
		/enable: true/g,
		"enable: false",
	),
);
for (const route of ["route-fixture", "route-next"])
	await writeFile(
		join(root, `src/pages/${route}.astro`),
		`---
import MainGridLayout from "@/layouts/MainGridLayout.astro";
import PhotoCard from "@/components/pages/gallery/PhotoCard.astro";
import { mediaImageProps } from "@/utils/media-image-props";
---
<MainGridLayout title="媒体选路本地验收">
 <div class="card-base p-6" id="routing-fixture">
 <h1>媒体双来源隔离验收（非公网测速）</h1>
 <p>首屏直接显示；测速不阻塞 HTML。</p>
 <img id="fixture-eager" src="${f.url("photo")}" width="80" height="60" alt="已开始首屏默认图" />
 <a href="/${route === "route-fixture" ? "route-next" : "route-fixture"}/">Swup 下一页</a>
 <a href="/posts/media-fixture/">可信正文图片</a>
 <a href="/gallery/route-local/">实际相册</a>
 <div class="flex flex-wrap gap-2"><button id="fixture-new-image">新响应式图片</button><button id="fixture-fail-image">失败图片</button><button id="fixture-song">换歌曲</button><button id="fixture-video">下一视频</button><button id="fixture-playing-error">已播放资源错误事件</button><button id="fixture-deny">腾讯拒绝新流量</button><button id="fixture-allow">允许腾讯</button><button id="fixture-report">刷新请求报告</button></div>
 <pre id="fixture-report-output" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
 <div id="fixture-new-images"></div>
 <PhotoCard src="${f.url("photo")}" previewSrc="${f.url("preview")}" albumId="fixture" alt="相册预览" />
 <div style="height:1400px"></div>
 <img id="fixture-lazy" {...mediaImageProps('${f.url("photo")}', true, '${f.url("preview")} 80w, ${f.url("photo")} 160w')} loading="lazy" width="80" height="60" alt="尚未激活响应式图" />
 <noscript><img src="${f.url("photo")}" alt="无JS默认图" /></noscript>
 </div>
</MainGridLayout>
<script>
import { assignMedia, activateDeferredImages } from "@/utils/media-client";
function bindFixture() {
 const button = (id, action) => { const element = document.getElementById(id); if(element && !element.dataset.bound) { element.dataset.bound='1'; element.addEventListener('click',action); } };
 button('fixture-new-image', () => { const img = new Image(); img.alt='新响应式图'; img.width=80; img.height=60; document.getElementById('fixture-new-images').append(img); assignMedia(img, '${f.url("photo")}', '${f.url("preview")} 80w, ${f.url("photo")} 160w'); });
 button('fixture-fail-image', () => { const img = new Image(); img.alt='单次备用图'; img.width=80; img.height=60; document.getElementById('fixture-new-images').append(img); assignMedia(img, '${f.url("fail")}'); });
 button('fixture-song', () => window.__fireflyMusic?.playTrackByIndex(1));
 button('fixture-video', () => document.getElementById('bg-next-btn')?.click());
 button('fixture-playing-error', () => { document.querySelectorAll('audio,video').forEach(element => { if (!element.paused) { element.pause(); element.dispatchEvent(new Event('error')); } }); });
 button('fixture-deny', () => fetch('/__fixture/deny',{method:'POST'}));
 button('fixture-allow', () => fetch('/__fixture/allow',{method:'POST'}));
 button('fixture-report', async () => { document.getElementById('fixture-report-output').textContent=JSON.stringify(await (await fetch('/__fixture/status')).json(),null,2); });
 activateDeferredImages();
}
bindFixture(); document.addEventListener('swup:content:replace',bindFixture);
</script>`,
	);

// Both sources stay live while building; only the trusted copied project is executed.
console.log(`Fixture root: ${root}`);
console.log(`R2: ${f.url("probe")} Tencent: ${f.url("probe", "tencent")}`);
await new Promise<void>((done, reject) => {
	const child = spawn(
		process.env.ComSpec || "cmd.exe",
		["/d", "/s", "/c", "corepack pnpm build"],
		{
			cwd: root,
			windowsHide: true,
			stdio: "inherit",
			env: {
				...process.env,
				ASTRO_TELEMETRY_DISABLED: "1",
				PUBLIC_DISPLAY_SETTINGS: "true",
			},
		},
	);
	child.on("error", reject);
	child.on("exit", (code) =>
		code === 0 ? done() : reject(new Error(`fixture build ${code}`)),
	);
});
const dist = join(root, "dist");
const types: Record<string, string> = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".avif": "image/avif",
	".woff2": "font/woff2",
	".ico": "image/x-icon",
};
const frontend = createServer(async (req, res) => {
	const path = new URL(req.url || "/", "http://localhost").pathname;
	if (path === "/__fixture/status") {
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({ state: { deny: f.state.deny }, requests: f.requests }),
		);
		return;
	}
	if (
		req.method === "POST" &&
		["/__fixture/deny", "/__fixture/allow"].includes(path)
	) {
		f.state.deny = path.endsWith("deny");
		f.state.failTencent.add("fail");
		res.end("ok");
		return;
	}
	const filename = resolve(
		dist,
		`.${decodeURIComponent(path)}`,
		path.endsWith("/") ? "index.html" : "",
	);
	if (!filename.startsWith(`${dist}\\`)) {
		res.writeHead(404);
		res.end();
		return;
	}
	try {
		const content = await readFile(filename);
		res.setHeader(
			"content-type",
			types[extname(filename)] || "application/octet-stream",
		);
		res.setHeader("cache-control", "no-store");
		res.setHeader("x-robots-tag", "noindex");
		res.end(content);
	} catch {
		res.writeHead(404);
		res.end();
	}
});
const { port } = await listenLocal(frontend);
console.log(`Stage8 frontend: http://127.0.0.1:${port}/route-fixture/`);
console.log(`Status: http://127.0.0.1:${port}/__fixture/status`);
