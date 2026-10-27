#!/usr/bin/env bash
# Run with sudo after uploading this directory. Does not open public listeners.
set -euo pipefail
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
version=0.34.2
asset_version=0.34.2-dc1
expected=fb745bd9bd983a6170877861f701752304b1534b835fe72b9db12c36999c627f
asset_dir=/srv/dcelysion/admin-assets/$asset_version
install -d -m 0755 "$asset_dir"
asset_tmp=$(mktemp "$asset_dir/.admin.js.XXXXXX")
patched_tmp=$(mktemp "$asset_dir/.admin-patched.js.XXXXXX")
trap 'rm -f -- "$asset_tmp" "$patched_tmp"' EXIT
curl --fail --location --retry 3 --connect-timeout 15 --max-time 180 "https://unpkg.com/@waline/admin@$version/dist/admin.js" -o "$asset_tmp"
printf '%s  %s\n' "$expected" "$asset_tmp" | sha256sum --check
python3 "$source_dir/patch-waline-admin.py" "$asset_tmp" "$patched_tmp"
chmod 0644 "$patched_tmp"
if [[ -e "$asset_dir/admin.js" ]]; then
    if ! cmp -s -- "$patched_tmp" "$asset_dir/admin.js"; then
        printf 'Refusing to replace immutable admin asset: %s\n' "$asset_dir/admin.js" >&2
        exit 1
    fi
else
    # Hard-link creation fails if another installer creates the path first.
    ln -- "$patched_tmp" "$asset_dir/admin.js"
fi
install -m 0644 "$source_dir/show-password.js" /srv/dcelysion/admin-assets/show-password-v2.js
install -m 0644 "$source_dir/avatar-upload-v1.js" /srv/dcelysion/admin-assets/avatar-upload-v1.js
bash "$source_dir/install-waline-brand.sh"
backup_dir=/opt/dcelysion/config-backups/admin-assets-$(date -u +%Y%m%dT%H%M%S)-$$
install -d -m 0700 "$backup_dir"
cp /opt/dcelysion/compose.yaml "$backup_dir/compose.yaml"
cp /etc/nginx/sites-available/dcelysion-comments-private "$backup_dir/nginx-comments-private.conf"
install -m 0644 "$source_dir/nginx-comments-private.conf" /etc/nginx/sites-available/dcelysion-comments-private
if ! nginx -t; then
    cp "$backup_dir/nginx-comments-private.conf" /etc/nginx/sites-available/dcelysion-comments-private
    exit 1
fi
systemctl reload nginx
install -m 0644 "$source_dir/compose.yaml" /opt/dcelysion/compose.yaml
cd /opt/dcelysion
if ! docker compose config --quiet; then
    cp "$backup_dir/compose.yaml" compose.yaml
    exit 1
fi
docker compose up -d --no-deps waline
printf 'Installed admin asset %s; config rollback directory: %s\n' "$asset_version" "$backup_dir"
