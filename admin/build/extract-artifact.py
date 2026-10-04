#!/usr/bin/env python3
"""Validate untrusted container output before extracting into a fresh directory."""
import sys
import tarfile
from pathlib import Path

archive, output = map(Path, sys.argv[1:])
with tarfile.open(archive) as package:
    members = package.getmembers()
    if len(members) > 30000 or sum(item.size for item in members) > 512 * 1024 * 1024:
        raise ValueError('ARTIFACT_LIMIT')
    seen = set()
    for item in members:
        path = Path(item.name)
        if not (item.isfile() or item.isdir()) or path.is_absolute() or '..' in path.parts or '\\' in item.name or ':' in item.name:
            raise ValueError('ARTIFACT_PATH')
        if any(part.startswith('.env') or part in ('.git', 'admin', 'private-db') for part in path.parts):
            raise ValueError('ARTIFACT_PATH')
        if item.isfile():
            if path.as_posix() in seen:
                raise ValueError('ARTIFACT_DUPLICATE')
            seen.add(path.as_posix())
    package.extractall(output, filter='data')
