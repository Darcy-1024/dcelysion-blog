#!/usr/bin/env bash
# Copies source objects without modifying or deleting R2 data.
set -euo pipefail
umask 022
exec 9>/opt/dcelysion/media-transfer.lock
flock -n 9 || { echo 'Media transfer already running.' >&2; exit 1; }
config=/opt/dcelysion/rclone.conf
run_dir=/opt/dcelysion/media-manifests/$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$run_dir"
for name in music wallpapers gallery; do
    source="r2:dcelysion-$name"
    target="/srv/dcelysion/media/$name"
    install -d -m 0755 "$target"
    rclone --config "$config" lsjson "$source" --recursive --hash > "$run_dir/$name-before.json"
    rclone --config "$config" copy "$source" "$target" --checksum --transfers 4 --checkers 8 --stats 30s --stats-one-line
    rclone --config "$config" check "$source" "$target" --download --checkers 4 > "$run_dir/$name-check.log" 2>&1
    rclone --config "$config" lsjson "$source" --recursive --hash > "$run_dir/$name-after.json"
    python3 - "$run_dir" "$name" <<'PY'
import json, sys
from pathlib import Path
base, name = Path(sys.argv[1]), sys.argv[2]
before = json.loads((base / (name + '-before.json')).read_text())
after = json.loads((base / (name + '-after.json')).read_text())
def state(rows):
    return sorted((r['Path'], r['Size'], r['ModTime'], tuple(sorted(r.get('Hashes', {}).items()))) for r in rows if not r['IsDir'])
if state(before) != state(after):
    raise SystemExit('Source changed during migration: ' + name)
files = [r for r in after if not r['IsDir']]
print(f'{name}: verified {len(files)} files, {sum(r["Size"] for r in files)} bytes; source unchanged.')
PY
    (cd "$target" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum) > "$run_dir/$name-sha256.txt"
done
printf '%s\n' "$run_dir" > /opt/dcelysion/media-manifests/latest
printf 'Media migration verified. Manifests: %s\n' "$run_dir"
