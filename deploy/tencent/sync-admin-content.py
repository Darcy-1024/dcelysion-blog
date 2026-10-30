#!/usr/bin/env python3
"""Refresh the admin's public content snapshot from the live blog revision.

No Git credentials, repository code execution, private DB access or publisher
checkout access. Linux operator tool; all mutations are confined to the content
snapshot and this tool's dedicated state directory.
"""
import fcntl
import hashlib
import http.client
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
import urllib.parse

ROOT = Path('/opt/dcelysion-admin-stage2')
CONTENT = ROOT / 'repository/src/content'
STATE = ROOT / 'operator/content-sync'
CONTAINER = 'dc-admin-formal'
VERSION = 'https://blog.dcelysion.cn/__route/version.json'
TREE = 'https://api.github.com/repos/Darcy-1024/dcelysion-blog/git/trees/'
CDN = 'https://cdn.jsdelivr.net/gh/Darcy-1024/dcelysion-blog@'
BLOB = 'https://api.github.com/repos/Darcy-1024/dcelysion-blog/git/blobs/'


def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, timeout=120,
                          **kwargs).stdout


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def fetch(url, accept='*/*'):
    return urllib.request.urlopen(urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity', 'Accept': accept,
    }), timeout=30)


def live_revision():
    with fetch(VERSION) as response:
        data = response.read(8193)
    if len(data) > 8192:
        raise RuntimeError('Version response too large')
    version = json.loads(data)
    revision = version.get('sourceRevision', '')
    if (not re.fullmatch('[a-f0-9]{40}', revision)
            or version.get('deploymentEligible') is not True
            or version.get('buildProvenance') != 'github-actions'):
        raise RuntimeError('Untrusted public release provenance')
    return revision


