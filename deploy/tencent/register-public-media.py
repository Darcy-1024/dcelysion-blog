#!/usr/bin/env python3
"""Atomic immutable edge index, delivery verification, then sanitized R2 manifest.

Never restores budget journals. A failed validation restores only the old index.
Full SHA is checked on disk for ALL entries; HTTP GET samples cover each MIME and
size boundary, and all entries receive HEAD/Range metadata delivery checks.
"""
import argparse
import hashlib
import json
import os
import pathlib
import time
import urllib.request
from public_r2_plan import credentials, signed_request
from sync_public_media import digest, atomic_json

ORIGINS = ['https://blog.dcelysion.cn', 'https://blog-eo.dcelysion.cn']
TX = 'https://media-tx.dcelysion.cn/media/objects/'

def request(url, method='HEAD', origin=ORIGINS[0], byte_range=None):
    headers = {'Origin': origin, 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity'}
    if byte_range:
        headers['Range'] = byte_range
    return urllib.request.urlopen(urllib.request.Request(url, method=method, headers=headers), timeout=300)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--receipts', required=True)
    parser.add_argument('--local-plan')
    parser.add_argument('--report', required=True)
    parser.add_argument('--manifest-out', required=True)
    args = parser.parse_args()
    root = pathlib.Path(args.root).resolve(strict=True)
    report_path = pathlib.Path(args.report)
    records = json.loads(pathlib.Path(args.receipts).read_text())['objects']
    local = json.loads(pathlib.Path(args.local_plan).read_text()) if args.local_plan else {'objects': []}
    records += local['objects']
    # Exact URL is immutable. Duplicate bytes across keys remain separate consumers.
    unique = {o['url']: o for o in records}
    aliases = {}
    for obj in records:
        if obj.get('alias'):
            alias = {'url': obj['alias'], 'revision': obj['aliasRevision']}
            if alias not in aliases.setdefault(obj['url'], []):
                aliases[obj['url']].append(alias)
    entries = []
    for obj in unique.values():
        target = (root / obj['localKey']).resolve(strict=True)
        assert target.is_relative_to(root) and not target.is_symlink()
        assert target.stat().st_size == obj['size'] and digest(target) == obj['sha256']
        identity = hashlib.sha256(obj['url'].encode()).hexdigest()[:24]
        entry = {'id': 'public-' + identity, 'variant': 'preview' if '/_previews/' in obj['key'] else 'original',
                 'key': obj['key'], 'localKey': obj['localKey'], 'sha256': obj['sha256'],
                 'size': obj['size'], 'mime': obj['mime'], 'defaultUrl': obj['url'],
                 'sources': {'r2': obj['url'], 'tencent': TX + obj['localKey']}}
        if obj['url'].endswith('covers/nights-crown-of-flowers-e6d348b6.webp'):
            entry['id'] = 'live-music-cover'
        if obj['url'].endswith('/_previews/d20-d30ec649-w1200-dd91e8df.avif'):
            entry['id'] = 'live-gallery-preview'
        if aliases.get(obj['url']):
            entry['aliases'] = sorted(aliases[obj['url']], key=lambda a: (a['revision'], a['url']))
        entries.append(entry)
    entries.sort(key=lambda e: e['sources']['r2'])
    candidate = {'version': 1, 'snapshot': '', 'entries': entries,
                 'capacityUrl': 'https://media-tx.dcelysion.cn/media/capacity',
                 'probe': {'id': 'live-music-cover', 'variant': 'original'}}
    index = root / '.distribution.json'
    previous = index.read_bytes()
    backup = report_path.with_suffix('.index-before.json')
    if not backup.exists():
        backup.write_bytes(previous)
        backup.chmod(0o600)
    # Preserve existing public paths used by already deployed builds and clients.
    old = json.loads(previous)
    for old_entry in old['entries']:
        matching = next((e for e in entries if e['sources']['r2'] == old_entry['sources']['r2']), None)
        if matching and matching['sha256'] == old_entry['sha256']:
            matching['sources']['tencent'] = old_entry['sources']['tencent']
    snapshot = hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()
    candidate['snapshot'] = 'public-' + snapshot
    saved_report = json.loads(report_path.read_text()) if report_path.exists() else {}
    if saved_report.get('snapshot') == candidate['snapshot'] and saved_report.get('published') and old.get('snapshot') == candidate['snapshot']:
        print(json.dumps({'unchanged': True, 'snapshot': candidate['snapshot']}))
        return
    prior_gets = saved_report.get('getSampleChecks', [])
    checked_gets = list(prior_gets)
    temporary = root / '.distribution.next.json'
    temporary.write_text(json.dumps(candidate, ensure_ascii=False, indent=2) + '\n')
    temporary.chmod(0o644)
    os.replace(temporary, index)
    validations = []
    try:
        for i, entry in enumerate(entries):
            # One request per second stays below the existing Nginx ingress policy.
            time.sleep(0.6)
            with request(entry['sources']['tencent']) as head:
                assert head.status == 200
                assert int(head.headers['Content-Length']) == entry['size']
                assert head.headers.get_content_type() == entry['mime']
                assert head.headers.get('Access-Control-Allow-Origin') in ('*', ORIGINS[0])
            validations.append({'id': entry['id'], 'head': 200, 'size': entry['size'], 'mime': entry['mime']})
            if entry['mime'].startswith(('audio/', 'video/')):
                filename = root / entry['localKey']
                for start, end in [(0, min(4095, entry['size'] - 1)), (max(0, entry['size'] - 4096), entry['size'] - 1)]:
                    time.sleep(0.6)
                    with request(entry['sources']['tencent'], 'GET', byte_range=f'bytes={start}-{end}') as part:
                        assert part.status == 206 and part.headers['Content-Range'] == f'bytes {start}-{end}/{entry["size"]}'
                        with filename.open('rb') as expected:
                            expected.seek(start)
                            assert part.read() == expected.read(end - start + 1)
                validations[-1]['prefixAndSuffixRange'] = 206
            print(json.dumps({'headVerified': i + 1, 'total': len(entries)}), flush=True)
        samples = {}
        for e in entries:
            for label in ('smallest', 'largest'):
                key = (e['mime'], label)
                if key not in samples or (e['size'] < samples[key]['size'] if label == 'smallest' else e['size'] > samples[key]['size']):
                    samples[key] = e
        samples = {e['id']: e for e in samples.values()}.values()
        for entry in samples:
            check = {'sha256': entry['sha256'], 'size': entry['size'], 'mime': entry['mime'], 'url': entry['sources']['tencent']}
            if check in prior_gets:
                continue
            for origin in ORIGINS[:1]:
                time.sleep(0.6)
                with request(entry['sources']['tencent'], 'GET', origin) as response:
                    sha = hashlib.sha256()
                    total = 0
                    for chunk in iter(lambda: response.read(65536), b''):
                        total += len(chunk)
                        sha.update(chunk)
                    assert total == entry['size'] and sha.hexdigest() == entry['sha256']
                    assert response.headers.get('Access-Control-Allow-Origin') in ('*', origin)
            for origin in ORIGINS:
                time.sleep(0.6)
                with request(entry['sources']['tencent'], 'HEAD', origin) as head:
                    assert head.status == 200 and head.headers.get('Access-Control-Allow-Origin') in ('*', origin)
                if entry['mime'].startswith(('audio/', 'video/')):
                    time.sleep(0.6)
                    with request(entry['sources']['tencent'], 'GET', origin, 'bytes=0-0') as response:
                        assert response.status == 206 and len(response.read()) == 1
                        assert response.headers['Content-Range'] == 'bytes 0-0/' + str(entry['size'])
            print(json.dumps({'getVerified': entry['id'], 'size': entry['size']}), flush=True)
            checked_gets.append(check)
        public = {**candidate, 'entries': [{k: v for k, v in e.items() if k != 'localKey'} for e in entries]}
        payload = (json.dumps(public, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
        assert len(payload) <= 1048576
        endpoint, access, secret = credentials()
        with signed_request(endpoint, access, secret, 'PUT', 'dcelysion-admin-public',
                            'media-routing/distribution-v1.json', data=payload,
                            mime='application/json', cache_control='no-store') as response:
            assert response.status == 200
        pathlib.Path(args.manifest_out).write_bytes(payload)
        atomic_json(report_path, {'version': 1, 'snapshot': candidate['snapshot'], 'entries': len(entries),
                                 'bytes': sum(e['size'] for e in entries), 'heads': validations,
                                 'getSampleChecks': checked_gets,
                                 'getSampleIds': list({e['id'] for e in samples}), 'published': True})
    except Exception:
        temporary.write_bytes(previous)
        temporary.chmod(0o644)
        os.replace(temporary, index)
        raise

if __name__ == '__main__':
    main()
