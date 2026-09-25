#!/usr/bin/env bash
# Run with sudo after uploading this directory. Does not open public listeners.
set -euo pipefail
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
version=0.34.2
expected=fb745bd9bd983a6170877861f701752304b1534b835fe72b9db12c36999c627f
asset_dir=/srv/dcelysion/admin-assets/$version
install -d -m 0755 "$asset_dir"
asset_tmp=$(mktemp "$asset_dir/.admin.js.XXXXXX")
trap 'rm -f -- "$asset_tmp"' EXIT
curl --fail --location --retry 3 --connect-timeout 15 --max-time 180 "https://unpkg.com/@waline/admin@$version/dist/admin.js" -o "$asset_tmp"
printf '%s  %s\n' "$expected" "$asset_tmp" | sha256sum --check
chmod 0644 "$asset_tmp"
mv -f -- "$asset_tmp" "$asset_dir/admin.js"
install -m 0644 "$source_dir/show-password.js" /srv/dcelysion/admin-assets/show-password-v1.js
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
printf 'Installed admin asset %s; config rollback directory: %s\n' "$version" "$backup_dir"
