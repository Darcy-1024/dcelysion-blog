#!/usr/bin/env python3
"""Operator-only, rollback-preserving cloud publishing enablement.

Input directory: manifest.json {entries:[{path,bytes,sha256}]} plus only
admin/dist/**, admin/server/index.mjs and admin/build/**. Never contains secrets.
Run as root; no operation is performed on import. Existing DB data is not changed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path('/opt/dcelysion-admin-stage2')
NAME = 'dc-admin-formal'
REMOTE = 'https://github.com/Darcy-1024/dcelysion-blog.git'
WORKFLOW = 'e4a85d4d56ac75b929ce40cf0f5dc921aa02ab29'


def require(value, code):
    if not value:
        raise RuntimeError(code)


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, timeout=1800,
                          **kwargs).stdout


def docker(*args):
    return run(['docker', *args]).decode().strip()


def inspect(name):
    return json.loads(docker('inspect', name))[0]


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inventory(root):
    require(root.is_dir() and not root.is_symlink(), 'DIRECTORY_TYPE')
    result = {}
    for path in root.rglob('*'):
        require(not path.is_symlink(), 'SYMLINK')
        if path.is_dir():
            continue
        require(path.is_file(), 'SPECIAL_FILE')
        name = path.relative_to(root).as_posix()
        result[name] = {'path': name, 'bytes': path.stat().st_size, 'sha256': sha(path)}
    return result


def verify(root, expected=None):
    actual = inventory(root)
    require('manifest.json' in actual, 'MANIFEST_MISSING')
    if expected:
        require(actual['manifest.json']['sha256'] == expected, 'MANIFEST_DIGEST')
    manifest = json.loads((root / 'manifest.json').read_text())
    entries = manifest.get('entries')
    require(isinstance(entries, list), 'MANIFEST_ENTRIES')
    expected_files = {}
    for entry in entries:
        name = entry.get('path', '')
        require(name and not name.startswith('/') and '\\' not in name
                and all(p not in ('', '.', '..') and not p.startswith('.env')
                        for p in name.split('/')) and name != 'manifest.json', 'MANIFEST_PATH')
        require(name not in expected_files, 'MANIFEST_DUPLICATE')
        expected_files[name] = entry
    actual.pop('manifest.json')
    require(actual == expected_files, 'FILES_DIFFER')
    return manifest, actual


def save(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')
    path.chmod(0o600)


def api(path, token):
    request = urllib.request.Request('https://api.github.com/' + path, headers={
        'Authorization': 'Bearer ' + token, 'User-Agent': 'DcElysion-admin-enable',
        'Accept': 'application/vnd.github+json',
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def no_pending_jobs(old):
    env = dict(x.split('=', 1) for x in old['Config']['Env'] if '=' in x)
    database = urllib.parse.urlsplit(env['ADMIN_DATABASE_URL']).path.lstrip('/')
    pg = inspect('dcelysion-postgres-1')
    pgenv = dict(x.split('=', 1) for x in pg['Config']['Env'] if '=' in x)
    count = docker('exec', 'dcelysion-postgres-1', 'psql', '-U', pgenv['POSTGRES_USER'],
                   '-d', database, '-Atc',
                   "SELECT count(*) FROM dc_admin.jobs WHERE status IN ('queued','running')")
    require(count == '0', 'PENDING_JOBS')


def request(ip, port, path, host):
    try:
        req = urllib.request.Request(f'http://{ip}:{port}{path}', headers={'Host': host})
        with urllib.request.urlopen(req, timeout=5) as response:
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


def execute(source, expected, release_id, workflow):
    os.umask(0o077)
    require(os.geteuid() == 0, 'ROOT_REQUIRED')
    require(re.fullmatch(r'[a-z0-9][a-z0-9-]{3,60}', release_id), 'RELEASE_ID')
    require(re.fullmatch(r'[a-f0-9]{40}', workflow), 'WORKFLOW_SHA')
    _, updates = verify(source, expected)
    require('admin/server/index.mjs' in updates and 'admin/dist/index.html' in updates, 'INPUT_INCOMPLETE')
    require(all(p.startswith(('admin/dist/', 'admin/build/')) or p == 'admin/server/index.mjs'
                for p in updates), 'INPUT_SCOPE')
    release = ROOT / 'releases' / release_id
    state = ROOT / 'operator' / release_id
    previous, candidate, failed = (NAME + suffix + release_id for suffix in ('-before-', '-candidate-', '-failed-'))
    require(not release.exists() and not state.exists(), 'OUTPUT_EXISTS')
    old = inspect(NAME)
    host, config, networks = old['HostConfig'], old['Config'], old['NetworkSettings']['Networks']
    require(old['State']['Running'] and not host['PortBindings'], 'ACTIVE_CONTAINER')
    require(set(networks) == {'dcelysion_database', 'dc-memos-private'}, 'NETWORK_SET')
    require(host['ReadonlyRootfs'] and host['CapDrop'] == ['ALL'] and config['User'] == '1000:1000', 'SECURITY_BASELINE')
    require(all(m['Type'] == 'bind' and ',' not in m['Source'] for m in old['Mounts']), 'MOUNT_TYPE')
    no_pending_jobs(old)
    token_file = ROOT / 'operator/github-publishing/token'
    require(token_file.is_file() and not token_file.is_symlink()
            and token_file.stat().st_mode & 0o077 == 0, 'TOKEN_FILE')
    token = token_file.read_text().strip()
    require(token.startswith('github_pat_') and not re.search(r'\s', token), 'TOKEN_FORMAT')
    require(api('repos/Darcy-1024/dcelysion-admin-builder', token)['private'] is True, 'BUILDER_NOT_PRIVATE')
    require(api('repos/Darcy-1024/dcelysion-admin-builder/commits/main', token)['sha'] == workflow, 'WORKFLOW_CHANGED')
    require(api('repos/Darcy-1024/dcelysion-blog', token).get('permissions', {}).get('push'), 'BLOG_WRITE_PERMISSION')
    backend = Path(next(m['Source'] for m in old['Mounts'] if m['Destination'] == '/app/backend'))
    require(backend.resolve().parent == (ROOT / 'releases').resolve(), 'BACKEND_LOCATION')
    manifest, old_files = verify(backend)
    require(any(p.startswith('memos-ui/') for p in old_files), 'MEMOS_UI_MISSING')
    state.mkdir(mode=0o700)
    save(state / 'previous-inspect.json', old)
    # A tiny derived image adds trusted Git/Python CLIs, never credentials.
    require('Alpine' in docker('exec', NAME, 'cat', '/etc/os-release'), 'IMAGE_NOT_ALPINE')
    dockerfile = (f'FROM {old["Image"]}\nUSER root\n'
                  'RUN apk add --no-cache git openssh-client python3 tar\nUSER 1000:1000\n')
    tag = 'dc-admin-cloud-publishing:' + release_id
    run(['docker', 'build', '-t', tag, '-'], input=dockerfile.encode())
    image = docker('image', 'inspect', tag, '--format', '{{.Id}}')
    home, jobs, git_source = state / 'home', state / 'jobs', state / 'source.git'
    for path in (home, jobs):
        path.mkdir(mode=0o700)
        os.chown(path, 1000, 1000)
    netrc = home / '.netrc'
    netrc.write_text('machine github.com\nlogin x-access-token\npassword ' + token + '\n')
    netrc.chmod(0o400)
    os.chown(netrc, 1000, 1000)
    # The seed is independent of Memos and contains only the public Git source.
    run(['git', '-c', 'core.hooksPath=/dev/null', 'clone', '--bare', '--depth', '1', REMOTE, str(git_source)])
    for path in (git_source, *git_source.rglob('*')):
        os.chown(path, 1000, 1000)
        path.chmod(0o700 if path.is_dir() else 0o600)
    shutil.copytree(backend, release)
    for folder in ('admin/dist', 'admin/build'):
        if (source / folder).exists():
            shutil.rmtree(release / folder)
            shutil.copytree(source / folder, release / folder)
    shutil.copy2(source / 'admin/server/index.mjs', release / 'admin/server/index.mjs')
    actual = inventory(release)
    untouched = {p: e for p, e in old_files.items() if not p.startswith(('admin/dist/', 'admin/build/')) and p != 'admin/server/index.mjs'}
    require({p: e for p, e in actual.items() if p != 'manifest.json' and not p.startswith(('admin/dist/', 'admin/build/')) and p != 'admin/server/index.mjs'} == untouched, 'OTHER_FILES_CHANGED')
    manifest['entries'] = [actual[p] for p in sorted(actual) if p != 'manifest.json']
    manifest['cloudPublishing'] = {'previousRelease': str(backend), 'inputManifestSHA256': expected,
                                   'workflowRevision': workflow, 'builderRepository': 'Darcy-1024/dcelysion-admin-builder'}
    (release / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    for path in (release, *release.rglob('*')):
        path.chmod(0o755 if path.is_dir() else 0o644)
    verify(release)
    env = dict(x.split('=', 1) for x in config['Env'])
    for key in ('ADMIN_BUILD_REMOTE_URL', 'ADMIN_BUILD_REMOTE_TOKEN', 'ADMIN_TENCENT_SSH_HOST'):
        env.pop(key, None)
    env.update(ADMIN_BUILD_GITHUB_REPOSITORY='Darcy-1024/dcelysion-admin-builder',
               ADMIN_BUILD_GITHUB_TOKEN=token, ADMIN_BUILD_GITHUB_WORKFLOW_REVISION=workflow,
               ADMIN_PUBLISH_REMOTE=REMOTE, ADMIN_PUBLISH_BRANCH='master',
               ADMIN_PUBLISH_REPOSITORY='/app/publish-source', ADMIN_EXECUTOR_STATE_ROOT='/app/publish-state',
               ADMIN_BUILD_COMMENT_PROVIDER='waline', ADMIN_BUILD_WALINE_SERVER_URL='https://comments.dcelysion.cn',
               HOME='/app/publish-home')
    require(all(not re.search(r'[\r\n]', k + v) for k, v in env.items()), 'ENV_NEWLINE')
    envfile = state / 'runtime.env'
    envfile.write_text('\n'.join(k + '=' + v for k, v in env.items()) + '\n')
    envfile.chmod(0o600)
    args = ['create', '--name', candidate, '--restart', host['RestartPolicy']['Name'], '--network', 'none',
            '--user', config['User'], '--workdir', config['WorkingDir'], '--read-only',
            '--memory', str(host['Memory']), '--memory-swap', str(host['MemorySwap']),
            '--cpus', str(host['NanoCpus'] / 1e9), '--pids-limit', str(host['PidsLimit']), '--env-file', str(envfile)]
    for key, flag in (('CapDrop', '--cap-drop'), ('CapAdd', '--cap-add'), ('SecurityOpt', '--security-opt')):
        for value in host.get(key) or []:
            args += [flag, value]
    for key, value in (host.get('Tmpfs') or {}).items():
        args += ['--tmpfs', key + ':' + value]
    for key, value in (config.get('Labels') or {}).items():
        args += ['--label', key + '=' + value]
    for mount in old['Mounts']:
        location = str(release) if mount['Destination'] == '/app/backend' else mount['Source']
        arg = f'type=bind,source={location},target={mount["Destination"]}' + (',readonly' if not mount['RW'] else '')
        if mount.get('Propagation'):
            arg += ',bind-propagation=' + mount['Propagation']
        args += ['--mount', arg]
    for location, target, readonly in ((home, '/app/publish-home', True), (jobs, '/app/publish-state', False), (git_source, '/app/publish-source', True)):
        args += ['--mount', f'type=bind,source={location},target={target}' + (',readonly' if readonly else '')]
    entrypoint = config.get('Entrypoint') or []
    require(len(entrypoint) <= 1, 'ENTRYPOINT_UNSUPPORTED')
    if entrypoint:
        args += ['--entrypoint', entrypoint[0]]
    args += [image, *(config.get('Cmd') or [])]
    docker(*args)
    # No old queued job may become active during the switch.
    no_pending_jobs(old)
    stopped = renamed = switched = False
    try:
        docker('stop', '--time', '60', NAME)
        stopped = True
        docker('rename', NAME, previous)
        renamed = True
        detach(previous, networks)
        docker('rename', candidate, NAME)
        switched = True
        docker('network', 'disconnect', 'none', NAME)
        attach(NAME, networks)
        docker('start', NAME)
        ip = networks['dcelysion_database']['IPAddress']
        for _ in range(40):
            try:
                if request(ip, 4322, '/api/me', 'admin.dcelysion.cn')[0] == 401:
                    break
            except OSError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError('ADMIN_HEALTH')
        require(request(ip, 4324, '/', 'memos.dcelysion.cn')[0] == 401, 'MEMOS_AUTH')
        require(request(ip, 4322, '/api/publishing', 'admin.dcelysion.cn')[0] == 401, 'PUBLISH_AUTH')
        require(request(ip, 4322, '/', 'admin.dcelysion.cn')[0] == 200, 'UI_HEALTH')
        current = inspect(NAME)
        require(current['Image'] == image and current['State']['Running'], 'IMAGE_NOT_RUNNING')
        require(set(current['NetworkSettings']['Networks']) == set(networks), 'NETWORK_CHANGED')
        for network, value in networks.items():
            require(current['NetworkSettings']['Networks'][network]['IPAddress'] == value['IPAddress'], 'IP_CHANGED')
        result = {'ok': True, 'release': str(release), 'previousContainer': previous,
                  'image': image, 'workflowRevision': workflow, 'adminAnonymous': 401,
                  'gatewayAnonymous': 401, 'realCloudPreviewVerified': False}
        save(state / 'result.json', result)
        print(json.dumps(result))
    except BaseException:
        if switched:
            subprocess.run(['docker', 'stop', '--time', '20', NAME], capture_output=True)
            detach(NAME, networks)
            docker('rename', NAME, failed)
        if renamed:
            docker('rename', previous, NAME)
            attach(NAME, networks)
        if stopped:
            docker('start', NAME)
        save(state / 'result.json', {'ok': False, 'rollback': inspect(NAME)['State']['Running']})
        raise RuntimeError('ENABLE_FAILED_ROLLED_BACK') from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', required=True, type=Path)
    parser.add_argument('--input-sha256', required=True)
    parser.add_argument('--release-id', default='20261031-admin-cloud-publishing')
    parser.add_argument('--workflow-revision', default=WORKFLOW)
    args = parser.parse_args()
    try:
        execute(args.input_dir, args.input_sha256, args.release_id, args.workflow_revision)
    except Exception as error:
        # Never disclose environment, tokens, raw subprocess output or response bodies.
        print(json.dumps({'ok': False, 'code': str(error) if type(error) is RuntimeError else 'OPERATION_FAILED'}))
        raise SystemExit(1)
