#!/bin/sh
set -eu
halt() {
  systemctl stop dc-memos-publish.timer
  python3 - <<'PY'
import json, os
from pathlib import Path
target = Path('/var/lib/dcelysion-memos-publisher/runtime-halted.json')
if not target.exists():
    target.write_text(json.dumps({'status': 'halted', 'reason': 'host-runtime-failed'}))
    target.chmod(0o600)
    os.chown(target, 1000, 1000)
PY
}
# ExecStopPost also runs when the origin identity preflight fails.
if [ "${1:-}" = --service-stop ]; then
  if [ "${SERVICE_RESULT:-success}" != success ]; then
    /usr/bin/docker rm -f dcelysion-memos-publisher >/dev/null 2>&1 || true
    halt
  fi
  exit 0
fi
# Host flock stays held until both public deployments have been observed.
exec 9>/var/lib/dcelysion-memos-publisher/cycle.lock
flock -n 9 || exit 0
if ! /usr/bin/timeout --foreground --kill-after=30s 30m /usr/bin/docker run --rm --name dcelysion-memos-publisher \
  --network host --user 1000:1000 --read-only --cap-drop ALL \
  --security-opt no-new-privileges --memory 384m --memory-swap 512m --cpus 0.5 \
  --pids-limit 96 --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  -e HOME=/private -e TZ=Asia/Shanghai -e GIT_TERMINAL_PROMPT=0 \
  -v /opt/dcelysion-memos-publisher-tools:/tools:ro \
  -v /srv/dcelysion-memos-publisher/checkout:/checkout:rw \
  -v /var/lib/dcelysion-memos-publisher:/private:rw \
  dcelysion/memos-publisher:20261020 --config /private/config.json --execute; then
  /usr/bin/docker rm -f dcelysion-memos-publisher >/dev/null 2>&1 || true
  halt
  exit 1
fi
