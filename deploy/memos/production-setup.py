#!/usr/bin/env python3
"""Authorized formal Memos setup. Secrets are generated/stored only on the host."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path('/opt/dcelysion-memos')
BACKUPS = Path('/opt/dcelysion-memos-backups')
BASE = 'http://127.0.0.1:5231'
os.umask(0o077)
assert os.geteuid() == 0


def run(*args, **kwargs):
    return subprocess.run(list(args), check=True, **kwargs)


def save(name, value, uid=0):
    target = ROOT / name
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    target.write_text(json.dumps(value, indent=2))
    target.chmod(0o600)
    os.chown(target, uid, uid)


def api(route, body=None, token=None, method=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(BASE + route, data=json.dumps(body).encode() if body is not None else None,
                                     headers=headers, method=method or ('POST' if body is not None else 'GET'))
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


action = sys.argv[1]
if action == 'install':
    source = Path(sys.argv[2]).resolve()
    assert not ROOT.exists(), 'Existing Memos directory: inspect instead of overwriting'
    ROOT.mkdir(mode=0o700)
    (ROOT/'OWNER').write_text('dcelysion-memos-production-20261020\n')
    BACKUPS.mkdir(exist_ok=True, mode=0o700)
    (ROOT/'data').mkdir(mode=0o700)
    os.chown(ROOT/'data', 10001, 10001)
    for name in ['compose.yaml', 'compose.bridge.yaml']:
        shutil.copyfile(source/name, ROOT/name)
    os.chdir(ROOT)
    run('docker', 'compose', '-f', 'compose.yaml', '-f', 'compose.bridge.yaml', 'config', '--quiet')
    run('docker', 'compose', '-f', 'compose.yaml', '-f', 'compose.bridge.yaml', 'pull')
    run('docker', 'compose', '-f', 'compose.yaml', '-f', 'compose.bridge.yaml', 'up', '-d')
    for attempt in range(30):
        try:
            profile = api('/api/v1/instance/profile')
            break
        except (OSError, ValueError):
            time.sleep(1)
    else:
        raise RuntimeError('Memos did not become healthy')
    assert profile.get('version') == '0.31.0'
    container = json.loads(subprocess.check_output(['docker', 'inspect', 'dcelysion-memos-memos-1']))[0]
    save('installed.json', {'version': profile['version'], 'image': container['Image'],
                           'ports': container['HostConfig']['PortBindings'],
                           'networks': list(container['NetworkSettings']['Networks'])})
    print(json.dumps({'status': 'installed', 'version': profile['version'], 'image': container['Image']}))
elif action == 'resume-install':
    assert (ROOT/'OWNER').read_text().strip() == 'dcelysion-memos-production-20261020'
    assert not (ROOT/'initialized.json').exists()
    # Registry transport fallback; content remains pinned to the identical OCI digest.
    image = 'mirror.ccs.tencentyun.com/neosmemo/memos:0.31.0@sha256:24c2707ddd8fbd2ceaa7a61ecab86a53cdcde640b24ce572b73da14b00b5785f'
    run('docker', 'image', 'inspect', image, stdout=subprocess.DEVNULL)
    compose = ROOT/'compose.yaml'
    compose.write_text(compose.read_text().replace('image: neosmemo/memos:', 'image: mirror.ccs.tencentyun.com/neosmemo/memos:'))
    os.chdir(ROOT)
    run('docker', 'compose', '-f', 'compose.yaml', '-f', 'compose.bridge.yaml', 'up', '-d', '--pull', 'never')
    for attempt in range(30):
        try:
            profile = api('/api/v1/instance/profile')
            break
        except (OSError, ValueError):
            time.sleep(1)
    else:
        raise RuntimeError('Memos did not become healthy')
    assert profile['version'] == '0.31.0'
    container = json.loads(subprocess.check_output(['docker', 'inspect', 'dcelysion-memos-memos-1']))[0]
    save('installed.json', {'version': profile['version'], 'image': container['Image'], 'registry': 'tencent-mirror-same-oci-digest', 'ports': container['HostConfig']['PortBindings']})
    print(json.dumps({'status': 'installed', 'version': profile['version'], 'image': container['Image']}))
elif action in ('connect-origin', 'refresh-origin'):
    assert (ROOT/'OWNER').read_text().strip() == 'dcelysion-memos-production-20261020'
    container = json.loads(subprocess.check_output(['docker', 'inspect', 'dcelysion-memos-memos-1']))[0]
    labels = container['Config']['Labels']
    assert labels['com.docker.compose.project'] == 'dcelysion-memos'
    assert labels['com.docker.compose.service'] == 'memos'
    assert container['State']['Running']
    assert container['Config']['Image'].endswith('@sha256:24c2707ddd8fbd2ceaa7a61ecab86a53cdcde640b24ce572b73da14b00b5785f')
    assert set(container['NetworkSettings']['Networks']) == {'dc-memos-private'}
    assert json.loads(subprocess.check_output(['docker', 'network', 'inspect', 'dc-memos-private']))[0]['Internal']
    address = container['NetworkSettings']['Networks']['dc-memos-private']['IPAddress']
    assert address.startswith('172.')
    config = Path('/etc/nginx/sites-available/dcelysion-memos-origin')
    enabled = Path('/etc/nginx/sites-enabled/dcelysion-memos-origin')
    if action == 'connect-origin':
        assert not config.exists() and not enabled.exists()
    else:
        assert enabled.is_symlink() and enabled.resolve() == config
        assert 'listen 127.0.0.1:5231;' in config.read_text()
    # Docker internal networks suppress published ports. Keep that isolation and
    # expose the raw origin ONLY to host operators/synchronizer on loopback.
    config.write_text('server {\n    listen 127.0.0.1:5231;\n    server_name 127.0.0.1 localhost;\n    access_log off;\n    error_log /var/log/nginx/dc-memos-origin-error.log crit;\n    client_max_body_size 32m;\n    location / {\n        proxy_pass http://'+address+':5230;\n        proxy_set_header Host localhost;\n        proxy_request_buffering off;\n    }\n}\n')
    if not enabled.is_symlink():
        enabled.symlink_to(config)
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')
    for attempt in range(15):
        try:
            profile = api('/api/v1/instance/profile')
            break
        except (OSError, ValueError):
            time.sleep(1)
    else:
        raise RuntimeError('Origin refresh health check failed')
    assert profile['version'] == '0.31.0'
    save('installed.json', {'version': profile['version'], 'commit': profile['commit'], 'image': container['Image'], 'origin': BASE, 'privateContainerIP': address})
    print(json.dumps({'status': 'private-origin-ready', 'version': profile['version'], 'commit': profile['commit']}))
elif action == 'initialize':
    assert (ROOT/'OWNER').read_text().strip() == 'dcelysion-memos-production-20261020'
    assert not (ROOT/'author.json').exists(), 'Do not overwrite existing identity'
    profile = api('/api/v1/instance/profile')
    assert profile.get('needsSetup') is True
    operator = {'username': 'memos-operator', 'password': secrets.token_urlsafe(36)}
    save('operator.json', operator)
    admin = api('/api/v1/users', {**operator, 'role': 'ADMIN', 'state': 'NORMAL', 'displayName': 'Memos operator'})
    save('operator.json', {**operator, 'expectedUser': admin['name']})
    login = api('/api/v1/auth/signin', {'passwordCredentials': operator})
    bearer = login['accessToken']
    author = {'username': 'dcelysion', 'password': secrets.token_urlsafe(36)}
    user = api('/api/v1/users', {**author, 'role': 'USER', 'state': 'NORMAL', 'displayName': 'DcElysion'}, bearer)
    assert user['role'] == 'USER'
    save('author.json', {**author, 'expectedUser': user['name']}, uid=1000)
    for key, body in [
        ('GENERAL', {'generalSetting': {'disallowUserRegistration': True}}),
        ('ACCESS', {'accessSetting': {'accessMode': 'INSTANCE_ACCESS_MODE_PRIVATE'}}),
    ]:
        api('/api/v1/instance/settings/'+key, {'name': 'instance/settings/'+key, **body}, bearer, 'PATCH')
    author_login = api('/api/v1/auth/signin', {'passwordCredentials': author})
    pat = api('/api/v1/'+user['name']+'/personalAccessTokens',
              {'description': 'DcElysion public dynamic synchronizer', 'expiresInDays': 365}, author_login['accessToken'])
    (ROOT/'sync').mkdir(mode=0o700)
    (ROOT/'sync/pat').write_text(pat['token'])
    (ROOT/'sync/pat').chmod(0o600)
    proof = {'author': user['name'], 'role': user['role'],
             'general': api('/api/v1/instance/settings/GENERAL', token=bearer),
             'access': api('/api/v1/instance/settings/ACCESS', token=bearer)}
    save('initialized.json', proof)
    print(json.dumps({'status': 'initialized', 'author': user['name'], 'role': user['role'], 'registrationClosed': True, 'instance': 'PRIVATE'}))
elif action == 'backup':
    assert (ROOT/'OWNER').read_text().strip() == 'dcelysion-memos-production-20261020'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = BACKUPS/('memos-'+stamp+'.tar.gz')
    assert not target.exists()
    os.chdir(ROOT)
    compose = ['docker','compose','-f','compose.yaml','-f','compose.bridge.yaml']
    run(*compose, 'stop', '-t', '60', 'memos')
    try:
        run('tar', '-czf', str(target), '-C', '/opt', 'dcelysion-memos')
        listing = subprocess.check_output(['tar','-tzf',str(target)], text=True)
        assert 'dcelysion-memos/data/' in listing and 'dcelysion-memos/author.json' in listing
        sha = hashlib.sha256(target.read_bytes()).hexdigest()
        target.with_suffix('.tar.gz.sha256').write_text(sha+'  '+target.name+'\n')
    finally:
        run(*compose, 'start', 'memos')
    print(json.dumps({'backup': str(target), 'sha256': sha, 'readable': True, 'destructiveRestore': False}))
else:
    raise ValueError('Unknown action')
