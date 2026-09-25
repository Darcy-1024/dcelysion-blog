#!/usr/bin/env bash
# Creates a consistent database dump. Copy this directory off the server separately.
set -euo pipefail
umask 077
app_dir=/opt/dcelysion
cd "$app_dir"
install -d -m 0700 backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump="backups/waline-$stamp.dump"
if [[ -e "$dump" || -e "$dump.partial" ]]; then
  echo 'A backup already exists for this timestamp; refusing to overwrite.' >&2
  exit 1
fi
docker compose exec -T postgres pg_dump -U waline -d waline -Fc > "$dump.partial"
docker compose exec -T postgres pg_restore --list < "$dump.partial" > /dev/null
mv -- "$dump.partial" "$dump"
sha256sum "$dump" > "$dump.sha256"
printf 'Database backup verified: %s/%s\n' "$app_dir" "$dump"
