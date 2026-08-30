# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DcElysion is a feature-rich static blog theme built on **Astro 7** with **Svelte 5** for interactive components. It's a fork of [Fuwari](https://github.com/saicaca/fuwari) extended with extensive features. Primary language is Chinese (Simplified) with i18n for en, zh_TW, ja, ko, ru.

For detailed architecture, module boundaries, agent workflows, and verification rules, see `AGENTS.md` — it is the more detailed companion guide. Keep the two files in sync.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server at `localhost:4321` |
| `pnpm build` | Production build (GitHub card cache → LQIPs → VNDB covers → Astro build → pio asset pruning → font subsetting → inline script minification → Pagefind indexing → Sites entry generation) |
| `pnpm preview` | Preview production build |
| `pnpm check` | `astro check` for type/error checking |
| `pnpm type-check` | `tsc --noEmit --isolatedDeclarations` (covers `src/` and `scripts/`) |
| `pnpm lint` | Biome check + auto-fix (`--write` over `src/` and `scripts/`) |
| `pnpm format` | Biome format (`--write` over `src/` and `scripts/`) |
| `pnpm new-post <filename>` | Scaffold a new blog post |
| `pnpm new-dynamic` (`new-d`) | Scaffold a new dynamic (microblog) entry |
| `pnpm lqips` | Regenerate LQIP data into `src/constants/lqips.json` |
| `pnpm github-cards` | Regenerate cached GitHub card metadata in `src/constants/github-card-data.json` |

Package manager is **pnpm 11** (enforced and pinned in `package.json`); Node.js >= 22 is required. `pnpm-workspace.yaml` pins the local store and explicitly allows required dependency build scripts. Because that store lives inside the repository, keep `**/.pnpm-store/**` in Vite's watcher exclusions; scanning its tens of thousands of cache files severely delays Windows dev startup, and dependency changes require restarting the dev server. The Cloudflare adapter is dynamically imported only when `CF_WORKERS` is set so normal dev/static config loading does not initialize Wrangler/Miniflare.

## Architecture

### Astro + Svelte Hybrid

- `.astro` components for static content and layouts
- `.svelte` components for interactive UI (search, settings, pagination, archive) — mounted with `client:load` or `client:visible`
- Swup.js handles SPA-like page transitions with multiple container targets

### Configuration-Driven

All features are toggled/configured via TypeScript files in `src/config/`, exported through the barrel at `src/config/index.ts`. Key configs:

- `siteConfig.ts` — core site settings, theme, pagination
- `sidebarConfig.ts` — sidebar layout (left/right/both, widget ordering)
- `commentConfig.ts`, `analyticsConfig.ts`, `fontConfig.ts`, etc.

### Layout System

- `Layout.astro` — base HTML shell (head, body, theme init, analytics, Swup hooks)
- `MainGridLayout.astro` — full page grid with sidebar(s), navbar, wallpaper, footer

### Scroll Performance Constraints

Scroll-linked work in `src/utils/` is rAF-throttled and must stay cheap on mobile — do not regress these:

- `fullscreen-wallpaper-utils.ts` — fullscreen-mode title fade + blur ramp. The blur value `--fullscreen-blur` is **quantized to 2px steps** (skips writes when unchanged) and the max blur (`--overlay-blur`) is **cached** (read once; refreshed by a MutationObserver on `#wallpaper-wrapper` style). Avoid per-frame `getComputedStyle` or continuous full-screen `filter: blur()` writes — each change re-rasterizes the whole viewport on mobile.
- `grid-layout-utils.ts` — `updateSidebarStickySpacing()` is the per-scroll path and **must not read layout** (`offsetHeight` etc.). The sidebar top-container visibility (`hasVisibleTop`) is cached by `refreshSidebarStickyState()`, which runs on init/navigation only.
- Fullscreen blur ramp can be disabled per device via `backgroundWallpaper.fullscreen.blurRamp.enable.{desktop,mobile}` — when off, fullscreen mode has no blur on that device (home + other pages) and the settings-panel blur slider is hidden. Documented in `Firefly-Docs/` (zh/en).

### Content Collections

Defined in `src/content.config.ts`:
- `posts` — blog posts (`.md`/`.mdx`) with frontmatter: title, published, tags, category, draft, pinned, password, comment, etc.
- `spec` — special pages (about, friends, guestbook)
- `dynamic` — microblog entries (`.md`) with frontmatter: published, draft, pinned, location

### Key Directories

- `src/components/` — organized by domain: `analytics/`, `comment/`, `common/`, `controls/`, `features/`, `layout/`, `misc/`, `pages/`, `widget/`
- `src/plugins/` — 15 custom remark/rehype plugins (Mermaid, PlantUML, KaTeX, GitHub cards, reading time, wiki links, etc.)
- `src/i18n/` — translation keys in `i18nKey.ts`, language files in `languages/*.ts`, lookup via `translation.ts`
- `src/utils/` — content sorting, crypto (encrypted posts), date formatting, image processing/LQIP, TOC generation
- `src/pages/` — Astro file-based routing
- `scripts/` — build-time utilities (`generate-github-card-data.ts`, `generate-lqips.ts`, `generate-vndb-covers.ts`, `prune-pio-assets.ts`, `subset-fonts.ts`, `minify-inline-scripts.ts`, `prepare-sites-dist.ts`, `new-post.js`, `new-dynamic.js`)

