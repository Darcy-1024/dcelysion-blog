#!/usr/bin/env python3
"""Explicit public-only plan -> streamed immutable copies and private receipts.

Does not activate an index, modify budgets, publish private uploads or invoke MDX.
Run under an operator-owned directory with a reviewed JSON plan.
"""
import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import shutil
import time
import urllib.parse
import urllib.request

HOSTS = {'admin-media.dcelysion.cn', 'gallery.dcelysion.cn',
         'wallpapers.dcelysion.cn', 'music.dcelysion.cn', 'blog.dcelysion.cn'}

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()

def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.chmod(0o600)
    os.replace(temporary, path)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('plan')
    parser.add_argument('--root', required=True)
    parser.add_argument('--receipts', required=True)
    parser.add_argument('--bytes-per-second', type=int, default=2097152)
    parser.add_argument('--s3-source', action='store_true')
    args = parser.parse_args()
    root = pathlib.Path(args.root).resolve(strict=True)
    receipt_path = pathlib.Path(args.receipts)
    lock = receipt_path.with_suffix('.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    plan = json.loads(pathlib.Path(args.plan).read_text())
    objects = plan['objects']
    assert plan['version'] == 1 and 16384 <= args.bytes_per_second <= 2097152
    assert shutil.disk_usage(root).free > sum(o['size'] for o in objects) + 1073741824
    seen = set()
    for obj in objects:
        url = urllib.parse.urlsplit(obj['url'])
        assert url.scheme == 'https' and url.hostname in HOSTS and not url.username
        assert not url.query and not url.fragment
        assert obj['purpose'] in ('article', 'gallery', 'wallpaper', 'music')
        assert isinstance(obj['size'], int) and obj['size'] > 0
        assert obj['mime'].startswith(('image/', 'audio/', 'video/', 'text/'))
        assert not obj['key'].startswith(('admin-runtime-it/', 'stage3-validation/'))
        assert obj['localKey'] not in seen
        seen.add(obj['localKey'])
        parts = pathlib.PurePosixPath(obj['localKey']).parts
        assert parts and not obj['localKey'].startswith('/') and '..' not in parts
    previous = json.loads(receipt_path.read_text()) if receipt_path.exists() else {'objects': []}
    receipts = {o['url']: o for o in previous['objects']}
    if args.s3_source:
        from public_r2_plan import credentials, signed_request, DESTINATIONS
        endpoint, access, secret = credentials()
    failures = []
    for index, obj in enumerate(objects):
        try:
            old = receipts.get(obj['url'])
            if old and old['size'] == obj['size'] and old.get('etag') == obj.get('etag'):
                target = (root / old['localKey']).resolve()
                assert target.is_relative_to(root)
                if target.is_file() and target.stat().st_size == obj['size'] and digest(target) == old['sha256']:
                    continue
            duplicate = next((o for o in receipts.values() if o.get('etag') == obj.get('etag')
                and len(o.get('etag', '')) == 32 and o['size'] == obj['size'] and o['mime'] == obj['mime']), None)
            if duplicate:
                target = (root / duplicate['localKey']).resolve(strict=True)
                assert target.is_relative_to(root) and target.stat().st_size == obj['size'] and digest(target) == duplicate['sha256']
                with urllib.request.urlopen(urllib.request.Request(obj['url'], method='HEAD', headers={
                        'Origin': 'https://blog.dcelysion.cn', 'User-Agent': 'Mozilla/5.0'}), timeout=60) as head:
                    assert head.status == 200 and int(head.headers['Content-Length']) == obj['size']
                    assert head.headers.get_content_type() == obj['mime'] and head.headers.get('ETag', '').strip('"') == obj['etag']
                receipts[obj['url']] = {**obj, 'sha256': duplicate['sha256'], 'localKey': duplicate['localKey'],
                    'evidence': 'verified-single-part-etag-dedup-and-public-head'}
                atomic_json(receipt_path, {'version': 1, 'objects': list(receipts.values()), 'failures': failures})
                print(json.dumps({'completed': index + 1, 'total': len(objects), 'deduplicated': obj['key']}), flush=True)
                continue
            request = urllib.request.Request(obj['url'], headers={
                'Accept-Encoding': 'identity', 'User-Agent': 'Mozilla/5.0',
                'Origin': 'https://blog.dcelysion.cn'})
            if args.s3_source:
                bucket = next(b for b, (purpose, host) in DESTINATIONS.items() if purpose == obj['purpose'])
                source = signed_request(endpoint, access, secret, 'GET', bucket, obj['key'])
            else:
                source = urllib.request.urlopen(request, timeout=90)
            with source as response:
                assert response.status == 200
                if not args.s3_source:
                    assert response.url == obj['url']
                assert response.headers.get_content_type() == obj['mime']
                assert int(response.headers['Content-Length']) == obj['size']
                etag = response.headers.get('ETag', '').strip('"')
                if obj.get('etag'):
                    assert etag == obj['etag'], 'source changed after inventory'
                temporary = root / ('.sync-' + hashlib.sha256(obj['url'].encode()).hexdigest() + '.partial')
                assert not temporary.is_symlink()
                sha = hashlib.sha256()
                size = 0
                started = time.monotonic()
                with temporary.open('wb') as stream:
                    for chunk in iter(lambda: response.read(65536), b''):
                        size += len(chunk)
                        assert size <= obj['size']
                        sha.update(chunk)
                        stream.write(chunk)
                        wait = size / args.bytes_per_second - (time.monotonic() - started)
                        if wait > 0:
                            time.sleep(wait)
                assert size == obj['size']
                checksum = sha.hexdigest()
                if obj.get('sha256'):
                    assert checksum == obj['sha256']
                target = root / 'verified' / checksum / pathlib.PurePosixPath(obj['key']).name
                target.parent.mkdir(parents=True, exist_ok=True)
                assert target.resolve().is_relative_to(root) and not target.is_symlink()
                if target.exists():
                    assert digest(target) == checksum
                    temporary.unlink()
                else:
                    temporary.chmod(0o644)
                    os.replace(temporary, target)
                assert target.stat().st_size == size and digest(target) == checksum
                if args.s3_source:
                    public_head = urllib.request.Request(obj['url'], method='HEAD', headers={
                        'User-Agent': 'Mozilla/5.0', 'Origin': 'https://blog.dcelysion.cn'})
                    with urllib.request.urlopen(public_head, timeout=60) as head:
                        assert head.status == 200 and int(head.headers['Content-Length']) == size
                        assert head.headers.get_content_type() == obj['mime']
                        assert head.headers.get('ETag', '').strip('"') == etag
                receipts[obj['url']] = {**obj, 'sha256': checksum, 'etag': etag,
                    'evidence': 's3-complete-get-and-public-head' if args.s3_source else 'public-complete-get',
                    'localKey': target.relative_to(root).as_posix(), 'verifiedAtUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
                atomic_json(receipt_path, {'version': 1, 'objects': list(receipts.values()), 'failures': failures})
                print(json.dumps({'completed': index + 1, 'total': len(objects), 'key': obj['key'], 'size': size}), flush=True)
        except Exception as error:
            failures.append({'url': obj['url'], 'error': type(error).__name__ + ': ' + str(error)})
            atomic_json(receipt_path, {'version': 1, 'objects': list(receipts.values()), 'failures': failures})
            print(json.dumps(failures[-1]), flush=True)
    atomic_json(receipt_path, {'version': 1, 'objects': list(receipts.values()), 'failures': failures})
    return 1 if failures else 0

if __name__ == '__main__':
    raise SystemExit(main())
