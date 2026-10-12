#!/usr/bin/env python3
"""Import existing public local copies matching the inventoried single-part R2 ETag.

No download into the operator PC. Evidence remains explicit: MD5/ETag match and
size/MIME HEAD, plus independently checked local SHA, not a public complete GET.
"""
import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import tarfile
import time
import urllib.request
from sync_public_media import atomic_json, digest

p = argparse.ArgumentParser()
p.add_argument('plan')
p.add_argument('archive')
p.add_argument('--root', required=True)
p.add_argument('--receipts', required=True)
args = p.parse_args()
root = pathlib.Path(args.root).resolve(strict=True)
receipt_path = pathlib.Path(args.receipts)
lock = receipt_path.with_suffix('.lock').open('w')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
records = json.loads(receipt_path.read_text())
receipts = {o['url']: o for o in records['objects']}
plan = json.loads(pathlib.Path(args.plan).read_text())
with tarfile.open(args.archive) as archive:
    for obj in plan['objects']:
        member = archive.getmember(obj['archiveMember'])
        assert member.isfile() and member.size == obj['size']
        assert obj['purpose'] in ('article', 'gallery', 'wallpaper', 'music')
        assert len(obj['etag']) == 32 and all(c in '0123456789abcdef' for c in obj['etag'])
        target = root / 'verified' / obj['sha256'] / pathlib.PurePosixPath(obj['key']).name
        assert target.resolve().is_relative_to(root)
        target.parent.mkdir(parents=True, exist_ok=True)
        md5 = hashlib.md5()
        sha = hashlib.sha256()
        temporary = target.with_suffix('.import-partial')
        with archive.extractfile(member) as source, temporary.open('wb') as output:
            for chunk in iter(lambda: source.read(65536), b''):
                md5.update(chunk)
                sha.update(chunk)
                output.write(chunk)
        assert md5.hexdigest() == obj['etag'] and sha.hexdigest() == obj['sha256']
        req = urllib.request.Request(obj['url'], method='HEAD', headers={'User-Agent': 'Mozilla/5.0', 'Origin': 'https://blog.dcelysion.cn'})
        with urllib.request.urlopen(req, timeout=60) as head:
            assert head.status == 200 and int(head.headers['Content-Length']) == obj['size']
            assert head.headers.get_content_type() == obj['mime']
            assert head.headers.get('ETag', '').strip('"') == obj['etag']
        if target.exists():
            assert digest(target) == obj['sha256']
            temporary.unlink()
        else:
            temporary.chmod(0o644)
            os.replace(temporary, target)
        assert digest(target) == obj['sha256']
        receipts[obj['url']] = {k: v for k, v in obj.items() if k not in ('file', 'archiveMember')}
        receipts[obj['url']].update({'localKey': target.relative_to(root).as_posix(),
            'evidence': 'cached-single-part-md5-etag-and-public-head',
            'verifiedAtUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
        atomic_json(receipt_path, {'version': 1, 'objects': list(receipts.values()), 'failures': records.get('failures', [])})
        print(json.dumps({'cachedImported': obj['key'], 'size': obj['size']}), flush=True)
