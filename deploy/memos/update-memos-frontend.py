#!/usr/bin/env python3
"""Build and prepare a sealed Memos UI plus backend, then explicitly activate it.

sudo python3 update-memos-frontend.py prepare --source /tmp/source --ui /tmp/ui
sudo python3 update-memos-frontend.py activate
Secrets are read only in place and are never emitted. runtime.env is not rewritten.
"""
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
BUILD = Path('/home/dc-builder/memos-emoji-20261021')
SOURCE = Path('/home/dc-builder/memos-prod-20261020-build')
RELEASE = ROOT/'releases/20261021-memos-emoji'
STATE = ROOT/'operator/memos-emoji-20261021'
NAME = 'dc-admin-formal'
PREVIOUS = NAME+'-before-memos-emoji-20261021'
FRONTEND_ENV = 'ADMIN_MEMOS_FRONTEND_DIRECTORY=/app/backend/memos-ui'
INPUTS = ('config.ts', 'index.ts', 'memos-bridge.ts', 'memos-frontend.ts')
IMAGE = 'sha256:7d80192eb45362b46bc601b7ef5243cb772ae456f8a48b8d3fa034c4de8c9210'
ESBUILD = r'''import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire('/opt/blog/package.json');
for(const name of ['pnpm-lock.yaml','pnpm-workspace.yaml']) {
 if(!readFileSync('/work/'+name).equals(readFileSync('/opt/blog/'+name))) throw Error('dependency mismatch');
}
const pkg=p=>{const x=JSON.parse(readFileSync(p,'utf8'));delete x.scripts;return JSON.stringify(x)};
if(pkg('/work/package.json')!==pkg('/opt/blog/package.json')) throw Error('package mismatch');
await require('esbuild').build({entryPoints:['/work/admin/server/index.ts'],bundle:true,
 platform:'node',format:'esm',target:'node24',external:['sharp','vite','../vite.config.js'],
 banner:{js:'import { createRequire as dcCreateRequire } from "node:module"; const require = dcCreateRequire(import.meta.url);'},
 outfile:'/work/index.mjs'});
await require('esbuild').build({entryPoints:['/work/admin/server/memos-frontend.ts'],bundle:true,
 platform:'node',format:'esm',target:'node24',outfile:'/work/frontend-loader.mjs'});
'''


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


def check_loader():
    # Do not relax private release-parent permissions for the rootless builder.
    # This copy contains only the reviewed public frontend files.
    target = BUILD/'ui-check'
    if not target.exists():
        shutil.copytree(RELEASE/'memos-ui', target)
    assert sha(target/'frontend-manifest.json') == sha(RELEASE/'memos-ui/frontend-manifest.json')
    ui_entries(target)
    run(['sudo', '-u', 'dc-builder', 'docker', '--host', 'unix:///run/user/1002/docker.sock',
         'run', '--rm', '--user', '0:0', '--network', 'none', '--cap-drop', 'ALL',
         '--mount', 'type=bind,source='+str(BUILD)+',target=/work,readonly',
         '--mount', 'type=bind,source='+str(target)+',target=/ui,readonly',
         '--entrypoint', 'node', IMAGE, '--input-type=module', '-e',
         "import {MemosFrontend} from '/work/frontend-loader.mjs'; const ui=await MemosFrontend.load('/ui'); if(!ui.index().bytes.length)throw Error('index empty');"])


