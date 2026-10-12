#!/usr/bin/env python3
"""Copy reviewed, ALREADY PUBLIC release images to immutable R2 and Tencent keys.

Only explicitly supplied inventory members are consumed; archives, credentials,
private content and operator reports are never uploaded to a public bucket.
"""
import argparse
import hashlib
import json
import os
import pathlib
import tarfile
import urllib.request
from public_r2_plan import credentials, signed_request

MIME = {'.avif': 'image/avif', '.webp': 'image/webp', '.png': 'image/png',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.svg': 'image/svg+xml', '.ico': 'image/x-icon'}

def main():
    p = argparse.ArgumentParser()
    p.add_argument('inventory')
    p.add_argument('archive')
    p.add_argument('--archive-sha256', required=True)
    p.add_argument('--revision', required=True)
    p.add_argument('--root', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()
    assert len(args.revision) == 40 and all(c in '0123456789abcdef' for c in args.revision)
    archive_path = pathlib.Path(args.archive)
    sha = hashlib.sha256()
    with archive_path.open('rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            sha.update(chunk)
    assert sha.hexdigest() == args.archive_sha256
    inventory = json.loads(pathlib.Path(args.inventory).read_text())
    assert inventory['source'] == 'verified-published-release'
    root = pathlib.Path(args.root).resolve(strict=True)
    endpoint, access, secret = credentials()
    previous = pathlib.Path(args.output)
    plan = json.loads(previous.read_text()) if previous.exists() else {'version': 1, 'objects': [], 'excluded': []}
    existing = {o['alias']: o for o in plan['objects']}
    with tarfile.open(archive_path, 'r:gz') as archive:
        for item in inventory['objects']:
            if item['status'] != 'published-local':
                continue
            alias = '/' + item['key']
            if alias in existing:
                continue
            member = archive.getmember('cloudflare/assets/' + item['key'])
            assert member.isfile() and member.size == item['size']
            local_key = 'verified/' + item['sha256'] + '/' + pathlib.PurePosixPath(item['key']).name
            target = root / local_key
            assert target.resolve().is_relative_to(root)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, target.with_suffix('.part').open('wb') as dest:
                checksum = hashlib.sha256()
                for chunk in iter(lambda: source.read(65536), b''):
                    dest.write(chunk)
                    checksum.update(chunk)
            assert checksum.hexdigest() == item['sha256']
            os.replace(target.with_suffix('.part'), target)
            target.chmod(0o644)
            mime = MIME[target.suffix.lower()]
            key = 'site-assets/' + item['sha256'] + '/' + target.name
            with target.open('rb') as data:
                # Bounded one-image upload; the largest approved release image is <18MB.
                payload = data.read()
            assert len(payload) == item['size'] and len(payload) < 18874368
            with signed_request(endpoint, access, secret, 'PUT', 'dcelysion-admin-public', key, data=payload, mime=mime) as response:
                assert response.status == 200
            del payload
            url = 'https://admin-media.dcelysion.cn/' + key
            request = urllib.request.Request(url, method='HEAD', headers={'Origin': 'https://blog.dcelysion.cn', 'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(request, timeout=60) as head:
                assert int(head.headers['Content-Length']) == item['size'] and head.headers.get_content_type() == mime
                etag = head.headers.get('ETag', '').strip('"')
            obj = {'purpose': 'article', 'key': key, 'localKey': local_key,
                   'url': url, 'size': item['size'], 'sha256': item['sha256'], 'mime': mime,
                   'etag': etag, 'alias': alias, 'aliasRevision': args.revision}
            plan['objects'].append(obj)
            previous.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n')
            previous.chmod(0o600)
            print(json.dumps({'localPrepared': len(plan['objects']), 'total': sum(i['status'] == 'published-local' for i in inventory['objects']), 'alias': alias}), flush=True)
    plan['scannedRevision'] = args.revision
    previous.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    main()
