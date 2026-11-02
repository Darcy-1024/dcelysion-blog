"""Only this trusted step has a read-only private-repository token."""
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request


class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected:
            redirected.remove_header('Authorization')
        return redirected


def request(url, accept='application/vnd.github+json'):
    req = urllib.request.Request(url, headers={
        'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
        'Accept': accept,
        'User-Agent': 'DcElysion-private-builder',
        'X-GitHub-Api-Version': '2022-11-28',
    })
    return urllib.request.build_opener(Redirect()).open(req, timeout=90)


job = os.environ['JOB_ID']
attempt = os.environ['ATTEMPT_ID']
release = os.environ['RELEASE_ID']
digest = os.environ['INPUT_SHA256']
uuid = r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
assert re.fullmatch(uuid, job) and re.fullmatch(uuid, attempt)
assert re.fullmatch(r'[1-9][0-9]*', release)
assert re.fullmatch(r'[a-f0-9]{64}', digest)
api = 'https://api.github.com/repos/' + os.environ['GITHUB_REPOSITORY']
with request(api) as response:
    assert json.load(response)['private'] is True
with request(api + '/releases/' + release) as response:
    metadata = json.load(response)
assert metadata['tag_name'] == 'job-' + job and metadata['draft'] is False
assets = [a for a in metadata['assets'] if a['name'] == 'input-' + digest + '.tar.gz']
assert len(assets) == 1 and 0 < assets[0]['size'] <= 1024**3
target = Path('job-input.tar.gz')
sha = hashlib.sha256()
size = 0
with request(api + '/releases/assets/' + str(assets[0]['id']), 'application/octet-stream') as response, target.open('xb') as output:
    while block := response.read(1024 * 1024):
        size += len(block)
        assert size <= assets[0]['size']
        sha.update(block)
        output.write(block)
assert size == assets[0]['size'] and sha.hexdigest() == digest
target.chmod(0o600)