### Path Aliases (tsconfig.json)

`@components/*`, `@assets/*`, `@constants/*`, `@utils/*`, `@i18n/*`, `@layouts/*` → `./src/<dir>/*`; `@/*` → `./src/*`

## Code Style

- **Biome** enforces: tab indentation, double quotes, recommended lint rules
- Relaxed rules for `.svelte`/`.astro`/`.vue` files (`useConst`, `useImportType`, `noUnusedVariables`, `noUnusedImports` off)
- `pnpm lint`/`pnpm format` run `biome check --write` / `biome format --write` over both `./src` and `./scripts`; for a scoped, read-only check prefer `pnpm exec biome check <file>` instead of rewriting unrelated files
- `scripts/subset-font.d.ts` is a hand-written ambient declaration for the untyped `subset-font` package
- Commit convention: **Conventional Commits** (`feat:`, `fix:`, `chore:`, etc.)

## User Preferences & Working Rules

- **Upstream sync defaults**: when syncing from upstream, any new, moved, or updated tutorial/guide/feature-demo posts must keep `draft: true` — even if upstream frontmatter omits `draft` or sets it to `false`. Make them public only when the user explicitly asks. The user's own posts are exempt.
- **Publishing dynamics (动态)**: prefer the repo-level `$publish-dynamic` skill (`.agents/skills/publish-dynamic/`). Preserve the user's wording exactly — no rewording, added emoji, or extra tags unless explicitly requested. Default to public, unpinned, no location; set `draft`/`pinned`/`location` only when asked.
- **Ask before committing/deploying**: after finishing work (e.g. publishing a dynamic), ask the user whether to commit, push, and deploy. Do not run Git or deployment actions until the user confirms.
- **Proactive doc sync**: when code, config, structure, or workflows change, update drifted docs (AGENTS.md, READMEs, `docs/` translations, `src/config/README.md`, `src/components/README.md`) in the same task without being reminded. If a translation can't be reliably updated, update the default-language doc and report which translations lag.
- **Minimal footprint**: run `git status --short` first and preserve existing user changes; only touch task-related files and avoid repo-wide reformatting. Never run `scripts/quarantine-bad-posts.mjs` unless explicitly asked.
- **Delivery notes**: report changed files, doc-sync status, behavior changes, verification results, and any untested areas. PRs stay single-purpose and include summary, verification commands, and known limitations; visual changes include desktop and mobile screenshots.

## Build Pipeline

Multi-step: `scripts/generate-github-card-data.ts` → `scripts/generate-lqips.ts` → `scripts/generate-vndb-covers.ts` → `astro build` → `scripts/prune-pio-assets.ts` → `scripts/subset-fonts.ts` → `scripts/minify-inline-scripts.ts` → `pagefind --site dist` → `scripts/prepare-sites-dist.ts`

GitHub card metadata is generated into `src/constants/github-card-data.json` and committed — regenerate with `pnpm github-cards`. Transient DNS, connection, timeout, HTTP 429, and 5xx failures are retried once before the existing cache fallback. LQIP data is generated into `src/constants/lqips.json` and committed — regenerate with `pnpm lqips`. Icon data lives in `src/constants/icons-data.json` (committed, Biome-ignored, consumed by `src/components/common/Icon.svelte`) but has no generator script in the current build.

`generate-vndb-covers.ts` downloads VNDB cover art into `public/vndb-covers/` (gitignored, skips files that already exist). It no-ops unless `siteConfig.vndb` has a `userId`, `downloadCovers: true`, and `mode: "static"`.

`prune-pio-assets.ts` deletes unused 看板娘 assets from `dist/` after the Astro build (Astro copies all of `public/` regardless of config). It drops `dist/pio/models/live2d` plus the orphaned `Live2DWidget` client chunk when `live2dWidgetConfig.enable` is false, `dist/pio/models/spine` and `dist/pio/static` when `spineModelConfig.enable` is false, and all of `dist/pio` when both are off (~15 MiB). While Live2D is disabled, Vite's chunk warning limit is 700 KiB for this known intermediate orphan; enabling it restores the default 500 KiB limit. The pruning script no-ops when both models are enabled.

`prepare-sites-dist.ts` runs last and generates `dist/server/index.js`, the entry for OpenAI Sites to serve the static output via an `ASSETS` binding.

## Deployment

- **Vercel** (default, `vercel.json`)
- **Cloudflare Workers** (`wrangler.jsonc`, set `CF_WORKERS` env var)
- Static output to `dist/`
- Music is served from the `dcelysion-music` R2 bucket through `music.dcelysion.cn`; responsive wallpaper videos use `dcelysion-wallpapers` through `wallpapers.dcelysion.cn`; gallery images use content-hashed keys in `dcelysion-gallery` through `gallery.dcelysion.cn`. Keep `public/assets/music/`, `public/assets/videos/`, and `public/gallery/` as local source/rollback copies. The committed `public/.assetsignore` excludes the media files from Workers Static Assets but must preserve generated `dist/gallery/**/index.html` routes. When a site origin changes, update all three buckets' exact CORS allowlists and verify audio/video Range playback plus gallery MIME, length, and browser rendering.
