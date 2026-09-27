#!/usr/bin/env bash
# Run only after the target server deployment is authorized. Keeps listeners private.
set -euo pipefail
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
app_dir=/opt/dcelysion
nginx_target=/etc/nginx/sites-available/dcelysion-comments-private
backup_dir="$app_dir/config-backups/nickname-login-$(date -u +%Y%m%dT%H%M%S)-$$"

[[ $(id -u) == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
for file in 002_unique_login_nickname.sql show-password.js nginx-comments-private.conf; do
  [[ -f "$source_dir/$file" ]] || { echo "Missing $file" >&2; exit 1; }
done
[[ -d "$source_dir/waline-overlay/src" ]] || { echo 'Missing Waline overlay' >&2; exit 1; }

install -d -m 0700 "$backup_dir"
cp "$nginx_target" "$backup_dir/nginx-comments-private.conf"
"$app_dir/backup.sh"
install -d -m 0755 "$app_dir/waline-overlay/src"
cp -a "$source_dir/waline-overlay/src/." "$app_dir/waline-overlay/src/"
cd "$app_dir"
docker compose config --quiet
docker compose build waline
# PostgreSQL rejects any existing duplicate and rolls the index change back.
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U waline -d waline \
  < "$source_dir/002_unique_login_nickname.sql"
docker compose up -d --no-deps waline
curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
  --retry 15 --retry-all-errors --retry-delay 1 \
  http://127.0.0.1:8360/ui/login > /dev/null

install -m 0644 "$source_dir/show-password.js" /srv/dcelysion/admin-assets/show-password-v2.js
install -m 0644 "$source_dir/nginx-comments-private.conf" "$nginx_target"
if ! nginx -t; then
  cp "$backup_dir/nginx-comments-private.conf" "$nginx_target"
  exit 1
fi
systemctl reload nginx
printf 'Nickname login installed. Config backup: %s\n' "$backup_dir"
