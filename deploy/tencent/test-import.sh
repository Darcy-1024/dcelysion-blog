#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/dcelysion
source_dir=/home/ubuntu/dcelysion-migration
docker compose exec -T postgres createdb -U waline waline_migration_check
docker compose exec -T postgres psql -U waline -d waline_migration_check -v ON_ERROR_STOP=1 < vendor/waline.pgsql > /dev/null
docker compose exec -T postgres psql -U waline -d waline_migration_check -v ON_ERROR_STOP=1 < "$source_dir/migration.sql" > /dev/null
python3 /home/ubuntu/dcelysion-deploy/verify-import.py waline_migration_check "$source_dir"
if docker compose exec -T postgres psql -U waline -d waline_migration_check -v ON_ERROR_STOP=1 < "$source_dir/migration.sql" > /dev/null 2> "$source_dir/reimport-check.log"; then
    echo 'Duplicate import guard failed.' >&2
    exit 1
fi
grep -q 'Waline comment/counter tables must both be empty' "$source_dir/reimport-check.log"
printf '%s\n' 'Duplicate import guard verified. Test database retained for review.'
