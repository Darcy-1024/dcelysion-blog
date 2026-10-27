#!/usr/bin/env bash
# Assets only: does not reload nginx, rebuild containers or change routing.
set -euo pipefail
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
asset_dir=/srv/dcelysion/admin-assets/brand-v3
install -d -m 0755 "$asset_dir"
for file in theme.css wordmark.png wordmark-dark.png favicon.png; do
    source_file="$source_dir/waline-brand-v3/$file"
    if [[ -f "$asset_dir/$file" ]]; then
        cmp "$source_file" "$asset_dir/$file" || {
            echo "Immutable asset differs: $file; use a new version path." >&2
            exit 1
        }
    else
        install -m 0644 "$source_file" "$asset_dir/$file"
    fi
done
