#!/usr/bin/env python3
"""List only the four approved PUBLIC buckets using existing server credentials.

Credentials remain in memory on the protected server. No private bucket reads.
This explicit scheduled task does not touch the admin publishing/MDX pipeline.
"""
import datetime
import hashlib
import hmac
import json
import pathlib
import subprocess
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

DESTINATIONS = {
    'dcelysion-admin-public': ('article', 'admin-media.dcelysion.cn'),
    'dcelysion-gallery': ('gallery', 'gallery.dcelysion.cn'),
    'dcelysion-wallpapers': ('wallpaper', 'wallpapers.dcelysion.cn'),
    'dcelysion-music': ('music', 'music.dcelysion.cn'),
}

def credentials():
    container = json.loads(subprocess.check_output(['docker', 'inspect', 'dc-admin-formal']))[0]
    env = dict(v.split('=', 1) for v in container['Config']['Env'])
    return env['ADMIN_R2_ENDPOINT'], env['ADMIN_R2_ACCESS_KEY_ID'], env['ADMIN_R2_SECRET_ACCESS_KEY']

def signed_request(endpoint, access, secret, method, bucket, key='', query=None, data=None, mime=None, cache_control='public, max-age=31536000, immutable'):
    base = urllib.parse.urlsplit(endpoint)
    assert base.scheme == 'https' and base.hostname.endswith('.r2.cloudflarestorage.com')
    uri = '/' + bucket + '/' + urllib.parse.quote(key, safe='/~')
    qs = urllib.parse.urlencode(sorted((query or {}).items()), quote_via=urllib.parse.quote)
    now = datetime.datetime.now(datetime.timezone.utc)
    amz = now.strftime('%Y%m%dT%H%M%SZ')
    day = now.strftime('%Y%m%d')
    payload = hashlib.sha256(data or b'').hexdigest()
    canonical_headers = f'host:{base.netloc}\nx-amz-content-sha256:{payload}\nx-amz-date:{amz}\n'
    header_names = 'host;x-amz-content-sha256;x-amz-date'
    canonical = '\n'.join([method, uri, qs, canonical_headers, header_names, payload])
    scope = day + '/auto/s3/aws4_request'
    signing = ('AWS4' + secret).encode()
    for value in [day, 'auto', 's3', 'aws4_request']:
        signing = hmac.new(signing, value.encode(), hashlib.sha256).digest()
    signature = hmac.new(signing, ('AWS4-HMAC-SHA256\n' + amz + '\n' + scope + '\n' + hashlib.sha256(canonical.encode()).hexdigest()).encode(), hashlib.sha256).hexdigest()
    headers = {'x-amz-date': amz, 'x-amz-content-sha256': payload,
               'Authorization': f'AWS4-HMAC-SHA256 Credential={access}/{scope}, SignedHeaders={header_names}, Signature={signature}'}
    if mime:
        headers['Content-Type'] = mime
        headers['Cache-Control'] = cache_control
    return urllib.request.urlopen(urllib.request.Request(endpoint.rstrip('/') + uri + ('?' + qs if qs else ''), data=data, method=method, headers=headers), timeout=90)

def public_plan():
    endpoint, access, secret = credentials()
    objects = []
    excluded = []
    for bucket, (purpose, host) in DESTINATIONS.items():
        token = None
        while True:
            query = {'list-type': '2', 'max-keys': '1000'}
            if token:
                query['continuation-token'] = token
            with signed_request(endpoint, access, secret, 'GET', bucket, query=query) as response:
                doc = ET.fromstring(response.read())
            ns = {'s': 'http://s3.amazonaws.com/doc/2006-03-01/'}
            for item in doc.findall('s:Contents', ns):
                key = item.findtext('s:Key', namespaces=ns)
                size = int(item.findtext('s:Size', namespaces=ns))
                if key.startswith(('admin-runtime-it/', 'stage3-validation/')):
                    excluded.append({'bucket': bucket, 'key': key, 'reason': 'synthetic-validation'})
                    continue
                with signed_request(endpoint, access, secret, 'HEAD', bucket, key) as head:
                    mime = head.headers.get_content_type()
                    sha = head.headers.get('x-amz-meta-sha256')
                if not mime.startswith(('image/', 'audio/', 'video/')) and not key.endswith('.lrc'):
                    excluded.append({'bucket': bucket, 'key': key, 'reason': 'non-media'})
                    continue
                obj = {'purpose': purpose, 'key': key, 'size': size, 'mime': mime,
                       'etag': item.findtext('s:ETag', namespaces=ns).strip('"'),
                       'url': 'https://' + host + '/' + urllib.parse.quote(key, safe='/~'),
                       'localKey': purpose + '/' + key}
                if sha:
                    obj['sha256'] = sha
                objects.append(obj)
            if doc.findtext('s:IsTruncated', namespaces=ns) != 'true':
                break
            token = doc.findtext('s:NextContinuationToken', namespaces=ns)
            assert token, 'missing S3 cursor'
    return {'version': 1, 'objects': objects, 'excluded': excluded}

if __name__ == '__main__':
    import sys
    output = pathlib.Path(sys.argv[1])
    value = public_plan()
    output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    output.chmod(0o600)
    print(json.dumps({'objects': len(value['objects']), 'bytes': sum(o['size'] for o in value['objects']), 'excluded': len(value['excluded'])}))
