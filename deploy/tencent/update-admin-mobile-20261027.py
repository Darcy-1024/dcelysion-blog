#!/usr/bin/env python3
"""Operator-only admin/dist upgrade. --ui-sha256 is ui-manifest.json SHA-256.

Manifest: {"schema":1,"entries":[{"path":"index.html","bytes":123,"sha256":"..."}, ...]}.
The directory must contain exactly the listed regular files plus ui-manifest.json.
No deployment occurs on import. Run as root on the provisioned Linux host.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path('/opt/dcelysion-admin-stage2')
RELEASE = ROOT/'releases/20261027-admin-mobile'
STATE = ROOT/'operator/admin-mobile-20261027'
NAME = 'dc-admin-formal'
PREVIOUS = NAME+'-before-admin-mobile-20261027'
CANDIDATE = NAME+'-candidate-admin-mobile-20261027'
FAILED = NAME+'-failed-admin-mobile-20261027'


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def docker(*args):
    return run(['docker', *args])


def inspect(name):
    return json.loads(docker('inspect', name))[0]


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2)+'\n')
    path.chmod(0o600)


def inventory(directory):
    require(directory.is_dir() and not directory.is_symlink(), 'DIRECTORY_TYPE')
    result = {}
    for path in directory.rglob('*'):
        require(not path.is_symlink(), 'SYMLINK_REFUSED')
        if path.is_dir():
            continue
        require(path.is_file(), 'SPECIAL_FILE_REFUSED')
        name = path.relative_to(directory).as_posix()
        result[name] = {'path': name, 'bytes': path.stat().st_size, 'sha256': sha(path)}
    return result


def entry_map(entries):
    require(isinstance(entries, list), 'MANIFEST_ENTRIES')
    result = {}
    for entry in entries:
        name = entry.get('path')
        require(isinstance(name, str) and name and '\\' not in name and not any(ord(c) < 32 for c in name), 'MANIFEST_PATH')
        parts = name.split('/')
        require(not PurePosixPath(name).is_absolute() and all(p not in ('', '.', '..') for p in parts), 'MANIFEST_PATH')
        require(not any(p.startswith('.') or p in ('runtime.env', 'pat', 'author.json') for p in parts), 'PRIVATE_PATH')
        require(name not in result and isinstance(entry.get('bytes'), int) and entry['bytes'] >= 0, 'MANIFEST_ENTRY')
        require(isinstance(entry.get('sha256'), str) and re.fullmatch('[a-f0-9]{64}', entry['sha256']), 'MANIFEST_DIGEST')
        result[name] = {'path': name, 'bytes': entry['bytes'], 'sha256': entry['sha256']}
    return result


def verify_ui(ui, expected):
    require(re.fullmatch('[a-f0-9]{64}', expected) is not None, 'INPUT_DIGEST')
    actual = inventory(ui)
    require('ui-manifest.json' in actual and sha(ui/'ui-manifest.json') == expected, 'INPUT_MANIFEST_DIGEST')
    manifest = json.loads((ui/'ui-manifest.json').read_text())
    require(manifest.get('schema') == 1, 'UI_SCHEMA')
    entries = entry_map(manifest.get('entries'))
    require('ui-manifest.json' not in entries, 'UI_MANIFEST_SELF')
    actual.pop('ui-manifest.json')
    require(actual == entries and 'index.html' in entries and entries['index.html']['bytes'] > 0, 'UI_FILES')
    require(any(p.startswith('assets/') and p.endswith('.js') for p in entries), 'UI_JS_MISSING')
    return entries


def verify_release(directory):
    actual = inventory(directory)
    manifest = json.loads((directory/'manifest.json').read_text())
    actual.pop('manifest.json')
    require(actual == entry_map(manifest.get('entries')), 'RELEASE_FILES')
    return manifest, actual


def request(ip, port, path, host):
    req = urllib.request.Request('http://'+ip+':'+str(port)+path, headers={'Host': host})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, b''


def detach(name, networks):
    attached = inspect(name)['NetworkSettings']['Networks']
    for network in networks:
        if network in attached:
            docker('network', 'disconnect', network, name)


def attach(name, networks):
    for network, config in networks.items():
        args = ['network', 'connect', '--ip', config['IPAddress']]
        if config.get('GlobalIPv6Address'):
            args += ['--ip6', config['GlobalIPv6Address']]
        for alias in config.get('Aliases') or []:
            args += ['--alias', alias]
        docker(*args, network, name)


def expected_mounts(old):
    return {m['Destination']: (str(RELEASE) if m['Destination'] == '/app/backend' else m['Source'], m['RW'], m.get('Propagation')) for m in old['Mounts']}


def verify_container(actual, old):
    require(actual['Image'] == old['Image'], 'IMAGE_CHANGED')
    for key in ('Env', 'Entrypoint', 'Cmd', 'User', 'WorkingDir', 'Labels'):
        require(actual['Config'].get(key) == old['Config'].get(key), 'CONFIG_CHANGED_'+key)
    for key in ('ReadonlyRootfs', 'CapDrop', 'CapAdd', 'SecurityOpt', 'Tmpfs', 'Memory', 'MemorySwap', 'NanoCpus', 'PidsLimit', 'RestartPolicy'):
        require(actual['HostConfig'].get(key) == old['HostConfig'].get(key), 'HOST_CHANGED_'+key)
    require(not actual['HostConfig']['PortBindings'], 'PUBLIC_PORTS')
    mounts = {m['Destination']: (m['Source'], m['RW'], m.get('Propagation')) for m in actual['Mounts']}
    require(mounts == expected_mounts(old), 'MOUNTS_CHANGED')


def execute(ui, expected):
    os.umask(0o077)
    require(os.geteuid() == 0, 'ROOT_REQUIRED')
    entries = verify_ui(ui, expected)
    require(not any(p.exists() or p.is_symlink() for p in (RELEASE, STATE)), 'OUTPUT_EXISTS')
    for name in (PREVIOUS, CANDIDATE, FAILED):
        require(subprocess.run(['docker', 'inspect', name], capture_output=True).returncode != 0, 'CONTAINER_EXISTS')
    old = inspect(NAME)
    host, config, networks = old['HostConfig'], old['Config'], old['NetworkSettings']['Networks']
    require(old['State']['Running'] and not host['PortBindings'], 'ACTIVE_CONTAINER')
    require(set(networks) == {'dcelysion_database', 'dc-memos-private'}, 'NETWORK_SET')
    require(host['ReadonlyRootfs'] and host['CapDrop'] == ['ALL'] and config['User'] == '1000:1000', 'SECURITY_BASELINE')
    require(all(m['Type'] == 'bind' and ',' not in m['Source'] and ',' not in m['Destination'] for m in old['Mounts']), 'MOUNT_TYPE')
    backend_mounts = [m for m in old['Mounts'] if m['Destination'] == '/app/backend']
    require(len(backend_mounts) == 1 and not backend_mounts[0]['RW'], 'BACKEND_MOUNT')
    backend = Path(backend_mounts[0]['Source'])
    require(not backend.is_symlink() and backend.resolve().parent == (ROOT/'releases').resolve(), 'BACKEND_LOCATION')
    manifest, before = verify_release(backend)
    require('admin/server/index.mjs' in before and any(p.startswith('memos-ui/') for p in before), 'BACKEND_INCOMPLETE')
    runtime_hash = sha(ROOT/'runtime.env')
    STATE.mkdir(mode=0o700)
    save(STATE/'previous-inspect.json', old)
    shutil.copytree(backend, RELEASE)
    shutil.rmtree(RELEASE/'admin/dist')
    shutil.copytree(ui, RELEASE/'admin/dist')
    (RELEASE/'admin/dist/ui-manifest.json').unlink()
    after = inventory(RELEASE)
    unchanged = {p: e for p, e in before.items() if not p.startswith('admin/dist/')}
    require({p: e for p, e in after.items() if p != 'manifest.json' and not p.startswith('admin/dist/')} == unchanged, 'OTHER_FILES_CHANGED')
    for name, entry in entries.items():
        require(after.get('admin/dist/'+name) == dict(entry, path='admin/dist/'+name), 'COPIED_UI_CHANGED')
    manifest['entries'] = [after[p] for p in sorted(after) if p != 'manifest.json']
    manifest['adminMobile20261027'] = {'previousRelease': str(backend), 'uiManifestSHA256': expected, 'backendUnchanged': True}
    (RELEASE/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    for path in [RELEASE, *RELEASE.rglob('*')]:
        path.chmod(0o755 if path.is_dir() else 0o644)
    verify_release(RELEASE)
    require(all('\n' not in v and '\r' not in v for v in config['Env']), 'ENV_NEWLINE')
    envfile = STATE/'runtime.exact.env'
    envfile.write_text('\n'.join(config['Env'])+'\n')
    envfile.chmod(0o600)
    args = ['create', '--name', CANDIDATE, '--restart', host['RestartPolicy']['Name'], '--network', 'none', '--user', config['User'], '--workdir', config['WorkingDir'], '--read-only', '--memory', str(host['Memory']), '--memory-swap', str(host['MemorySwap']), '--cpus', str(host['NanoCpus']/1e9), '--pids-limit', str(host['PidsLimit']), '--env-file', str(envfile)]
    for key, flag in (('CapDrop', '--cap-drop'), ('CapAdd', '--cap-add'), ('SecurityOpt', '--security-opt')):
        for value in host.get(key) or []:
            args += [flag, value]
    for key, value in (host.get('Tmpfs') or {}).items():
        args += ['--tmpfs', key+':'+value]
    for key, value in (config.get('Labels') or {}).items():
        args += ['--label', key+'='+value]
    for m in old['Mounts']:
        source = str(RELEASE) if m['Destination'] == '/app/backend' else m['Source']
        mount = 'type=bind,source='+source+',target='+m['Destination']+(',readonly' if not m['RW'] else '')
        if m.get('Propagation'):
            mount += ',bind-propagation='+m['Propagation']
        args += ['--mount', mount]
    ep = config.get('Entrypoint') or []
    require(len(ep) <= 1, 'ENTRYPOINT_UNSUPPORTED')
    if ep:
        args += ['--entrypoint', ep[0]]
    args += [old['Image'], *(config.get('Cmd') or [])]
    docker(*args)
    verify_container(inspect(CANDIDATE), old)
    renamed = switched = stopped = False
    try:
        docker('stop', '--time', '60', NAME)
        stopped = True
        docker('rename', NAME, PREVIOUS)
        renamed = True
        detach(PREVIOUS, networks)
        docker('rename', CANDIDATE, NAME)
        switched = True
        docker('network', 'disconnect', 'none', NAME)
        attach(NAME, networks)
        docker('start', NAME)
        ip = networks['dcelysion_database']['IPAddress']
        for _ in range(30):
            try:
                if request(ip, 4322, '/api/me', 'admin.dcelysion.cn')[0] == 401:
                    break
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(1)
        else:
            raise RuntimeError('ADMIN_HEALTH')
        require(request(ip, 4324, '/', 'memos.dcelysion.cn')[0] == 401, 'MEMOS_ANONYMOUS')
        for name, entry in entries.items():
            status, data = request(ip, 4322, '/' if name == 'index.html' else '/'+name, 'admin.dcelysion.cn')
            require(status == 200 and hashlib.sha256(data).hexdigest() == entry['sha256'], 'HTTP_STATIC_HASH')
        _, final_files = verify_release(RELEASE)
        require({p: e for p, e in final_files.items() if not p.startswith('admin/dist/')} == unchanged, 'FINAL_OTHER_FILES_CHANGED')
        actual = inspect(NAME)
        verify_container(actual, old)
        require(actual['State']['Running'], 'NOT_RUNNING')
        require(set(actual['NetworkSettings']['Networks']) == set(networks), 'FINAL_NETWORKS')
        for network, value in networks.items():
            require(actual['NetworkSettings']['Networks'][network]['IPAddress'] == value['IPAddress'], 'FINAL_IP')
        require(sha(ROOT/'runtime.env') == runtime_hash, 'RUNTIME_ENV_CHANGED')
        result = {'ok': True, 'release': str(RELEASE), 'previousContainer': PREVIOUS, 'uiManifestSHA256': expected, 'matchingStaticFiles': len(entries), 'backendUnchanged': True, 'bundleSHA256': final_files['admin/server/index.mjs']['sha256'], 'runtimeEnvUnchanged': True, 'loginEntry': 200, 'adminAnonymous': 401, 'gatewayAnonymous': 401}
        save(STATE/'result.json', result)
        print(json.dumps(result))
    except BaseException:
        try:
            if switched:
                subprocess.run(['docker', 'stop', '--time', '20', NAME], capture_output=True)
                detach(NAME, networks)
                docker('rename', NAME, FAILED)
            if renamed:
                detach(PREVIOUS, networks)
                docker('rename', PREVIOUS, NAME)
                attach(NAME, networks)
            if stopped:
                docker('start', NAME)
            require(inspect(NAME)['State']['Running'], 'ROLLBACK_NOT_RUNNING')
            save(STATE/'result.json', {'ok': False, 'rollback': True})
        except BaseException:
            save(STATE/'result.json', {'ok': False, 'rollback': False, 'manualRecoveryRequired': True})
            raise RuntimeError('UPGRADE_FAILED_ROLLBACK_FAILED') from None
        raise RuntimeError('UPGRADE_FAILED_ROLLED_BACK') from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ui-dir', required=True, type=Path)
    parser.add_argument('--ui-sha256', required=True)
    args = parser.parse_args()
    try:
        execute(args.ui_dir, args.ui_sha256)
    except Exception as error:
        # Never emit subprocess stderr, inspect data, environment or private paths.
        print(json.dumps({'ok': False, 'errorType': type(error).__name__, 'code': str(error) if type(error) is RuntimeError else 'OPERATION_FAILED'}))
        raise SystemExit(1)
