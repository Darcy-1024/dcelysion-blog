---
name: publish-dynamic
description: Create and publish Firefly blog dynamics from user text and optional image attachments. Use when the user asks to 发动态、发布动态、新增动态, invokes $publish-dynamic, or wants a moment added under src/content/dynamic with image conversion, build verification, and an explicit confirmation before Git push or deployment.
---

# Publish Dynamic

Publish one Firefly dynamic while preserving the user's wording and unrelated workspace changes.

## Prepare

1. Read the repository `AGENTS.md` and run `git status --short` before editing.
2. Treat user-provided text as final copy. Do not rewrite it, add emoji, or add metadata unless requested.
3. Accept optional `location`, `pinned`, and `draft` values. Default to public, unpinned, and no location.
4. Use `siteConfig.timezone` for the publication timestamp and filename. Fall back to `Asia/Shanghai` only when the config is unavailable.

## Create the dynamic

1. Create `src/content/dynamic/YYYY-MM-DD-HHmmss.md` without overwriting an existing file.
2. Use this frontmatter shape, omitting optional fields that were not requested:

```yaml
---
published: YYYY-MM-DD HH:mm:ss
draft: false
pinned: true
location: Example
---
```

3. Put the exact user text after the frontmatter.
4. Append image references in the requested order, or attachment order when none is specified:

```markdown
![Concise image description](./images/semantic-name.avif)
```

## Process attachments

1. Never modify or delete the original attachments.
2. Inspect each source image before conversion. Preserve orientation, color profile, dimensions, and visible content; do not crop or resize unless requested.
3. Convert raster attachments to AVIF with a visually high-quality setting around quality 80. Use semantic, collision-free lowercase filenames under `src/content/dynamic/images/`.
4. When a HEIC contains tiles, auxiliary images, or malformed trailing metadata, extract and verify the primary visible still with an available HEIF-capable decoder before encoding AVIF. Do not use image generation to recreate an attachment.
5. If conversion would silently discard meaningful animation, transparency, or other requested content, stop and explain the tradeoff before proceeding.

## Verify

1. Run the complete `pnpm build` for any new or changed image. If the environment prevents a build step, report the exact unverified step and reason.
2. Check that `src/constants/lqips.json` contains only the expected new image entries.
3. Inspect `dist/api/dynamic.json` and confirm the new entry returns each local image as an accessible `/_astro/` URL rather than `./images/...`.
4. Confirm every returned asset exists under `dist/` and matches the expected format and dimensions.
5. Run `git diff --check` and review `git status --short`. Do not absorb unrelated changes into this task.

## Hand off and deploy

1. Summarize the dynamic file, image files, generated LQIP change, and verification results.
2. Always ask: `是否现在提交、推送并触发部署？`
3. Do not stage, commit, push, or deploy until the user explicitly confirms after this question.
4. After confirmation, stage only task-scoped files, use a Conventional Commit, push the current branch, and verify the configured deployment trigger or deployment result. Stop and report any missing credentials or required approval.
