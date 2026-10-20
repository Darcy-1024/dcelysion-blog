#!/usr/bin/env python3
"""Rebuild one trusted TS input in Linux; retain immutable release and rollback container.

sudo python3 update-admin-bridge.py --bridge-file /tmp/memos-bridge.ts --bridge-sha256 <sha>
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
BUILD = Path('/home/dc-builder/memos-cookie-20261021')
SOURCE = Path('/home/dc-builder/memos-prod-20261020-build')
RELEASE = ROOT/'releases/20261021-memos-cookie'
STATE = ROOT/'operator/memos-cookie-20261021'
NAME = 'dc-admin-formal'
PREVIOUS = NAME+'-before-memos-cookie-20261021'
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


def execute(bridge, expected):
    os.umask(0o077)
    assert os.geteuid() == 0 and bridge.is_file() and not bridge.is_symlink()
    assert len(expected) == 64 and sha(bridge) == expected, 'BRIDGE_INPUT_HASH'
    assert not any(p.exists() for p in (BUILD, RELEASE, STATE)), 'UPGRADE_EXISTS'
    old = json.loads(docker('inspect', NAME))[0]
    host, config, networks = old['HostConfig'], old['Config'], old['NetworkSettings']['Networks']
    assert old['State']['Running'] and not host['PortBindings']
    assert set(networks) == {'dcelysion_database', 'dc-memos-private'}
    assert host['ReadonlyRootfs'] and host['CapDrop'] == ['ALL'] and config['User'] == '1000:1000'
    backend = Path(next(m['Source'] for m in old['Mounts'] if m['Destination'] == '/app/backend'))
    assert backend == ROOT/'releases/20261020-memos'
    runtime_hash = sha(ROOT/'runtime.env')
    STATE.mkdir(mode=0o700)
    save(STATE/'previous-inspect.json', old)
    shutil.copytree(SOURCE, BUILD, ignore=shutil.ignore_patterns('node_modules', 'candidate', '*.tar.gz', 'manifest.json'))
    shutil.copyfile(bridge, BUILD/'admin/server/memos-bridge.ts')
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
    manifest = json.loads((RELEASE/'manifest.json').read_text())
    entry = next(e for e in manifest['entries'] if e['path'] == 'admin/server/index.mjs')
    entry.update(bytes=(RELEASE/entry['path']).stat().st_size, sha256=sha(RELEASE/entry['path']))
    manifest['bridgeUpdate'] = {'sourceSHA256': expected, 'builderImage': IMAGE, 'previousRelease': str(backend)}
    (RELEASE/'manifest.json').write_text(json.dumps(manifest, indent=2))
    for item in [RELEASE, *RELEASE.rglob('*')]:
        item.chmod(0o755 if item.is_dir() else 0o644)
    for e in manifest['entries']:
        assert sha(RELEASE/e['path']) == e['sha256'], 'RELEASE_MANIFEST_MISMATCH'
    envfile = STATE/'runtime.exact.env'
    envfile.write_text('\n'.join(config['Env'])+'\n')
    envfile.chmod(0o600)
    candidate = NAME+'-candidate-cookie-20261021'
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
        assert gateway in [401, 403], 'GATEWAY_ANONYMOUS_CHECK'
        actual = json.loads(docker('inspect', NAME))[0]
        assert actual['State']['Running'] and actual['Image'] == old['Image']
        assert set(actual['NetworkSettings']['Networks']) == set(networks)
        assert actual['Config']['Env'] == config['Env']
        assert sha(ROOT/'runtime.env') == runtime_hash
        result = {'ok': True, 'release': str(RELEASE), 'previousContainer': PREVIOUS,
                  'sourceSHA256': expected, 'bundleSHA256': sha(RELEASE/'admin/server/index.mjs'),
                  'adminAnonymous': 401, 'gatewayAnonymous': gateway, 'runtimeEnvUnchanged': True}
        save(STATE/'result.json', result)
        print(json.dumps(result))
    except BaseException:
        if switched:
            subprocess.run(['docker', 'stop', '--time', '20', NAME], capture_output=True)
            detach(NAME, networks)
            docker('rename', NAME, NAME+'-failed-cookie-20261021')
        if renamed:
            detach(PREVIOUS, networks)
            docker('rename', PREVIOUS, NAME)
            attach(NAME, networks)
            docker('start', NAME)
        save(STATE/'result.json', {'ok': False, 'rollback': True})
        raise RuntimeError('UPGRADE_FAILED_ROLLED_BACK') from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bridge-file', required=True, type=Path)
    parser.add_argument('--bridge-sha256', required=True)
    args = parser.parse_args()
    try: execute(args.bridge_file, args.bridge_sha256)
    except Exception as error:
        print(json.dumps({'ok': False, 'errorType': type(error).__name__}))
        raise SystemExit(1)