def prepare(source, ui):
    os.umask(0o077)
    assert os.geteuid() == 0
    source_manifest = json.loads((source/'source-manifest.json').read_text())
    assert set(source_manifest['files']) == set(INPUTS), 'SOURCE_MANIFEST'
    for name in INPUTS:
        file = source/name
        assert file.is_file() and not file.is_symlink() and sha(file) == source_manifest['files'][name]
    frontend = ui_entries(ui)
    assert not any(p.exists() for p in (BUILD, RELEASE, STATE)), 'UPGRADE_EXISTS'
    old = json.loads(docker('inspect', NAME))[0]
    host, config, networks = old['HostConfig'], old['Config'], old['NetworkSettings']['Networks']
    assert old['State']['Running'] and not host['PortBindings']
    assert set(networks) == {'dcelysion_database', 'dc-memos-private'}
    assert host['ReadonlyRootfs'] and host['CapDrop'] == ['ALL'] and config['User'] == '1000:1000'
    backend = Path(next(m['Source'] for m in old['Mounts'] if m['Destination'] == '/app/backend'))
    assert backend == ROOT/'releases/20261021-memos-cookie'
    runtime_hash = sha(ROOT/'runtime.env')
    STATE.mkdir(mode=0o700)
    save(STATE/'previous-inspect.json', old)
    shutil.copytree(SOURCE, BUILD, ignore=shutil.ignore_patterns('node_modules', 'candidate', '*.tar.gz', 'manifest.json'))
    for name in INPUTS:
        shutil.copyfile(source/name, BUILD/'admin/server'/name)
    (BUILD/'build.mjs').write_text(ESBUILD)
    # Match the pinned dependency image exactly; skip no dependency metadata.
    for item in BUILD.rglob('*'):
        if item.is_dir(): item.chmod(0o755)
        else: item.chmod(0o644)
        os.chown(item, 1002, 1002)
    os.chown(BUILD, 1002, 1002)
    BUILD.chmod(0o755)
    # node_modules resolves inside the existing trusted Linux image.
    (BUILD/'node_modules').symlink_to('/opt/blog/node_modules', target_is_directory=True)
    run(['sudo', '-u', 'dc-builder', 'docker', '--host', 'unix:///run/user/1002/docker.sock',
         'run', '--rm', '--user', '0:0', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
         '--mount', 'type=bind,source='+str(BUILD)+',target=/work', '--entrypoint', 'node', IMAGE, '/work/build.mjs'])
    assert (BUILD/'index.mjs').stat().st_size > 100000
    shutil.copytree(backend, RELEASE)
    shutil.copyfile(BUILD/'index.mjs', RELEASE/'admin/server/index.mjs')
    shutil.copytree(ui, RELEASE/'memos-ui')
    manifest = json.loads((RELEASE/'manifest.json').read_text())
    entry = next(e for e in manifest['entries'] if e['path'] == 'admin/server/index.mjs')
    entry.update(bytes=(RELEASE/entry['path']).stat().st_size, sha256=sha(RELEASE/entry['path']))
    for file in sorted((RELEASE/'memos-ui').rglob('*')):
        if file.is_file():
            manifest['entries'].append({'path': file.relative_to(RELEASE).as_posix(), 'bytes': file.stat().st_size, 'sha256': sha(file)})
    manifest['frontendUpdate'] = {'sourceFiles': source_manifest['files'], 'builderImage': IMAGE,
                                  'previousRelease': str(backend), 'frontendManifestSHA256': sha(RELEASE/'memos-ui/frontend-manifest.json')}
    (RELEASE/'manifest.json').write_text(json.dumps(manifest, indent=2))
    for item in [RELEASE, *RELEASE.rglob('*')]:
        item.chmod(0o755 if item.is_dir() else 0o644)
    release_entries(manifest)
    # Run the exact sealed loader in Linux before changing the active container.
    check_loader()
    save(STATE/'prepared.json', {'status': 'prepared', 'release': str(RELEASE), 'runtimeEnvSHA256': runtime_hash,
                               'sourceFiles': source_manifest['files'], 'manifestSHA256': sha(RELEASE/'manifest.json'),
                               'uiFiles': len(frontend['entries']), 'uiIndexSHA256': sha(RELEASE/'memos-ui/index.html')})
    print(json.dumps({'status': 'prepared', 'release': str(RELEASE), 'uiFiles': len(frontend['entries']),
                      'uiSealedLoader': 'passed', 'bundleSHA256': sha(RELEASE/'admin/server/index.mjs')}))


