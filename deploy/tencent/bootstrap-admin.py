#!/usr/bin/env python3
"""Create the first owner account over the private API; never print credentials."""
import json
import os
import secrets
import subprocess
import urllib.request
from pathlib import Path

if os.geteuid() != 0:
    raise SystemExit('Run with sudo.')
path = Path('/opt/dcelysion/admin-initial.json')
count = subprocess.run(
    ['docker', 'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'waline', '-d', 'waline',
     '-Atc', 'SELECT count(*) FROM wl_users'], cwd='/opt/dcelysion',
    capture_output=True, text=True, check=True,
).stdout.strip()

def request(route, data):
    req = urllib.request.Request('http://127.0.0.1:8360/api/' + route,
        data=json.dumps(data).encode(), headers={
            'Content-Type': 'application/json',
            'Origin': 'https://blog.dcelysion.cn',
            'Referer': 'https://blog.dcelysion.cn/',
        })
    with urllib.request.urlopen(req, timeout=30) as response:
        result = json.load(response)
    if result.get('errno') != 0:
        raise SystemExit('Owner account API failed: ' + route)
    return result.get('data')

if count == '0':
    if path.exists():
        credentials = json.loads(path.read_text())
    else:
        credentials = {'email': 'dcelysion@gmail.com', 'password': secrets.token_urlsafe(24),
                       'display_name': 'DcElysion', 'loginUrl': 'https://comments.dcelysion.cn/ui/login'}
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as output:
            json.dump(credentials, output, indent=2)
    request('user', {key: credentials[key] for key in ('email', 'password', 'display_name')})
elif count == '1' and path.exists():
    credentials = json.loads(path.read_text())
else:
    raise SystemExit('Existing users detected; refusing to alter accounts.')
data = request('token', {key: credentials[key] for key in ('email', 'password')})
if data.get('type') != 'administrator' or not data.get('token'):
    raise SystemExit('Owner login did not return an administrator session.')
print('Owner account created and administrator login verified. Initial credentials are in a root-only file; no email sent.')
