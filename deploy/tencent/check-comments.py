#!/usr/bin/env python3
"""Exercise historical reads and anonymous validation without creating comments."""
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

source = json.loads(Path('/opt/dcelysion/migration-source/twikoo-comment.json').read_text())
base = 'http://127.0.0.1:8360/api/comment'
headers = {'Content-Type': 'application/json', 'Origin': 'https://blog.dcelysion.cn',
           'Referer': 'https://blog.dcelysion.cn/'}
rendered = 0
for path in sorted(set(row['url'] for row in source)):
    req = urllib.request.Request(base + '?' + urllib.parse.urlencode({'path': path, 'pageSize': 100}), headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        result = json.load(response)
    if result.get('errno') != 0:
        raise SystemExit('Comment read API failed.')
    expected = {str(i + 1): row['comment'].strip() for i, row in enumerate(source) if row['url'] == path and not row['isSpam']}
    actual = result['data']['data']
    if len(actual) != len(expected):
        raise SystemExit('Visible comment count mismatch.')
    for row in actual:
        if row['comment'].strip() != expected[str(row['objectId'])]:
            raise SystemExit('Historical comment rendering differs; inspect privately before release.')
        rendered += 1
req = urllib.request.Request(base, data=json.dumps({'url': '/__deployment_probe__'}).encode(), headers=headers)
try:
    with urllib.request.urlopen(req, timeout=30) as response:
        result = json.load(response)
except urllib.error.HTTPError as error:
    if error.code not in (400, 422):
        raise SystemExit('Unexpected anonymous validation response: ' + str(error.code))
    result = json.load(error)
if not result.get('errno') or 'comment' not in json.dumps(result):
    raise SystemExit('Missing comment must reach field validation without creating data.')
print(f'API verified: {rendered} historical comments render unchanged; anonymous requests reach field validation without creating data.')
