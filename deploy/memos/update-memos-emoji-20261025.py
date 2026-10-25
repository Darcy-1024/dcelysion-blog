#!/usr/bin/env python3
"""UI-only sealed release upgrade; preserves backend and retains rollback."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path('/opt/dcelysion-admin-stage2')
RELEASE = ROOT/'releases/20261025-memos-emoji'
STATE = ROOT/'operator/memos-emoji-20261025'
NAME = 'dc-admin-formal'
PREVIOUS = NAME+'-before-memos-emoji-20261025'
PATCH = '547325543da9fb609dfd0629c59e44d1f27b1af65cedfa5b8078feaa32e71957'
BASE_BUNDLE_SHA = '70f651b5b2aad47c30987317570cafb6f3499f6678ba3bbbd69796723dda2e2d'

def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def docker(*args):
    return run(['docker', *args])


def save(path, data):
    path.write_text(json.dumps(data, indent=2))
    path.chmod(0o600)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def status(url, host):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'Host': host}), timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def attach(name, networks):
    for network, config in networks.items():
        args = ['network', 'connect', '--ip', config['IPAddress']]
        for alias in config.get('Aliases') or []:
            args += ['--alias', alias]
        docker(*args, network, name)


def detach(name, networks):
    attached = json.loads(docker('inspect', name))[0]['NetworkSettings']['Networks']
    for network in networks:
        if network in attached:
            docker('network', 'disconnect', network, name)


def ui_entries(directory):
    assert directory.is_dir() and not directory.is_symlink(), 'UI_DIRECTORY'
    manifest = json.loads((directory/'frontend-manifest.json').read_text())
    assert manifest['schema'] == 1 and manifest['upstreamCommit'] == '2b2192d4e153bd04f1d325b60fd880cf00d68b01'
    assert len(manifest['patchSHA256']) == 64
    known = {'frontend-manifest.json'}
    for entry in manifest['entries']:
        name = entry['path']
        assert name not in known and name and not name.startswith('/') and all(part not in ('', '.', '..') for part in name.split('/'))
        known.add(name)
        file = directory/name
        assert file.is_file() and not file.is_symlink() and file.stat().st_size == entry['bytes'] and sha(file) == entry['sha256']
    actual = set()
    for file in directory.rglob('*'):
        assert not file.is_symlink(), 'UI_LINK_REFUSED'
        if file.is_file(): actual.add(file.relative_to(directory).as_posix())
    assert actual == known and 'index.html' in known, 'UI_MANIFEST_COVERAGE'
    return manifest


def release_entries(manifest):
    known = {'manifest.json'}
    for entry in manifest['entries']:
        name = entry['path']
        assert name not in known and name and not name.startswith('/') and all(part not in ('', '.', '..') for part in name.split('/'))
        assert not any(part.startswith('.') or part in ('runtime.env', 'pat', 'author.json') for part in name.split('/'))
        known.add(name)
        file = RELEASE/name
        assert file.is_file() and not file.is_symlink() and file.stat().st_size == entry['bytes'] and sha(file) == entry['sha256'], 'RELEASE_MANIFEST_MISMATCH'
    actual = set()
    for file in RELEASE.rglob('*'):
        assert not file.is_symlink(), 'RELEASE_LINK_REFUSED'
        if file.is_file(): actual.add(file.relative_to(RELEASE).as_posix())
    assert actual == known, 'RELEASE_MANIFEST_COVERAGE'


def execute(ui, loader):
    os.umask(0o077)
    assert os.geteuid() == 0
    assert not RELEASE.exists() and not STATE.exists(), 'UPGRADE_EXISTS'
    frontend = ui_entries(ui)
    assert frontend['patchSHA256'] == PATCH
    assert sha(ui/'frontend-manifest.json') == '589bc7be08820c173f9137c344e2d62034cef219fb2e616b6c08f7d4543b8c3b'
    old = json.loads(docker('inspect', NAME))[0]
    host, config, networks = old['HostConfig'], old['Config'], old['NetworkSettings']['Networks']
    assert old['State']['Running'] and not host['PortBindings']
    assert set(networks) == {'dcelysion_database', 'dc-memos-private'}
    assert host['ReadonlyRootfs'] and host['CapDrop'] == ['ALL'] and config['User'] == '1000:1000'
    backend = Path(next(m['Source'] for m in old['Mounts'] if m['Destination'] == '/app/backend'))
    assert backend == ROOT/'releases/20261023-memos-assets'
    assert sha(backend/'admin/server/index.mjs') == BASE_BUNDLE_SHA
    assert 'ADMIN_MEMOS_FRONTEND_DIRECTORY=/app/backend/memos-ui' in config['Env']
    assert subprocess.run(['docker', 'inspect', PREVIOUS], capture_output=True).returncode != 0
    runtime_hash = sha(ROOT/'runtime.env')
    assert sha(loader) == 'df2615004fcf96dcde837049aeb6922d762f0070fb5db7b2e24b44c703fb090e'
    run(['sudo', '-u', 'dc-builder', 'docker', '--host', 'unix:///run/user/1002/docker.sock',
         'run', '--rm', '--user', '0:0', '--network', 'none', '--cap-drop', 'ALL',
         '--security-opt', 'no-new-privileges', '--mount', 'type=bind,source='+str(ui)+',target=/ui,readonly',
         '--mount', 'type=bind,source='+str(loader)+',target=/loader.ts,readonly',
         '--entrypoint', 'node', 'sha256:7d80192eb45362b46bc601b7ef5243cb772ae456f8a48b8d3fa034c4de8c9210',
         '--experimental-transform-types', '--input-type=module', '-e', "import {MemosFrontend} from '/loader.ts'; const ui=await MemosFrontend.load('/ui'); if(!ui.index().bytes.length)throw Error('empty');"])
    STATE.mkdir(mode=0o700)
    save(STATE/'previous-inspect.json', old)
    shutil.copytree(backend, RELEASE)
    shutil.rmtree(RELEASE/'memos-ui')
    shutil.copytree(ui, RELEASE/'memos-ui')
    manifest = json.loads((RELEASE/'manifest.json').read_text())
    manifest['entries'] = [e for e in manifest['entries'] if not e['path'].startswith('memos-ui/')]
    for file in sorted((RELEASE/'memos-ui').rglob('*')):
        if file.is_file():
            manifest['entries'].append({'path': file.relative_to(RELEASE).as_posix(), 'bytes': file.stat().st_size, 'sha256': sha(file)})
    manifest['emojiUpdate20261025'] = {'previousRelease': str(backend), 'patchSHA256': PATCH,
        'frontendManifestSHA256': sha(RELEASE/'memos-ui/frontend-manifest.json'), 'backendUnchanged': True}
    (RELEASE/'manifest.json').write_text(json.dumps(manifest, indent=2))
    for item in [RELEASE, *RELEASE.rglob('*')]:
        item.chmod(0o755 if item.is_dir() else 0o644)
    release_entries(manifest)
    assert sha(RELEASE/'admin/server/index.mjs') == BASE_BUNDLE_SHA
    envfile = STATE/'runtime.exact.env'
    assert all('\n' not in value and '\r' not in value for value in config['Env'])
    envfile.write_text('\n'.join(config['Env'])+'\n')
    envfile.chmod(0o600)
    candidate = NAME+'-candidate-emoji-20261025'
    args = ['create', '--name', candidate, '--restart', host['RestartPolicy']['Name'], '--network', 'none',
            '--user', config['User'], '--workdir', config['WorkingDir'], '--read-only', '--memory', str(host['Memory']),
            '--memory-swap', str(host['MemorySwap']), '--cpus', str(host['NanoCpus']/1e9), '--pids-limit', str(host['PidsLimit']),
            '--env-file', str(envfile)]
    for key, flag in [('CapDrop', '--cap-drop'), ('CapAdd', '--cap-add'), ('SecurityOpt', '--security-opt')]:
        for value in host.get(key) or []: args += [flag, value]
    for key, value in (host.get('Tmpfs') or {}).items(): args += ['--tmpfs', key+':'+value]
    for key, value in (config.get('Labels') or {}).items(): args += ['--label', key+'='+value]
    for mount in old['Mounts']:
        assert mount['Type'] == 'bind'
        source = str(RELEASE) if mount['Destination'] == '/app/backend' else mount['Source']
        args += ['--mount', 'type=bind,source='+source+',target='+mount['Destination']+(',readonly' if not mount['RW'] else '')]
    ep = config.get('Entrypoint') or []
    assert len(ep) <= 1
    if ep: args += ['--entrypoint', ep[0]]
    args += [old['Image'], *(config.get('Cmd') or [])]
    docker(*args)
    candidate_inspect = json.loads(docker('inspect', candidate))[0]
    assert candidate_inspect['Config']['Env'] == config['Env']
    assert candidate_inspect['Image'] == old['Image']
    for key in ['ReadonlyRootfs', 'CapDrop', 'CapAdd', 'SecurityOpt', 'Tmpfs', 'Memory', 'MemorySwap', 'NanoCpus', 'PidsLimit', 'RestartPolicy']:
        assert candidate_inspect['HostConfig'].get(key) == host.get(key), 'CANDIDATE_HOST_CONFIG_MISMATCH'
    for key in ['Entrypoint', 'Cmd', 'User', 'WorkingDir']:
        assert candidate_inspect['Config'].get(key) == config.get(key), 'CANDIDATE_CONFIG_MISMATCH'
    expected_mounts = {
        mount['Destination']: (str(RELEASE) if mount['Destination'] == '/app/backend' else mount['Source'], mount['RW'])
        for mount in old['Mounts']
    }
    actual_mounts = {mount['Destination']: (mount['Source'], mount['RW']) for mount in candidate_inspect['Mounts']}
    assert actual_mounts == expected_mounts, 'CANDIDATE_MOUNT_MISMATCH'
    switched = False
    renamed = False
    try:
        docker('stop', '--time', '60', NAME)
        docker('rename', NAME, PREVIOUS)
        renamed = True
        detach(PREVIOUS, networks)
        docker('rename', candidate, NAME)
        switched = True
        docker('network', 'disconnect', 'none', NAME)
        attach(NAME, networks)
        docker('start', NAME)
        ip = networks['dcelysion_database']['IPAddress']
        for _ in range(30):
            try:
                if status('http://'+ip+':4322/api/memos', 'admin.dcelysion.cn') == 401: break
            except Exception: pass
            time.sleep(1)
        else: raise RuntimeError('ADMIN_ANONYMOUS_CHECK')
        gateway = status('http://'+ip+':4324/', 'memos.dcelysion.cn')
        assert gateway == 401, 'GATEWAY_ANONYMOUS_CHECK'
        assert status('http://'+ip+':4322/', 'admin.dcelysion.cn') == 200, 'LOGIN_ENTRY_HEALTH'
        asset = next(e['path'] for e in frontend['entries'] if e['path'].endswith('.js'))
        for pathname in ('/api/v1/memos', '/'+asset, '/index.html'):
            assert status('http://'+ip+':4324'+pathname, 'memos.dcelysion.cn') == 401
        release_entries(manifest)
        assert sha(RELEASE/'admin/server/index.mjs') == BASE_BUNDLE_SHA
        actual = json.loads(docker('inspect', NAME))[0]
        assert actual['State']['Running'] and actual['Image'] == old['Image']
        assert set(actual['NetworkSettings']['Networks']) == set(networks)
        assert actual['Config']['Env'] == config['Env']
        assert sha(ROOT/'runtime.env') == runtime_hash
        result = {'ok': True, 'release': str(RELEASE), 'previousContainer': PREVIOUS,
                  'patchSHA256': PATCH, 'uiManifestSHA256': sha(RELEASE/'memos-ui/frontend-manifest.json'), 'backendUnchanged': True, 'loginEntry': 200, 'apiAssetIndexAnonymous': 401, 'bundleSHA256': sha(RELEASE/'admin/server/index.mjs'),
                  'adminAnonymous': 401, 'gatewayAnonymous': gateway, 'runtimeEnvUnchanged': True}
        save(STATE/'result.json', result)
        print(json.dumps(result))
    except BaseException:
        if switched:
            subprocess.run(['docker', 'stop', '--time', '20', NAME], capture_output=True)
            detach(NAME, networks)
            docker('rename', NAME, NAME+'-failed-emoji-20261025')
        if renamed:
            detach(PREVIOUS, networks)
            docker('rename', PREVIOUS, NAME)
            attach(NAME, networks)
            docker('start', NAME)
        save(STATE/'result.json', {'ok': False, 'rollback': True})
        raise RuntimeError('UPGRADE_FAILED_ROLLED_BACK') from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--ui', required=True, type=Path)
    parser.add_argument('--loader', required=True, type=Path)
    args = parser.parse_args()
    try: execute(args.ui.resolve(), args.loader.resolve())
    except Exception as error:
        print(json.dumps({'ok': False, 'errorType': type(error).__name__}))
        raise SystemExit(1)
