#!/usr/bin/env python3
"""Import only self-hosted images actually referenced by the public blog.

Public HTML/sitemap is the publication trigger. Never reads repository drafts,
admin/private uploads or third-party media. Mutable aliases bind to its revision.
"""
import hashlib
import json
import os
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from public_r2_plan import credentials, signed_request
from sync_public_media import atomic_json

ORIGIN = 'https://blog.dcelysion.cn'
EXT = re.compile(r'\.(avif|webp|png|jpg|jpeg|gif|svg|ico)$', re.I)

def fetch(url, limit):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Origin': ORIGIN, 'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(request, timeout=90) as response:
        assert response.url == url and response.status == 200
        data = response.read(limit + 1)
        assert len(data) <= limit
        return data, response.headers.get_content_type()

def version():
    data, _ = fetch(ORIGIN + '/__route/version.json', 8192)
    result = json.loads(data)
    revision = result['sourceRevision']
    assert result['deploymentEligible'] is True and result['buildProvenance'] == 'github-actions'
    assert re.fullmatch('[a-f0-9]{40}', revision)
    return revision

class Images(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = set()
    def handle_starttag(self, tag, attrs):
        if tag not in ('img', 'source', 'video', 'a', 'link'):
            return
        for key, value in attrs:
            if not value or key not in ('src', 'srcset', 'data-media-src', 'data-media-srcset', 'data-src', 'data-lazy-src', 'poster', 'href'):
                continue
            for candidate in value.split(',') if 'srcset' in key else [value]:
                url = urllib.parse.urlsplit(urllib.parse.urljoin(ORIGIN, candidate.strip().split()[0]))
                if url.scheme != 'https' or url.hostname != 'blog.dcelysion.cn' or url.query or url.fragment:
                    continue
                if not EXT.search(url.path) or url.path.startswith(('/vndb-covers/', '/pio/')):
                    continue
                assert not '..' in url.path and not url.path.startswith('//')
                self.urls.add(url.path)

def main():
    root = pathlib.Path(sys.argv[1]).resolve(strict=True)
    output = pathlib.Path(sys.argv[2])
    old = json.loads(output.read_text()) if output.exists() else {'version': 1, 'objects': []}
    revision = version()
    if old.get('scannedRevision') == revision:
        return
    pages = {ORIGIN + '/'}
    sitemaps = [ORIGIN + '/sitemap-index.xml']
    while sitemaps:
        url = sitemaps.pop()
        data, _ = fetch(url, 1048576)
        doc = ET.fromstring(data)
        for loc in doc.iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc'):
            location = loc.text
            assert urllib.parse.urlsplit(location).hostname == 'blog.dcelysion.cn'
            if doc.tag.endswith('sitemapindex'):
                sitemaps.append(location)
            else:
                pages.add(location)
        assert len(pages) <= 500
    parser = Images()
    expected = {}
    try:
        inventory_bytes, inventory_mime = fetch(ORIGIN + '/__route/public-media.json', 1048576)
        inventory = json.loads(inventory_bytes)
        assert inventory_mime == 'application/json' and inventory['schema'] == 1
        assert inventory['sourceRevision'] == revision and inventory['deploymentEligible'] is True
        assert len(inventory['objects']) <= 5000
        for obj in inventory['objects']:
            alias = '/' + obj['key']
            assert EXT.search(alias) and not alias.startswith(('/vndb-covers/', '/pio/')) and '..' not in alias
            expected[alias] = obj
            parser.urls.add(alias)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    for page in sorted(pages):
        data, mime = fetch(page, 2097152)
        assert mime == 'text/html'
        parser.feed(data.decode('utf-8'))
    dynamic_bytes, _ = fetch(ORIGIN + '/api/dynamic.json', 2097152)
    for dynamic in json.loads(dynamic_bytes):
        for image in dynamic.get('images', []):
            for key, value in [('src', image.get('src')), ('src', image.get('preview', {}).get('src')),
                               ('srcset', image.get('preview', {}).get('srcSet'))]:
                if value:
                    parser.handle_starttag('img', [(key, value)])
    assert len(parser.urls) <= 2000
    endpoint, access, secret = credentials()
    objects = list(old['objects'])
    for alias in sorted(parser.urls):
        if any(o.get('alias') == alias and o.get('aliasRevision') == revision for o in objects):
            continue
        data, mime = fetch(ORIGIN + alias, 25000000)
        assert mime.startswith('image/')
        checksum = hashlib.sha256(data).hexdigest()
        if alias in expected:
            assert checksum == expected[alias]['sha256'] and len(data) == expected[alias]['size'] and mime == expected[alias]['mime']
        name = pathlib.PurePosixPath(alias).name
        local_key = 'verified/' + checksum + '/' + name
        target = root / local_key
        assert target.resolve().is_relative_to(root)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            assert hashlib.sha256(target.read_bytes()).hexdigest() == checksum
        else:
            temporary = target.with_suffix('.site-partial')
            temporary.write_bytes(data)
            temporary.chmod(0o644)
            os.replace(temporary, target)
        key = 'site-assets/' + checksum + '/' + name
        r2_url = 'https://admin-media.dcelysion.cn/' + key
        if not any(o['url'] == r2_url for o in objects):
            with signed_request(endpoint, access, secret, 'PUT', 'dcelysion-admin-public', key, data=data, mime=mime) as response:
                assert response.status == 200
        objects.append({'purpose': 'article', 'key': key, 'url': r2_url, 'localKey': local_key,
                        'sha256': checksum, 'size': len(data), 'mime': mime,
                        'alias': alias, 'aliasRevision': revision, 'evidence': 'published-site-complete-get'})
        del data
        # Persist progress, but scannedRevision is committed only after a stable full pass.
        atomic_json(output, {'version': 1, 'objects': objects})
        print(json.dumps({'siteAlias': alias, 'revision': revision}), flush=True)
    assert version() == revision, 'public deployment changed during crawl'
    atomic_json(output, {'version': 1, 'objects': objects, 'scannedRevision': revision})

if __name__ == '__main__':
    main()
