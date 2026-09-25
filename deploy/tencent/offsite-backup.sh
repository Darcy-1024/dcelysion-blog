#!/usr/bin/env bash
# Upload every verified database dump to a private R2 bucket and read it back.
set -euo pipefail
umask 077

app_dir=/opt/dcelysion
config="$app_dir/backup-r2.conf"
target="backup-r2:dcelysion-db-backups/database"

[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ -f "$config" ]] || { echo 'Dedicated R2 backup credentials are missing.' >&2; exit 1; }
[[ $(stat -c %a "$config") == 600 ]] || { echo 'R2 backup credentials must have mode 0600.' >&2; exit 1; }

exec 9>"$app_dir/offsite-backup.lock"
flock -n 9 || { echo 'An offsite backup is already running.' >&2; exit 1; }

shopt -s nullglob
dumps=("$app_dir"/backups/waline-*.dump)
((${#dumps[@]})) || { echo 'No database dumps found.' >&2; exit 1; }

for dump in "${dumps[@]}"; do
  checksum="$dump.sha256"
  [[ -f "$checksum" ]] || { echo "Missing checksum for $(basename "$dump")." >&2; exit 1; }
  (cd "$app_dir" && sha256sum --check --status "backups/$(basename "$checksum")")

  name=$(basename "$dump")
  expected=$(sha256sum "$dump")
  expected=${expected%% *}
  rclone --config "$config" copyto --immutable "$dump" "$target/$name"
  rclone --config "$config" copyto --immutable "$checksum" "$target/$name.sha256"
  actual=$(rclone --config "$config" cat "$target/$name" | sha256sum)
  actual=${actual%% *}
  [[ "$actual" == "$expected" ]] || { echo "Remote checksum mismatch: $name" >&2; exit 1; }
  cmp -s "$checksum" <(rclone --config "$config" cat "$target/$name.sha256") || {
    echo "Remote checksum file mismatch: $name" >&2
    exit 1
  }
  printf 'Offsite backup verified: %s\n' "$name"
done
