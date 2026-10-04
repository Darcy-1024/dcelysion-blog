#!/usr/bin/env python3
"""Narrow JSON/stdin endpoint for an already provisioned Tencent static site.

Install at /usr/local/libexec/dcelysion-admin-release, root-owned and not writable
by the SSH uploader. Configure a restricted sudo rule for this exact executable.
Never change Nginx, DNS, Git history or system services here.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path('/srv/dcelysion')
RELEASES = ROOT / 'releases'
PACKAGES = ROOT / 'admin-packages'
INCOMING = ROOT / 'admin-incoming'
VERIFIER = Path('/usr/local/libexec/verify-static-release.py')


def digest_file(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def release_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{8}-[a-f0-9]{12}', value):
        raise ValueError('RELEASE_ID')
    return value


def digest(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value):
        raise ValueError('DIGEST')
    return value


def current():
    link = ROOT / 'current'
    if not link.is_symlink():
        if link.exists():
            raise ValueError('CURRENT_TYPE')
        return None
    target = link.resolve(strict=True)
    if target.parent != RELEASES.resolve(strict=True):
        raise ValueError('CURRENT_PATH')
    return release_id(target.name)


def manifest(root):
    if root.is_symlink():
        raise ValueError('RELEASE_PATH')
    result = {}
    for item in sorted(root.rglob('*')):
        if item.is_symlink() or not (item.is_dir() or item.is_file()):
            raise ValueError('ARTIFACT_PATH')
        if item.is_file() and item.name not in ('.release-sha256', '.release-files.json'):
            result[item.relative_to(root).as_posix()] = digest_file(item)
    return result


def essentials(folder):
    spec = importlib.util.spec_from_file_location('release_verifier', VERIFIER)
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    # The protocol's stdout must contain JSON only.
    import contextlib
    with contextlib.redirect_stdout(sys.stderr):
        verifier.verify(folder)


def verify(identifier):
    folder = RELEASES / release_id(identifier)
    if folder.is_symlink() or folder.resolve(strict=True).parent != RELEASES.resolve(strict=True):
        raise ValueError('RELEASE_PATH')
    sha = digest((folder / '.release-sha256').read_text().strip())
    archive = PACKAGES / (sha + '.tar.gz')
    if archive.is_symlink() or digest_file(archive) != sha or identifier[-12:] != sha[:12]:
        raise ValueError('PACKAGE_DIGEST')
    with tarfile.open(archive) as package:
        recorded = {}
        for item in package.getmembers():
            name = item.name.removeprefix('./')
            if item.isdir():
                continue
            if not item.isfile() or Path(name).is_absolute() or '..' in Path(name).parts:
                raise ValueError('PACKAGE_PATH')
            recorded[name] = hashlib.sha256(package.extractfile(item).read()).hexdigest()
    if manifest(folder) != recorded:
        raise ValueError('RELEASE_DIGEST')
    essentials(folder)
    return sha


def activate(identifier, expected):
    verify(identifier)
    if current() != expected:
        raise ValueError('RELEASE_CONFLICT')
    receipt = ROOT / '.admin-release-receipt.json'
    atomic_json(receipt, {'previous': expected, 'target': identifier, 'status': 'switching'})
    link = ROOT / '.current.admin-next'
    if link.exists() or link.is_symlink():
        link.unlink()
    link.symlink_to(RELEASES / identifier)
    os.replace(link, ROOT / 'current')
    fsync_dir(ROOT)
    atomic_json(receipt, {'previous': expected, 'target': identifier, 'status': 'complete'})


def fsync_dir(folder):
    descriptor = os.open(folder, os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_json(path, value):
    temporary = path.with_name(path.name + '.next')
    with temporary.open('w') as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fsync_dir(path.parent)


def execute(data):
    action = data.get('action')
    if action == 'incoming':
        # Directory ownership is configured by the operator, never by this endpoint.
        digest(data.get('digest'))
        if not INCOMING.is_dir() or INCOMING.is_symlink():
            raise ValueError('INCOMING_NOT_CONFIGURED')
        return {'ok': True}
    if action == 'install':
        sha = digest(data.get('digest'))
        identifier = release_id(data.get('id'))
        if identifier[-12:] != sha[:12]:
            raise ValueError('RELEASE_DIGEST')
        uploaded = INCOMING / (sha + '.tar.gz')
        # Read only from a fixed uploader directory; symlinks and non-regular files fail.
        import stat
        descriptor = os.open(uploaded, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_size > 512 * 1024 * 1024:
                raise ValueError('PACKAGE_SIZE')
            with os.fdopen(os.dup(descriptor), 'rb') as source:
                private = PACKAGES / (sha + '.tar.gz.next')
                with private.open('wb') as destination:
                    shutil.copyfileobj(source, destination)
                    destination.flush()
                    os.fsync(destination.fileno())
        finally:
            os.close(descriptor)
        if digest_file(private) != sha:
            private.unlink()
            raise ValueError('PACKAGE_DIGEST')
        os.replace(private, PACKAGES / (sha + '.tar.gz'))
        folder = RELEASES / identifier
        if not folder.exists():
            stage = Path(tempfile.mkdtemp(prefix='.admin-stage-', dir=RELEASES))
            try:
                with tarfile.open(PACKAGES / (sha + '.tar.gz')) as package:
                    members = package.getmembers()
                    if len(members) > 30000 or sum(item.size for item in members) > 512 * 1024 * 1024:
                        raise ValueError('ARTIFACT_LIMIT')
                    for item in members:
                        name = Path(item.name)
                        if not (item.isdir() or item.isfile()) or name.is_absolute() or '..' in name.parts or any(part.startswith('.env') or part in ('.git', 'admin', 'private-db') for part in name.parts):
                            raise ValueError('PACKAGE_PATH')
                    package.extractall(stage, filter='data')
                essentials(stage)
                (stage / '.release-sha256').write_text(sha + '\n')
                for item in stage.rglob('*'):
                    item.chmod(0o755 if item.is_dir() else 0o644)
                stage.chmod(0o755)
                os.replace(stage, folder)
                fsync_dir(RELEASES)
            finally:
                if stage.exists():
                    shutil.rmtree(stage)
        verify(identifier)
        if current() != identifier:
            activate(identifier, data.get('expected'))
        return {'ok': True, 'current': current()}
    if action == 'rollback':
        activate(release_id(data.get('id')), data.get('expected'))
        return {'ok': True, 'current': current()}
    if action == 'list':
        active = current()
        releases = []
        for item in sorted(RELEASES.iterdir(), reverse=True):
            if re.fullmatch(r'\d{8}-[a-f0-9]{12}', item.name):
                # Older installer releases lack retained packages. Show only verified targets.
                if (item / '.release-sha256').is_file() and (PACKAGES / ((item / '.release-sha256').read_text().strip() + '.tar.gz')).is_file():
                    releases.append({'id': item.name, 'digest': verify(item.name), 'current': item.name == active})
        return {'ok': True, 'current': active, 'releases': releases}
    raise ValueError('ACTION')


if __name__ == '__main__':
    try:
        data = json.loads(sys.stdin.buffer.read(4097))
        if not isinstance(data, dict):
            raise ValueError('INPUT')
        for folder in (ROOT, RELEASES, PACKAGES):
            if folder.is_symlink():
                raise ValueError('ROOT_PATH')
            folder.mkdir(exist_ok=True)
        with (ROOT / '.install-staging.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(execute(data)))
    except Exception:
        # Never return paths, SSH output, environment or source text to clients.
        print(json.dumps({'ok': False, 'error': 'RELEASE_FAILED'}))
        sys.exit(1)
