#!/usr/bin/env python3
"""Verify every migrated object through private Nginx; never print object keys."""
import json
import urllib.parse
import urllib.request
from pathlib import Path

manifest = Path(Path('/opt/dcelysion/media-manifests/latest').read_text().strip())
total = 0
for name in ('music', 'wallpapers', 'gallery'):
    rows = json.loads((manifest / (name + '-after.json')).read_text())
    checked = 0
    range_checked = False
    for row in rows:
        if row['IsDir']:
            continue
        url = 'http://127.0.0.1:8081/' + urllib.parse.quote(row['Path'], safe='/')
        headers = {'Host': name + '.dcelysion.cn', 'Origin': 'https://blog.dcelysion.cn'}
        req = urllib.request.Request(url, method='HEAD', headers=headers)
        with urllib.request.urlopen(req, timeout=20) as response:
            if response.status != 200 or int(response.headers['Content-Length']) != row['Size']:
                raise SystemExit('Media response size mismatch in ' + name)
            if response.headers.get('Access-Control-Allow-Origin') != '*':
                raise SystemExit('Media CORS header missing in ' + name)
            mime = row.get('MimeType')
            if mime and mime.startswith(('image/', 'audio/', 'video/')) and response.headers.get_content_type() != mime:
                raise SystemExit('Media MIME mismatch in ' + name + ': expected ' + mime + ', received ' + response.headers.get_content_type() + ', extension ' + Path(row['Path']).suffix)
        checked += 1
        if not range_checked and row['Size'] >= 32:
            req = urllib.request.Request(url, headers={**headers, 'Range': 'bytes=0-31'})
            with urllib.request.urlopen(req, timeout=20) as response:
                body = response.read()
                if response.status != 206 or response.headers.get('Content-Range') != 'bytes 0-31/' + str(row['Size']):
                    raise SystemExit('Range response mismatch in ' + name)
            with (Path('/srv/dcelysion/media') / name / row['Path']).open('rb') as source:
                if body != source.read(32):
                    raise SystemExit('Range content mismatch in ' + name)
            range_checked = True
    if not range_checked:
        raise SystemExit('No range request exercised in ' + name)
    total += checked
    print(f'{name}: {checked} HTTP objects checked; MIME, CORS and HTTP 206 verified.')
print(f'Media HTTP validation complete: {total} objects.')
