"""Initialize the newly provisioned instance over loopback. Never prints secrets."""
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request

ROOT = Path('/opt/dcelysion-umami')
assert ROOT.joinpath('OWNER').read_text().strip() == 'dcelysion-umami-20261004'
assert not ROOT.joinpath('dashboard.env').exists(), 'Already initialized'
secrets = json.loads(ROOT.joinpath('account-bootstrap.json').read_text())

def api(path, body=None, token=None, method=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request('http://127.0.0.1:18300/api' + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Upstream bodies may contain secrets: report only method, route and status.
        raise RuntimeError(f'{request.get_method()} {path}: HTTP {error.code}') from None

for attempt in range(60):
    try:
        api('/heartbeat')
        break
    except (OSError, RuntimeError):
        time.sleep(1)
else:
    raise RuntimeError('Umami heartbeat unavailable')
token = api('/auth/login', {'username': 'admin', 'password': 'umami'})['token']
api('/me/password', {'currentPassword': 'umami', 'newPassword': secrets['adminPassword']}, token)
token = api('/auth/login', {'username': 'admin', 'password': secrets['adminPassword']})['token']
team = api('/teams', {'name': 'DcElysion analytics'}, token)
if isinstance(team, list):
    team = team[0]
reader = api('/users', {'username': 'dashboard-reader', 'password': secrets['readerPassword'], 'role': 'view-only'}, token)
api('/teams/' + team['id'] + '/users', {'userId': reader['id'], 'role': 'team-view-only'}, token)
website = api('/websites', {'name': 'DcElysion', 'domain': 'blog.dcelysion.cn', 'teamId': team['id']}, token)
readerToken = api('/auth/login', {'username': 'dashboard-reader', 'password': secrets['readerPassword']})['token']
key = api('/me/api-keys', {'name': 'dcelysion-admin-dashboard'}, readerToken)['key']
env = f"ADMIN_UMAMI_SOURCE=self-hosted\nADMIN_UMAMI_ENDPOINT=https://stats.dcelysion.cn/api\nADMIN_UMAMI_WEBSITE_ID={website['id']}\nADMIN_UMAMI_API_KEY={key}\n"
fd = os.open(ROOT/'dashboard.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    output.write(env)
ROOT.joinpath('website.json').write_text(json.dumps({'websiteId': website['id'], 'teamId': team['id'], 'readerId': reader['id']}, indent=2))
os.chmod(ROOT/'website.json', 0o600)
try:
    api('/auth/login', {'username': 'admin', 'password': 'umami'})
except RuntimeError:
    pass
else:
    raise RuntimeError('Default password still accepted')
now = int(time.time() * 1000)
api('/websites/' + website['id'] + f'/stats?startAt={now-86400000}&endAt={now}', token=key)
for method, path, body in [
    ('POST', '/websites/' + website['id'], {'name': 'DcElysion', 'domain': 'blog.dcelysion.cn'}),
    ('GET', '/websites/00000000-0000-4000-8000-000000000001/stats?startAt=0&endAt=1', None),
]:
    try:
        api(path, body, key, method)
    except RuntimeError as error:
        assert 'HTTP 401' in str(error) or 'HTTP 403' in str(error), str(error)
    else:
        raise RuntimeError('Read-only isolation check failed')
print(json.dumps({'websiteId': website['id'], 'defaultPasswordRejected': True, 'readerWriteRejected': True, 'otherWebsiteRejected': True}))
