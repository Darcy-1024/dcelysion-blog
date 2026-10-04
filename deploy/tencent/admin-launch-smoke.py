"""One real TLS/login/draft/statistics/private-media flow on the candidate only."""
import base64
import hashlib
import hmac
import http.client
import json
from pathlib import Path
import re
import socket
import ssl
import struct
import subprocess
import time
import uuid

root = Path('/home/ubuntu/dc-admin-private-20261002')
work = root/'launch-20261004'
assert (root/'OWNER').read_text().strip() == 'dc-admin-private-integration-20261002'
assert json.loads((work/'deployed.json').read_text())['candidate'] == 'dc-admin-it-20261004-candidate'
account = json.loads((root/'synthetic-account.json').read_text())
assert account['email'] == 'admin-it@example.invalid' and str(account['id']) == '1'
context = ssl.create_default_context()
class LocalTLS(http.client.HTTPSConnection):
    def connect(self):
        self.sock = context.wrap_socket(socket.create_connection(('127.0.0.1',18444),timeout=20),server_hostname='comments.dcelysion.cn')
def request(path, body=None, cookie=''):
    conn = LocalTLS('comments.dcelysion.cn',18444,context=context,timeout=20)
    headers = {'Origin':'https://comments.dcelysion.cn:18444','Content-Type':'application/json'}
    if cookie: headers['Cookie'] = cookie
    conn.request('POST' if body is not None else 'GET',path,json.dumps(body) if body is not None else None,headers)
    response = conn.getresponse()
    data = response.read()
    result = (response.status,data,dict(response.getheaders()))
    conn.close()
    return result
checks = {}
cookie = ''
try:
    status, page, _ = request('/')
    assert status == 200
    assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"',page.decode())
    assert len(assets) == 2
    for path in assets:
        status, data, headers = request(path)
        assert status == 200 and headers['cache-control'] == 'no-store'
        assert hashlib.sha256(data).digest() == hashlib.sha256((work/'candidate/admin/dist'/path.lstrip('/')).read_bytes()).digest()
    checks['clientAssetSHA256Matches'] = True
    draft_id = 'e06e12f4-ac52-4c47-8c1f-653746697e46'
    media_id = '54e67f3f-dc8f-408a-a316-159f651a6fcb'
    anonymous = {}
    for path in ['/api/me','/api/analytics','/api/drafts/'+draft_id,'/api/library/'+media_id+'/original','/api/library/'+media_id+'/preview']:
        status, _, _ = request(path)
        assert status == 401
        anonymous[path] = status
    status, _, _ = request('/api/drafts/'+draft_id+'/save',{'requestId':str(uuid.uuid4()),'revision':1,'source':'must be refused'})
    assert status == 401
    checks['anonymousReadWriteDenied'] = anonymous | {'save':status}
    secret = base64.b32decode(account['totp_secret'].upper()+'='*((8-len(account['totp_secret'])%8)%8))
    digest = hmac.new(secret,struct.pack('>Q',int(time.time())//30),hashlib.sha1).digest()
    offset = digest[-1]&15
    code = str((struct.unpack('>I',digest[offset:offset+4])[0]&0x7fffffff)%1000000).zfill(6)
    status, data, headers = request('/api/login',{'identity':account['email'],'password':account['password'],'code':code})
    assert status == 200 and json.loads(data)['ok']
    raw_cookie = headers['set-cookie']
    assert all(value in raw_cookie for value in ['__Host-dc_admin=','HttpOnly','Secure','SameSite=Strict'])
    cookie = raw_cookie.split(';')[0]
    checks['realWaline2faLogin'] = True
    status, data, _ = request('/api/drafts/'+draft_id,cookie=cookie)
    assert status == 200
    detail = json.loads(data)['data']['draft']
    status, data, _ = request('/api/drafts/'+draft_id+'/save',{'requestId':str(uuid.uuid4()),'revision':detail['revision'],'source':detail['source']},cookie)
    assert status == 200, 'Same-source synthetic draft save failed'
    saved = json.loads(data)['data']['draft']
    assert saved['source'] == detail['source'] and saved['revision'] == detail['revision']+1
    status, data, _ = request('/api/drafts/'+draft_id,cookie=cookie)
    assert status == 200 and json.loads(data)['data']['draft']['revision'] == saved['revision']
    checks['draftReadSaveRead'] = {'beforeRevision':detail['revision'],'afterRevision':saved['revision'],'sourceUnchanged':True}
    status, data, _ = request('/api/analytics?range=7d',cookie=cookie)
    assert status == 200
    report = json.loads(data)['data']
    assert report['source'] == 'Umami 自建' and report['state'] == 'success'
    assert report['stats']['data']['pageviews'] >= 2
    checks['selfhostedStatistics'] = {'source':report['source'],'state':report['state'],'stats':report['stats']['data']}
    status, data, _ = request('/api/library',cookie=cookie)
    assert status == 200
    library = json.loads(data)['data']
    checks['mediaInfo'] = library['info']
    for variant in ['original','preview']:
        status, data, _ = request('/api/library/'+media_id+'/'+variant,cookie=cookie)
        assert status == 200
        checks['private-'+variant+'-sha256'] = hashlib.sha256(data).hexdigest()
    status, data, _ = request('/api/publishing',cookie=cookie)
    assert status == 503 and json.loads(data)['error']['code'] == 'TARGET_NOT_CONFIGURED'
    checks['pausedPublishingRefused'] = True
    checks['realR2WritesRepeated'] = False
    checks['passed'] = True
except BaseException:
    # Return immediately to the preserved old integration service on failure.
    subprocess.run(['sudo','-n','docker','stop','--time','30','dc-admin-it-20261004-candidate'],capture_output=True)
    subprocess.run(['sudo','-n','docker','start','dc-admin-it-20261002-admin'],check=True,capture_output=True)
    (work/'smoke-failed.json').write_text(json.dumps({'completed':checks,'previousRestored':True},indent=2))
    raise
finally:
    if cookie:
        try: request('/api/logout',{},cookie)
        except OSError: pass
(work/'smoke.json').write_text(json.dumps(checks,indent=2))
print(json.dumps(checks))
