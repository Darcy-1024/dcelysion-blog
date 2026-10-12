#!/usr/bin/env python3
"""Root-only formal admin snapshot. Never restore or delete existing data."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile

os.umask(0o077)
root = Path('/opt/dcelysion-admin-stage2')
assert os.geteuid() == 0
assert (root / 'OWNER').read_text().strip() == 'dcelysion-admin-stage2-20261011'
with (root / 'backup.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output = root / 'backups' / stamp
    output.mkdir(mode=0o700)
    for db in ['dc_admin', 'waline']:
        dump = output / (db + '.dump')
        with dump.open('xb') as stream:
            subprocess.run(['docker', 'exec', 'dcelysion-postgres-1', 'pg_dump',
                            '-U', 'waline', '-Fc', db], check=True, stdout=stream)
            stream.flush()
            os.fsync(stream.fileno())
        with dump.open('rb') as stream:
            subprocess.run(['docker', 'exec', '-i', 'dcelysion-postgres-1',
                            'pg_restore', '--list'], check=True, stdin=stream,
                           stdout=subprocess.DEVNULL)
    # Includes private originals/journal and operator configuration. Keep 0700/0600.
    # This archive never enters the public release package or admin download API.
    with tarfile.open(output / 'private-state.tar.gz', 'w:gz') as archive:
        for name in ['OWNER', 'media-private', 'media-public', 'runtime.env',
                     'operator', 'prepared.json', 'deployed.json']:
            archive.add(root / name, arcname=name, recursive=True)
    files = {}
    for path in output.iterdir():
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        files[path.name] = {'bytes': path.stat().st_size, 'sha256': digest.hexdigest()}
    (output / 'manifest.json').write_text(json.dumps({'utc': stamp, 'files': files}, indent=2))
    print(json.dumps({'backup': str(output), 'archivesReadable': True, 'files': files}))
