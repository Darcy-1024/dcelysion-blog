#!/bin/sh
set -eu
python3 /opt/read-input.py
mkdir /work/node_modules
# Dependencies stay immutable; Astro/Vite caches belong to this job's tmpfs.
for dependency in /opt/blog/node_modules/* /opt/blog/node_modules/.[!.]*; do
  test -e "$dependency" || continue
  name=${dependency##*/}
  case "$name" in .vite|.astro|.vite-temp) continue ;; esac
  ln -s "$dependency" "/work/node_modules/$name"
done
cd /work
# Resolve child CLIs (Pagefind) from the pinned, read-only dependency tree.
export PATH="/opt/blog/node_modules/.bin:$PATH"
# Existing cached source assets are exported from Git. Network generation is omitted.
# Astro still uses the project's actual MDX / Remark / Rehype configuration.
(
  node /opt/blog/node_modules/astro/bin/astro.mjs build
  node /opt/blog/node_modules/tsx/dist/cli.mjs scripts/prune-pio-assets.ts
  node /opt/blog/node_modules/tsx/dist/cli.mjs scripts/subset-fonts.ts
  node /opt/blog/node_modules/tsx/dist/cli.mjs scripts/minify-inline-scripts.ts
  node /opt/blog/node_modules/tsx/dist/cli.mjs scripts/run-pagefind.ts
) >&2
# Only a bounded archive leaves the container. There is no writable host mount.
exec tar -czf - -C dist .
