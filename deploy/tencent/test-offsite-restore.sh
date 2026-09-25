#!/usr/bin/env bash
# Download the newest R2 backup and restore it into a new isolated database.
set -euo pipefail
umask 077

app_dir=/opt/dcelysion
config="$app_dir/backup-r2.conf"
target="backup-r2:dcelysion-db-backups/database"
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ -f "$config" ]] || { echo 'Dedicated R2 backup credentials are missing.' >&2; exit 1; }

name=$(rclone --config "$config" lsf "$target" --files-only --include 'waline-*.dump' | sort | tail -n 1)
[[ "$name" =~ ^waline-[0-9]{8}T[0-9]{6}Z\.dump$ ]] || { echo 'No valid R2 backup found.' >&2; exit 1; }

scratch=$(mktemp -d "$app_dir/offsite-restore.XXXXXXXX")
trap 'rm -f -- "$scratch/backups/$name" "$scratch/backups/$name.sha256"; rmdir -- "$scratch/backups" "$scratch"' EXIT
install -d -m 0700 "$scratch/backups"
rclone --config "$config" copyto "$target/$name" "$scratch/backups/$name"
rclone --config "$config" copyto "$target/$name.sha256" "$scratch/backups/$name.sha256"
(cd "$scratch" && sha256sum --check "backups/$name.sha256")
cd "$app_dir"
docker compose exec -T postgres pg_restore --list < "$scratch/backups/$name" > /dev/null

database="waline_offsite_restore_$(date -u +%Y%m%dT%H%M%SZ)"
docker compose exec -T postgres createdb -U waline "$database"
docker compose exec -T postgres pg_restore -U waline -d "$database" --exit-on-error --no-owner < "$scratch/backups/$name"
counts=$(docker compose exec -T postgres psql -U waline -d "$database" -Atc "SELECT (SELECT count(*) FROM wl_comment), (SELECT count(*) FROM wl_counter), (SELECT count(*) FROM wl_users WHERE type='administrator')")
IFS='|' read -r comments counters admins <<< "$counts"
[[ "$comments" -ge 9 && "$counters" -ge 7 && "$admins" -ge 1 ]] || {
  echo "Restored database failed data checks: $database" >&2
  exit 1
}
fingerprint_sql="SELECT md5(COALESCE((SELECT json_agg(t ORDER BY id)::text FROM wl_comment t), '[]')), md5(COALESCE((SELECT json_agg(t ORDER BY id)::text FROM wl_counter t), '[]'))"
current_fingerprint=$(docker compose exec -T postgres psql -U waline -d waline -Atc "$fingerprint_sql")
restored_fingerprint=$(docker compose exec -T postgres psql -U waline -d "$database" -Atc "$fingerprint_sql")
[[ "$current_fingerprint" == "$restored_fingerprint" ]] || {
  echo 'Restored comments or counters differ from the current database; check for writes after the dump.' >&2
  exit 1
}
printf 'R2 backup %s restored into %s; comments=%s counters=%s administrators=%s\n' "$name" "$database" "$comments" "$counters" "$admins"
