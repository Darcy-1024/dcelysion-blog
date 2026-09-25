#!/usr/bin/env bash
# One-time isolated restore test. Refuses to overwrite an existing test database.
set -euo pipefail
umask 077
cd /opt/dcelysion
dump=$(find backups -maxdepth 1 -type f -name 'waline-*.dump' | sort | tail -n 1)
test -n "$dump"
sha256sum --check "$dump.sha256"
docker compose exec -T postgres createdb -U waline waline_restore_check
docker compose exec -T postgres pg_restore -U waline -d waline_restore_check --exit-on-error --no-owner < "$dump"
python3 /home/ubuntu/dcelysion-deploy/verify-import.py waline_restore_check /opt/dcelysion/migration-source
test "$(docker compose exec -T postgres psql -U waline -d waline_restore_check -Atc "SELECT count(*) FROM wl_users WHERE type='administrator'")" = 1
printf '%s\n' 'Backup restored successfully into an isolated database; historical data and administrator account verified.'