def finish_prepare(source):
    assert os.geteuid() == 0 and not (STATE/'prepared.json').exists()
    old = json.loads((STATE/'previous-inspect.json').read_text())
    current = json.loads(docker('inspect', NAME))[0]
    assert current['Id'] == old['Id'] and current['State']['Running']
    manifest = json.loads((RELEASE/'manifest.json').read_text())
    proof = json.loads((source/'source-manifest.json').read_text())
    assert manifest['frontendUpdate']['sourceFiles'] == proof['files']
    for name in INPUTS:
        assert sha(source/name) == proof['files'][name]
        assert sha(BUILD/'admin/server'/name) == proof['files'][name]
    release_entries(manifest)
    frontend = ui_entries(RELEASE/'memos-ui')
    check_loader()
    save(STATE/'prepared.json', {'status': 'prepared', 'release': str(RELEASE),
        'runtimeEnvSHA256': sha(ROOT/'runtime.env'), 'sourceFiles': proof['files'],
        'manifestSHA256': sha(RELEASE/'manifest.json'), 'uiFiles': len(frontend['entries']),
        'uiIndexSHA256': sha(RELEASE/'memos-ui/index.html')})
    print(json.dumps({'status': 'prepared', 'uiSealedLoader': 'passed', 'uiFiles': len(frontend['entries'])}))


def activate():
    os.umask(0o077)
    assert os.geteuid() == 0 and not (STATE/'result.json').exists()
    prepared = json.loads((STATE/'prepared.json').read_text())
    old = json.loads((STATE/'previous-inspect.json').read_text())
    current = json.loads(docker('inspect', NAME))[0]
    assert current['Id'] == old['Id'] and current['State']['Running'], 'ACTIVE_CONTAINER_CHANGED'
    assert sha(RELEASE/'manifest.json') == prepared['manifestSHA256']
    manifest = json.loads((RELEASE/'manifest.json').read_text())
    release_entries(manifest)
    ui = ui_entries(RELEASE/'memos-ui')
    runtime_hash = prepared['runtimeEnvSHA256']
    assert sha(ROOT/'runtime.env') == runtime_hash
    host, config, networks = old['HostConfig'], old['Config'], old['NetworkSettings']['Networks']
    assert not any(e.startswith('ADMIN_MEMOS_FRONTEND_DIRECTORY=') for e in config['Env'])
    newenv = [*config['Env'], FRONTEND_ENV]
    envfile = STATE/'runtime.exact.env'
    envfile.write_text('\n'.join(newenv)+'\n')
    envfile.chmod(0o600)
    candidate = NAME+'-candidate-emoji-20261021'
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
        asset = next(e['path'] for e in ui['entries'] if e['path'].endswith('.js'))
        for pathname in ('/api/v1/memos', '/'+asset, '/index.html'):
            assert status('http://'+ip+':4324'+pathname, 'memos.dcelysion.cn') == 401, 'GATEWAY_PATH_ANONYMOUS_CHECK'
        actual = json.loads(docker('inspect', NAME))[0]
        assert actual['State']['Running'] and actual['Image'] == old['Image']
        assert set(actual['NetworkSettings']['Networks']) == set(networks)
        assert actual['Config']['Env'] == newenv
        assert sha(ROOT/'runtime.env') == runtime_hash
        result = {'ok': True, 'release': str(RELEASE), 'previousContainer': PREVIOUS,
                  'bundleSHA256': sha(RELEASE/'admin/server/index.mjs'),
                  'uiManifestSHA256': sha(RELEASE/'memos-ui/frontend-manifest.json'),
                  'adminAnonymous': 401, 'gatewayAnonymous': gateway, 'apiAssetIndexAnonymous': 401,
                  'runtimeEnvUnchanged': True, 'addedEnvironment': FRONTEND_ENV}
        save(STATE/'result.json', result)
        print(json.dumps(result))
    except BaseException:
        if switched:
            subprocess.run(['docker', 'stop', '--time', '20', NAME], capture_output=True)
            detach(NAME, networks)
            docker('rename', NAME, NAME+'-failed-emoji-20261021')
        if renamed:
            detach(PREVIOUS, networks)
            docker('rename', PREVIOUS, NAME)
            attach(NAME, networks)
            docker('start', NAME)
        save(STATE/'result.json', {'ok': False, 'rollback': True})
        raise RuntimeError('UPGRADE_FAILED_ROLLED_BACK') from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'finish-prepare', 'activate'])
    parser.add_argument('--source', type=Path)
    parser.add_argument('--ui', type=Path)
    args = parser.parse_args()
    try:
        if args.action == 'prepare':
            assert args.source and args.ui
            prepare(args.source, args.ui)
        elif args.action == 'finish-prepare':
            assert args.source
            finish_prepare(args.source)
        else: activate()
    except Exception as error:
        print(json.dumps({'ok': False, 'errorType': type(error).__name__}))
        raise SystemExit(1)