def inventory(folder):
    if folder.is_symlink() or not folder.is_dir():
        raise RuntimeError('Content must be a real directory')
    result = {}
    for path in sorted(folder.rglob('*')):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise RuntimeError('Special content file refused')
        if path.is_file():
            result[path.relative_to(folder).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def git_hash(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def read_tree(revision, recursive=False):
    with fetch(TREE + revision + ('?recursive=1' if recursive else '')) as response:
        data = response.read(8 * 1024**2 + 1)
    if len(data) > 8 * 1024**2:
        raise RuntimeError('Git tree response too large')
    tree = json.loads(data)
    if tree.get('truncated') is not False or not isinstance(tree.get('tree'), list):
        raise RuntimeError('Incomplete Git tree')
    return tree['tree']


def content_tree(revision):
    # Descend first: the full repository tree is unnecessarily large.
    for name in ('src', 'content'):
        entries = [e for e in read_tree(revision) if e.get('path') == name]
        if (len(entries) != 1 or entries[0].get('type') != 'tree'
                or entries[0].get('mode') != '040000'
                or not re.fullmatch('[a-f0-9]{40}', entries[0].get('sha', ''))):
            raise RuntimeError('Missing content tree')
        revision = entries[0]['sha']
    return read_tree(revision, recursive=True)


def download_blob(revision, path, size, digest):
    # raw.githubusercontent.com is unreliable on this host. A CDN is only a
    # transport: accept bytes solely if they match the official Git tree hash.
    urls = [(CDN + revision + '/' + urllib.parse.quote(path, safe='/'), '*/*'),
            (BLOB + digest, 'application/vnd.github.raw+json')]
    for url, accept in urls:
        try:
            with fetch(url, accept=accept) as response:
                body = response.read(size + 1)
            if len(body) == size and git_hash(body) == digest:
                return body
        except (OSError, http.client.HTTPException):
            pass
        print('Blob transport failed: ' + urllib.parse.urlsplit(url).hostname, flush=True)
    raise RuntimeError('Content blob integrity mismatch or download failure: ' + path)


def prepare(revision, destination):
    """Use the immutable Git tree; fetch only changed public content blobs."""
    entries = content_tree(revision)
    destination.mkdir()
    total = 0
    seen = set()
    downloaded = 0
    for entry in entries:
        relative = entry.get('path', '')
        path = 'src/content/' + relative
        if any(p in ('', '.', '..') or '\\' in p or '\0' in p for p in relative.split('/')):
            raise RuntimeError('Unsafe content path')
        if entry.get('type') == 'tree':
            continue
        size, digest = entry.get('size'), entry.get('sha', '')
        if (entry.get('type') != 'blob' or entry.get('mode') not in ('100644', '100755')
                or not isinstance(size, int) or size < 0
                or not re.fullmatch('[a-f0-9]{40}', digest) or path in seen):
            raise RuntimeError('Unsafe content blob')
        seen.add(path)
        total += size
        if len(seen) > 10000 or size > 32 * 1024**2 or total > 256 * 1024**2:
            raise RuntimeError('Content size limit exceeded')
        source = CONTENT / relative
        if source.is_symlink():
            raise RuntimeError('Symlink in existing content')
        body = source.read_bytes() if source.is_file() else b''
        if len(body) != size or git_hash(body) != digest:
            print('Downloading ' + path, flush=True)
            body = download_blob(revision, path, size, digest)
            downloaded += 1
        if len(body) != size or git_hash(body) != digest:
            raise RuntimeError('Content blob integrity mismatch: ' + path)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        target.chmod(0o644)
    if not (destination / 'posts').is_dir() or not (destination / 'dynamic').is_dir():
        raise RuntimeError('Missing content collections')
    # systemd UMask protects operator state; the unprivileged app needs content.
    destination.chmod(0o755)
    for path in destination.rglob('*'):
        if path.is_dir():
            path.chmod(0o755)
    print(f'Prepared {len(seen)} files; downloaded {downloaded} changed blobs', flush=True)


def validate(folder):
    image = run('docker', 'inspect', CONTAINER, '--format', '{{.Image}}').decode().strip()
    output = run('docker', 'run', '--rm', '--network', 'none', '--read-only',
                 '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                 '--user', '1000:1000', '--memory', '256m', '--pids-limit', '64',
                 '--mount', f'type=bind,src={folder},dst=/snapshot/src/content,readonly',
                 '--mount', f'type=bind,src={STATE / "validate.cjs"},dst=/validate.cjs,readonly',
                 '--entrypoint', 'node', image, '/validate.cjs', '/snapshot')
    return json.loads(output)


def healthy():
    # Admin has no host port mapping; probe loopback inside its container.
    for attempt in range(20):
        try:
            run('docker', 'exec', CONTAINER, 'node', '-e',
                "require('node:http').get({host:'127.0.0.1',port:process.env.ADMIN_PORT||4322,"
                "path:'/api/status',headers:{Host:new URL(process.env.ADMIN_ORIGIN).host}},r=>{"
                "let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{"
                "if(r.statusCode!==200||JSON.parse(b).data?.configured!==true)process.exit(1)"
                "}catch{process.exit(1)}})}).on('error',()=>process.exit(1))"
                ".setTimeout(3000,function(){this.destroy()})")
            return
        except subprocess.SubprocessError:
            pass
        time.sleep(1)
    raise RuntimeError('Admin did not become ready')


def recover():
    pending = STATE / 'pending.json'
    if not pending.exists():
        return
    transaction = json.loads(pending.read_text())
    backup = STATE / transaction['backup']
    if backup.parent != STATE or not re.fullmatch(r'backup-\d+', backup.name) or backup.is_symlink():
        raise RuntimeError('Invalid recovery path')
    run('docker', 'stop', '--time', '20', CONTAINER)
    if backup.exists():
        if CONTENT.exists():
            # Move aside rather than delete interrupted input.
            CONTENT.rename(STATE / ('failed-' + str(time.time_ns())))
        backup.rename(CONTENT)
    run('docker', 'start', CONTAINER)
    healthy()
    if transaction.get('record'):
        write_json(STATE / 'current.json', transaction['record'])
    else:
        (STATE / 'current.json').unlink(missing_ok=True)
    pending.unlink()
    print('Recovered previous content snapshot', flush=True)


def synchronize():
    recover()
    revision = live_revision()
    current = inventory(CONTENT)
    record_path = STATE / 'current.json'
    record = json.loads(record_path.read_text()) if record_path.exists() else {}
    if record.get('revision') == revision and record.get('files') == current:
        print('Already synchronized: ' + revision, flush=True)
        return
    # A manifest mismatch is not permission to overwrite unexpected host edits.
    if record and record.get('files') != current:
        raise RuntimeError('Content changed outside synchronizer; refusing overwrite')
    with tempfile.TemporaryDirectory(prefix='prepare-', dir=STATE) as directory:
        work = Path(directory)
        candidate = work / 'content'
        prepare(revision, candidate)
        files = inventory(candidate)
        report = validate(candidate)
        if live_revision() != revision or inventory(CONTENT) != current:
            raise RuntimeError('Source changed during preparation; retry next run')
        if files != current:
            backup = STATE / ('backup-' + str(time.time_ns()))
            write_json(STATE / 'pending.json', {'backup': backup.name, 'record': record})
            try:
                run('docker', 'stop', '--time', '20', CONTAINER)
                CONTENT.rename(backup)
                candidate.rename(CONTENT)
                run('docker', 'start', CONTAINER)
                healthy()
                if inventory(CONTENT) != files:
                    raise RuntimeError('Installed content manifest mismatch')
                # The same parser checks what the running container can see.
                installed = json.loads(run('docker', 'exec', '-i', CONTAINER,
                                          'node', '-', '/app/repository',
                                          input=(STATE / 'validate.cjs').read_bytes()))
                if installed != report:
                    raise RuntimeError('Container still sees a different snapshot')
                write_json(record_path, {'revision': revision, 'files': files})
                (STATE / 'pending.json').unlink()
            except BaseException:
                recover()
                raise
        else:
            write_json(record_path, {'revision': revision, 'files': files})
        # Only this tool's timestamped backups; retain the latest three.
        for old in sorted(STATE.glob('backup-*'), reverse=True)[3:]:
            if old.parent == STATE and re.fullmatch(r'backup-\d+', old.name) and not old.is_symlink():
                shutil.rmtree(old)
        print(json.dumps({'revision': revision, 'posts': report['posts']['total'],
                          'dynamic': report['dynamic']['total']}, ensure_ascii=False), flush=True)


def main():
    # Content itself may be absent in the rename/crash window: recover first.
    if CONTENT.is_symlink() or CONTENT.parent.resolve(strict=True) != CONTENT.parent:
        raise RuntimeError('Unexpected content root')
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE / 'sync.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        synchronize()


if __name__ == '__main__':
    main()
