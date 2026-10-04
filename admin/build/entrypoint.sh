#!/bin/sh
set -eu
python3 /opt/read-input.py
ln -s /opt/blog/node_modules /work/node_modules
cd /work
# Existing cached source assets are exported from Git. Network generation is omitted.
# Astro still uses the project's actual MDX / Remark / Rehype configuration.
(
  node /opt/blog/node_modules/astro/astro.js build
  node /opt/blog/node_modules/tsx/dist/cli.mjs scripts/prune-pio-assets.ts
  node /opt/blog/node_modules/tsx/dist/cli.mjs scripts/subset-fonts.ts
  node /opt/blog/node_modules/tsx/dist/cli.mjs scripts/minify-inline-scripts.ts
  node /opt/blog/node_modules/tsx/dist/cli.mjs scripts/run-pagefind.ts
) >&2
# Only a bounded archive leaves the container. There is no writable host mount.
exec tar -czf - -C dist .
