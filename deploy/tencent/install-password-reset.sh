#!/usr/bin/env bash
# Run only after explicitly authorized for the target server. Keeps listeners private.
set -euo pipefail
umask 077
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
app_dir=/opt/dcelysion
asset_dir=/srv/dcelysion/admin-assets/reset-v1
nginx_target=/etc/nginx/sites-available/dcelysion-comments-private
backup_dir="$app_dir/config-backups/password-reset-$(date -u +%Y%m%dT%H%M%S)-$$"

[[ $(id -u) == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
for file in .dockerignore Dockerfile.waline-reset compose.yaml nginx-comments-private.conf \
  password-reset/package.json password-reset/package-lock.json \
  password-reset/service.js password-reset/001_password_reset.sql \
  password-reset/ui/forgot.html password-reset/ui/reset-password.html \
  password-reset/ui/reset.js password-reset/ui/reset.css; do
  [[ -f "$source_dir/$file" ]] || { echo "Missing $file" >&2; exit 1; }
done
[[ -d "$source_dir/waline-overlay/src" ]] || { echo 'Missing Waline overlay' >&2; exit 1; }

install -d -m 0700 "$backup_dir"
cp "$app_dir/compose.yaml" "$backup_dir/compose.yaml"
cp "$nginx_target" "$backup_dir/nginx-comments-private.conf"
"$app_dir/backup.sh"

# Versioned assets are immutable. Repeating the installer is safe only if
# contents match byte for byte.
install -d -m 0755 "$asset_dir"
for file in forgot.html reset-password.html reset.js reset.css; do
  if [[ -f "$asset_dir/$file" ]]; then
    cmp "$source_dir/password-reset/ui/$file" "$asset_dir/$file" || {
      echo "Versioned asset changed: $file" >&2; exit 1;
    }
  else
    install -m 0644 "$source_dir/password-reset/ui/$file" "$asset_dir/$file"
  fi
done

install -m 0644 "$source_dir/Dockerfile.waline-reset" "$app_dir/Dockerfile.waline-reset"
install -m 0644 "$source_dir/.dockerignore" "$app_dir/.dockerignore"
install -d -m 0755 "$app_dir/waline-overlay/src" "$app_dir/password-reset"
cp -a "$source_dir/waline-overlay/src/." "$app_dir/waline-overlay/src/"
install -m 0644 "$source_dir/password-reset/package.json" "$app_dir/password-reset/package.json"
install -m 0644 "$source_dir/password-reset/package-lock.json" "$app_dir/password-reset/package-lock.json"
install -m 0644 "$source_dir/password-reset/service.js" "$app_dir/password-reset/service.js"
install -m 0644 "$source_dir/compose.yaml" "$app_dir/compose.yaml"
cd "$app_dir"
docker compose config --quiet
docker compose build waline

# Close the legacy route before the migration and service restart. A failed
# later step leaves this Nginx guard in place for the still-running old image.
install -m 0644 "$source_dir/nginx-comments-private.conf" "$nginx_target"
if ! nginx -t; then
  cp "$backup_dir/nginx-comments-private.conf" "$nginx_target"
  exit 1
fi
systemctl reload nginx

docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U waline -d waline \
  < "$source_dir/password-reset/001_password_reset.sql"
docker compose up -d --no-deps waline password-reset

# Compose started does not mean Waline has finished binding its HTTP listener.
curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
  --retry 15 --retry-all-errors --retry-delay 1 \
  http://127.0.0.1:8360/ui/login > /dev/null


legacy_status=$(curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}' \
  -X PUT -H 'content-type: application/json' -H 'Origin: http://127.0.0.1' \
  -d '{"email":"invalid@example.invalid"}' \
  http://127.0.0.1:8360/api/user/password)
[[ "$legacy_status" == 410 ]] || { echo "Legacy reset route is not closed: HTTP $legacy_status" >&2; exit 1; }
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8361/ui/forgot > /dev/null
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8361/ui/reset-password > /dev/null
status=$(curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}' \
  -H 'content-type: application/json' -d '{"token":"invalid","password":"abcdefghijkl"}' \
  http://127.0.0.1:8362/api/password-reset/confirm)
[[ "$status" == 400 ]] || { echo "Reset service check failed: HTTP $status" >&2; exit 1; }
printf 'Reset installed. Config backup: %s. Verify private preview before any public change.\n' "$backup_dir"
