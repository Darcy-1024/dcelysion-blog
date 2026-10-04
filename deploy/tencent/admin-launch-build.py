"""Trusted admin build only; no MDX, publishing credentials, or production switch."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path('/home/ubuntu/dc-admin-private-20261002')
work = Path('/home/dc-builder/admin-launch-20261004')
assert (root / 'OWNER').read_text().strip() == 'dc-admin-private-integration-20261002'
incoming = root / 'launch-20261004'
image = 'sha256:7d80192eb45362b46bc601b7ef5243cb772ae456f8a48b8d3fa034c4de8c9210'
docker = ['sudo', '-n', '-u', 'dc-builder', 'docker', '--host', 'unix:///run/user/1002/docker.sock']
attempt = sys.argv[1] if len(sys.argv) > 1 else '1'
assert attempt in ['1', '2', '3', '4', '5']
name = 'dc-admin-trusted-candidate-20261004-'+attempt
os.umask(0o077)
archives = json.loads((incoming / 'archives.json').read_text())
expected = next(e['sha256'] for e in archives if e['name'] == 'build-input.tar.gz')
assert hashlib.sha256((incoming / 'build-input.tar.gz').read_bytes()).hexdigest() == expected
assert not (incoming / ('build-attempted-'+attempt)).exists(), 'Do not repeat a finished build without new evidence'
available = lambda: int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))
assert available() >= 786432, 'Insufficient headroom for a 512MiB trusted admin build'
reuse = attempt in ['4','5']
if reuse:
    assert 'svelte-check found 0 errors and 0 warnings' in (incoming/'build-3.log').read_text()
    assert (incoming/'build-attempted-3').read_text().strip() == expected
if attempt == '5':
    assert 'built in ' in (incoming/'build-4.log').read_text()
    assert (work/'candidate/admin/server/index.mjs').is_file()
for file in ['build-input.tar.gz', 'build-admin-candidate.mjs']:
    subprocess.run(['sudo', '-n', 'install', '-m', '0600', '-o', 'dc-builder', '-g', 'dc-builder', str(incoming/file), str(work/file)], check=True)
subprocess.run(['sudo', '-n', '-u', 'dc-builder', 'tar', '-xzf', str(work/'build-input.tar.gz'), '-C', str(work)], check=True)
manifest = json.loads((work/'manifest.json').read_text())
for entry in manifest['entries']:
    assert hashlib.sha256((work/entry['path']).read_bytes()).hexdigest() == entry['sha256']
(incoming/('build-attempted-'+attempt)).write_text(expected+'\n')
command = docker + ['run', '-d', '--name', name, '--label', 'dc.task=admin-private-20261002',
    '--network', 'none', '--memory', '512m', '--memory-swap', '768m', '--cpus', '.5', '--pids-limit', '192',
    '--user', '0:0', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/tmp:rw,nosuid,size=64m', '--mount', f'type=bind,source={work},target=/work',
    '--env', 'NODE_OPTIONS=--max-old-space-size='+('320' if reuse else '416'), '--env', 'ASTRO_TELEMETRY_DISABLED=1',
    '--env', 'NODE_ENV=development', '--entrypoint', '/bin/sh', image, '-c',
    'set -eu; cd /work; test -L node_modules || ln -s /opt/blog/node_modules node_modules; node --version; pnpm --version; '
    'node /work/build-admin-candidate.mjs /work /work/candidate '+('--reuse-build' if attempt == '5' else '--reuse-typecheck' if reuse else '')+'; '
    'tar -czf /work/admin-candidate.tar.gz -C /work/candidate .']
subprocess.run(command, check=True, capture_output=True)
deadline = time.monotonic()+900
stopped = None
while True:
    state = json.loads(subprocess.run(docker+['inspect', name, '--format', '{{json .State}}'], check=True, capture_output=True, text=True).stdout)
    if not state['Running']:
        break
    if available() < 393216 or time.monotonic() > deadline:
        stopped = 'host-memory-floor-or-timeout'
        subprocess.run(docker+['stop', '--time', '2', name], check=True, capture_output=True)
    time.sleep(2)
log = subprocess.run(docker+['logs', name], capture_output=True, text=True)
(incoming/('build-'+attempt+'.log')).write_text(log.stdout+log.stderr)
result = {'image': image, 'inputSHA256': expected, 'exitCode': state['ExitCode'], 'oomKilled': state['OOMKilled'], 'stopped': stopped, 'availableKiB': available()}
(incoming/'build-result.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
assert state['ExitCode'] == 0 and not state['OOMKilled'] and not stopped, 'Trusted admin build failed; inspect build.log'
subprocess.run(['sudo', '-n', 'cp', str(work/'admin-candidate.tar.gz'), str(incoming/'admin-candidate.tar.gz')], check=True)
subprocess.run(['sudo', '-n', 'chown', 'ubuntu:ubuntu', str(incoming/'admin-candidate.tar.gz')], check=True)
print(json.dumps({'archiveSHA256': hashlib.sha256((incoming/'admin-candidate.tar.gz').read_bytes()).hexdigest(), 'bytes': (incoming/'admin-candidate.tar.gz').stat().st_size}))
