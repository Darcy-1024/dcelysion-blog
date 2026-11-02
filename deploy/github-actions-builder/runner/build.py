"""Prepare trusted dependencies, then run untrusted content without network/secrets."""
from pathlib import Path
import shutil
import subprocess
import tarfile

root = Path.cwd()
source = root / 'job-input.tar.gz'
dependencies = ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml')
found = set()
count = total = 0
with tarfile.open(source, 'r:gz') as archive:
    for entry in archive:
        count += 1
        total += entry.size
        assert count <= 30000 and 0 <= entry.size and total <= 1024**3
        name = entry.name.removeprefix('./')
        if name in dependencies:
            assert entry.isfile() and name not in found and entry.size < 4 * 1024**2
            found.add(name)
            assert archive.extractfile(entry).read() == (root / 'dependencies' / name).read_bytes()
assert found == set(dependencies)
# The build context contains only operator-owned dependencies and runner code.
subprocess.run(['docker', 'build', '-q', '-t', 'dc-private-build', '-f', 'runner/Dockerfile', '.'], check=True)
image = subprocess.check_output(['docker', 'image', 'inspect', 'dc-private-build', '--format', '{{.Id}}'], text=True).strip()
assert image.startswith('sha256:') and len(image) == 71
output = root / 'output'
output.mkdir()
artifact = output / 'artifact.tar.gz'
with source.open('rb') as stdin, artifact.open('xb') as stdout:
    result = subprocess.run([
        'docker', 'run', '--rm', '-i', '--network', 'none', '--read-only',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--user', '1000:1000', '--memory', '4g', '--memory-swap', '4g',
        '--cpus', '2', '--pids-limit', '256',
        '--tmpfs', '/work:rw,nosuid,nodev,size=2g,uid=1000,gid=1000,mode=0700',
        '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=0700',
        '-e', 'ASTRO_TELEMETRY_DISABLED=1',
        '-e', 'PUBLIC_COMMENT_PROVIDER=waline',
        '-e', 'PUBLIC_WALINE_SERVER_URL=https://comments.dcelysion.cn',
        image,
    ], stdin=stdin, stdout=stdout, stderr=subprocess.DEVNULL, timeout=1200)
if result.returncode:
    artifact.unlink(missing_ok=True)
    raise RuntimeError('PRIVATE_BUILD_FAILED')
assert artifact.stat().st_size <= 1024**3
validated = root / 'validated-output'
validated.mkdir()
subprocess.run(['python3', 'runner/extract-artifact.py', str(artifact), str(validated)], check=True)
assert (validated / 'index.html').is_file()
shutil.rmtree(validated)
source.unlink()
