#!/usr/bin/env python3
"""Strict streamed input extraction; works on bookworm Python 3.11 without extractall."""
import sys
import tarfile
from pathlib import Path

root = Path('/work')
seen = set()
total = count = 0
with tarfile.open(fileobj=sys.stdin.buffer, mode='r|') as archive:
    for item in archive:
        count += 1
        total += item.size
        name = item.name.removeprefix('./').rstrip('/')
        if item.isdir() and name in ('', '.'):
            continue
        parts = name.split('/')
        if (count > 30000 or total > 512 * 1024 * 1024 or item.size < 0
                or not (item.isfile() or item.isdir()) or name in seen
                or any(p in ('', '.', '..', '.git', 'node_modules', 'admin', 'private-db')
                       or p.startswith('.env') or p.endswith(('.', ' ')) for p in parts)
                or any(c in name for c in '\\:\x00%?#')):
            raise ValueError('BUILD_INPUT_INVALID')
        seen.add(name)
        target = root.joinpath(*parts)
        if item.isdir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                source = archive.extractfile(item)
                remaining = item.size
                while remaining:
                    block = source.read(min(remaining, 65536))
                    if not block:
                        raise ValueError('BUILD_INPUT_TRUNCATED')
                    output.write(block)
                    remaining -= len(block)
