#!/usr/bin/env python3
"""Install an isolated publisher; prepare never clones, publishes or starts a timer.

Run as root on the production host: publisher-runtime.py prepare <staged repo>.
After repository deploy-key registration: publisher-runtime.py clone.
Explicit activation: publisher-runtime.py enable [--timer].
State, originals, receipts and deploy key are retained under PRIVATE for backups.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

TOOLS = Path('/opt/dcelysion-memos-publisher-tools')
PRIVATE = Path('/var/lib/dcelysion-memos-publisher')
CHECKOUT = Path('/srv/dcelysion-memos-publisher/checkout')
IMAGE = 'dcelysion/memos-publisher:20261020'
BUILDER_IMAGE = 'sha256:7d80192eb45362b46bc601b7ef5243cb772ae456f8a48b8d3fa034c4de8c9210'
SHARP_MODULES = Path('/opt/dcelysion-admin-stage2/releases/20261020-memos/node_modules')
REMOTE = 'git@github.com:Darcy-1024/dcelysion-blog.git'
RUNTIME = r'''import * as fs from 'node:fs/promises';
import path from 'node:path';
import { publish, validatePublication } from './scripts/memos-sync/publish.mjs';
import { observe } from './scripts/memos-sync/observe.mjs';
import { atomicWrite } from './scripts/memos-sync/store.mjs';

const args = process.argv.slice(2);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const write = (file, data) => atomicWrite(file, JSON.stringify(data, null, 2));
async function main() {
  if (args.includes('--help')) {
    console.log('runtime.mjs --config <private.json> [--execute] [--resume] [--recover-lock]');
    return;
  }
  const index = args.indexOf('--config');
  if (index < 0 || !args[index + 1] || args.some((arg, i) =>
    !['--config', '--execute', '--resume', '--recover-lock'].includes(arg) && i !== index + 1))
    throw new Error('Invalid arguments');
  const config = validatePublication(JSON.parse(await fs.readFile(args[index + 1], 'utf8')));
  if (!config.enabled || !args.includes('--execute')) {
    console.log(JSON.stringify({ status: 'disabled', config: 'valid' }));
    return;
  }
  const privatePath = name => path.join(config.sync.stateDir, name);
  const halted = privatePath('runtime-halted.json');
  if (await fs.stat(halted).catch(() => null)) throw new Error('Runtime halted');
  const tokenStat = await fs.stat(config.sync.tokenFile);
  if (!tokenStat.isFile() || tokenStat.mode & 0o077) throw new Error('PAT permission mismatch');
  const token = (await fs.readFile(config.sync.tokenFile, 'utf8')).trim();
  // A crash after push must finish observing that SHA before any new source read.
  const pending = privatePath('runtime-pending.json');
  let receipt = JSON.parse(await fs.readFile(pending, 'utf8').catch(() => 'null'));
  try {
    if (!receipt) {
      const prior = JSON.parse(await fs.readFile(privatePath('publication-receipt.json'), 'utf8').catch(() => 'null'));
      const observed = JSON.parse(await fs.readFile(privatePath('runtime-observed.json'), 'utf8').catch(() => 'null'));
      if (prior?.commit && prior.commit !== observed?.commit) receipt = prior;
    }
    if (!receipt) {
      receipt = await publish(config, { execute: true, token,
        resume: args.includes('--resume'), recoverLock: args.includes('--recover-lock') });
      if (receipt.status === 'source-changed-retry') { console.log(JSON.stringify(receipt)); return; }
      // Covers process death between publication receipt and runtime journal.
      if (!receipt.commit) {
        const prior = JSON.parse(await fs.readFile(privatePath('publication-receipt.json'), 'utf8').catch(() => 'null'));
        const observed = JSON.parse(await fs.readFile(privatePath('runtime-observed.json'), 'utf8').catch(() => 'null'));
        if (prior?.commit && prior.commit !== observed?.commit) receipt = prior;
      }
      if (!receipt.commit) { console.log(JSON.stringify(receipt)); return; }
      await write(pending, receipt);
    }
    if (!/^[a-f0-9]{40}$/.test(receipt.commit)) throw new Error('Invalid pending SHA');
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      const evidence = await observe(receipt.commit);
      if (evidence.build === 'release-assets-present' && evidence.deployment === 'paired-version-observed') {
        await write(privatePath('runtime-observed.json'), evidence);
        await fs.unlink(pending);
        console.log(JSON.stringify({ status: 'published-observed', commit: receipt.commit,
          publicTreeSha256: evidence.sites[0].publicTreeSha256 }));
        return;
      }
      await pause(15000);
    }
    throw new Error('Deployment evidence timeout');
  } catch {
    await write(halted, { status: 'halted', commit: receipt?.commit ?? null,
      observedAt: new Date().toISOString() });
    throw new Error('Publisher halted');
  }
}
main().catch(() => { console.error(JSON.stringify({ status: 'halted', action: 'inspect-private-state' })); process.exitCode = 1; });
'''


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def save(target, data, mode=0o600, owner=1000):
    target.write_text(data)
    target.chmod(mode)
    os.chown(target, owner, owner)


def container(*args, entrypoint=None):
    cmd = ['docker', 'run', '--rm', '--network', 'host', '--user', '1000:1000',
           '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
           '--memory', '384m', '--memory-swap', '512m', '--cpus', '0.5', '--pids-limit', '96',
           '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '-e', 'HOME=/private',
           '-e', 'GIT_TERMINAL_PROMPT=0', '-v', f'{TOOLS}:/tools:ro',
           '-v', f'{CHECKOUT}:/checkout:rw', '-v', f'{PRIVATE}:/private:rw']
    if entrypoint:
        cmd += ['--entrypoint', entrypoint]
    return run(*cmd, IMAGE, *args)


def dependencies():
    # Reuse reviewed Linux dependencies, never a Windows node_modules tree.
    target = TOOLS/'node_modules'
    target.mkdir(exist_ok=True)
    shutil.copytree(SHARP_MODULES, target, dirs_exist_ok=True, symlinks=False)
    for package in ('marked', 'yaml'):
        archive = PRIVATE/f'{package}-dependencies.tar'
        try:
            with archive.open('wb') as output:
                run('sudo', '-u', 'dc-builder', 'docker', '--host',
                    'unix:///run/user/1002/docker.sock', 'run', '--rm',
                    '--entrypoint', 'sh', BUILDER_IMAGE, '-c',
                    f'tar -chf - -C /opt/blog/node_modules {package}', stdout=output)
            run('tar', '-xf', str(archive), '-C', str(target))
        finally:
            archive.unlink(missing_ok=True)


def main():
    os.umask(0o077)
    if os.geteuid() != 0:
        raise RuntimeError('Root required')
    action = sys.argv[1]
    if action == 'prepare':
        source = Path(sys.argv[2]).resolve()
        for directory in (TOOLS, PRIVATE, CHECKOUT):
            directory.mkdir(parents=True, exist_ok=True)
            directory.chmod(0o755 if directory == TOOLS else 0o700)
            os.chown(directory, 1000, 1000)
        (TOOLS/'scripts/memos-sync').mkdir(parents=True, exist_ok=True)
        dependencies()
        for file in (source/'scripts/memos-sync').glob('*.mjs'):
            if '.test.' not in file.name:
                shutil.copyfile(file, TOOLS/'scripts/memos-sync'/file.name)
        shutil.copyfile(source/'scripts/blog-route-contract.mjs', TOOLS/'scripts/blog-route-contract.mjs')
        save(TOOLS/'runtime.mjs', RUNTIME, 0o644)
        save(TOOLS/'run-publisher.sh', (source/'deploy/memos/run-publisher.sh').read_text(), 0o755, 0)
        shutil.copyfile(source/'deploy/memos/Dockerfile.publisher', TOOLS/'Dockerfile.publisher')
        if not (PRIVATE/'id_ed25519').exists():
            run('sudo', '-u', 'ubuntu', 'ssh-keygen', '-t', 'ed25519', '-N', '',
                '-C', 'dcelysion-memos-publisher', '-f', str(PRIVATE/'id_ed25519'), stdout=subprocess.DEVNULL)
        request = urllib.request.Request('https://api.github.com/meta', headers={'User-Agent': 'DcElysion-Memos-Publisher'})
        with urllib.request.urlopen(request, timeout=30) as response:
            keys = json.load(response)['ssh_keys']
        assert keys and all(key.startswith(('ssh-ed25519 ', 'ecdsa-sha2-', 'ssh-rsa ')) for key in keys)
        save(PRIVATE/'known_hosts', ''.join('github.com ' + key + '\n' for key in keys))
        shutil.copyfile('/opt/dcelysion-memos/sync/pat', PRIVATE/'pat')
        os.chmod(PRIVATE/'pat', 0o600)
        os.chown(PRIVATE/'pat', 1000, 1000)
        author = json.loads(Path('/opt/dcelysion-memos/author.json').read_text())
        assert author['expectedUser'] == 'users/dcelysion'
        if not (PRIVATE/'config.json').exists():
            config = dict(enabled=False, remoteUrl=REMOTE, branch='master',
                          authorName='DcElysion Memos Bot', authorEmail='memos-publisher@users.noreply.github.com',
                          settleMs=10000, withdrawalPolicy='eventual-current-site-operator-accepted',
                          sync=dict(instanceId='memos-production-20261020', baseUrl='http://127.0.0.1:5231',
                                    creator='users/dcelysion', timezone='Asia/Shanghai', outputRoot='/checkout',
                                    stateDir='/private', tokenFile='/private/pat', publish=False))
            save(PRIVATE/'config.json', json.dumps(config, indent=2))
        for file in TOOLS.rglob('*'):
            if file.is_file() and file.name != 'run-publisher.sh':
                file.chmod(0o644)
            elif file.is_dir():
                file.chmod(0o755)
            os.chown(file, 1000, 1000)
        run('docker', 'build', '--pull=false', '--network=host', '-t', IMAGE,
            '-f', str(TOOLS/'Dockerfile.publisher'), str(TOOLS))
        unit = '''[Unit]
Description=DcElysion Memos serialized public publisher
After=network-online.target docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStartPre=+/usr/bin/python3 /opt/dcelysion-memos/production-setup.py refresh-origin
ExecStart=/opt/dcelysion-memos-publisher-tools/run-publisher.sh
ExecStopPost=/opt/dcelysion-memos-publisher-tools/run-publisher.sh --service-stop
TimeoutStartSec=32min
UMask=0077
'''
        save(Path('/etc/systemd/system/dc-memos-publish.service'), unit, 0o644, 0)
        save(Path('/etc/systemd/system/dc-memos-publish.timer'), '''[Unit]
Description=Check public Memos every 60 seconds after completed publication
[Timer]
OnBootSec=60s
OnUnitInactiveSec=60s
AccuracySec=1s
Unit=dc-memos-publish.service
[Install]
WantedBy=timers.target
''', 0o644, 0)
        run('systemctl', 'daemon-reload')
        run('systemctl', 'disable', '--now', 'dc-memos-publish.timer')
        container('--help')
        container('--config', '/private/config.json')
        print(json.dumps({'status': 'prepared-disabled', 'privateState': str(PRIVATE), 'tools': str(TOOLS)}))
    elif action == 'clone':
        assert not (CHECKOUT/'.git').exists(), 'Existing checkout must be inspected'
        ssh = 'ssh -i /private/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/private/known_hosts -o BatchMode=yes'
        container('-c', 'core.sshCommand=' + ssh, 'clone', '--single-branch', '--branch', 'master', REMOTE, '/checkout', entrypoint='git')
        container('-C', '/checkout', 'config', '--local', 'core.sshCommand', ssh, entrypoint='git')
        container('-C', '/checkout', 'config', '--local', 'memos.publisher', 'true', entrypoint='git')
        print(json.dumps({'status': 'cloned', 'checkout': str(CHECKOUT)}))
    elif action == 'enable':
        config = json.loads((PRIVATE/'config.json').read_text())
        assert (CHECKOUT/'.git').is_dir()
        config['enabled'] = True
        save(PRIVATE/'config.json', json.dumps(config, indent=2))
        if '--timer' in sys.argv:
            run('systemctl', 'enable', '--now', 'dc-memos-publish.timer')
        print(json.dumps({'status': 'enabled', 'timer': '--timer' in sys.argv}))
    else:
        raise RuntimeError('Use prepare <source>, clone, or enable [--timer]')


if __name__ == '__main__':
    main()
