#!/usr/bin/env python3
"""Verify a private migration package before any database operation."""
import hashlib
import hmac
import json
import re
import sys
from pathlib import Path

FILES = ('twikoo-comment.json', 'twikoo-counter.json', 'migration.sql')

def fail(message):
    raise SystemExit('Migration package check failed: ' + message)

def check(directory):
    manifest_path = directory / 'manifest.json'
    if manifest_path.is_symlink() or not manifest_path.is_file():
        fail('manifest.json is missing or is a symbolic link; regenerate the package.')
    try:
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, json.JSONDecodeError):
        fail('manifest.json cannot be read; regenerate the package.')
    if not isinstance(manifest, dict) or manifest.get('packageVersion') != 1:
        fail('legacy or unsupported package format; regenerate from the original exports.')
    digests = manifest.get('files')
    if not isinstance(digests, dict) or set(digests) != set(FILES):
        fail('file digest list is incomplete; regenerate the package.')
    for name in FILES:
        expected = digests[name]
        if not isinstance(expected, str) or not re.fullmatch(r'[0-9a-f]{64}', expected):
            fail(name + ' has an invalid SHA-256 digest.')
        path = directory / name
        if path.is_symlink() or not path.is_file():
            fail(name + ' is missing or is a symbolic link.')
        digest = hashlib.sha256()
        with path.open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
        if not hmac.compare_digest(digest.hexdigest(), expected):
            fail(name + ' does not match its SHA-256 digest.')
    print('Migration package SHA-256 checks passed.')

if __name__ == '__main__':
    if len(sys.argv) != 2:
        fail('usage: check-migration-package.py <directory>')
    check(Path(sys.argv[1]))
