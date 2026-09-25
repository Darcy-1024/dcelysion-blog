#!/usr/bin/env python3
"""Restore only known smoke-test counters before handing over private preview."""
import json
import subprocess
from pathlib import Path

rows = json.loads(Path('/opt/dcelysion/migration-source/twikoo-counter.json').read_text())
original = {row['url']: row for row in rows}
tested = ('/guestbook', '/dynamic/browser-smoke/', '/dynamic/2026-09-15-224800/')
statements = ['BEGIN;', "SET LOCAL TIME ZONE 'UTC';"]
for url in tested:
    literal = "'" + url.replace("'", "''") + "'"
    if url in original:
        row = original[url]
        statements.append(f"UPDATE wl_counter SET time={int(row['time'])}, updatedat=to_timestamp({int(row['updated'])}/1000.0)::timestamp(0) WHERE url={literal};")
    else:
        statements.append(f'DELETE FROM wl_counter WHERE url={literal};')
statements.append('COMMIT;')
subprocess.run(['docker', 'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'waline',
                '-d', 'waline', '-v', 'ON_ERROR_STOP=1'], cwd='/opt/dcelysion',
               input='\n'.join(statements), text=True, check=True, stdout=subprocess.DEVNULL)
print('Known browser-test pageview changes restored to the export baseline; comments untouched.')
