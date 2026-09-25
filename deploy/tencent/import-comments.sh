#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/dcelysion
source_dir=/home/ubuntu/dcelysion-migration
python3 /home/ubuntu/dcelysion-deploy/check-migration-package.py "$source_dir"
./backup.sh
docker compose exec -T postgres psql -U waline -d waline -v ON_ERROR_STOP=1 < "$source_dir/migration.sql" > /dev/null
python3 /home/ubuntu/dcelysion-deploy/verify-import.py waline "$source_dir"
install -d -m 0700 /opt/dcelysion/migration-source
install -m 0600 "$source_dir/manifest.json" "$source_dir/migration.sql" "$source_dir/twikoo-comment.json" "$source_dir/twikoo-counter.json" /opt/dcelysion/migration-source/
./backup.sh
