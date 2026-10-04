"""One authenticated check of the existing private admin, using only its synthetic account."""
import base64
import hashlib
import hmac
import http.client
import json
from pathlib import Path
import socket
import ssl
import struct
import time

root=Path('/home/ubuntu/dc-admin-private-20261002')
assert root.joinpath('OWNER').read_text().strip()=='dc-admin-private-integration-20261002'
account=json.loads(root.joinpath('synthetic-account.json').read_text())
assert account['email']=='admin-it@example.invalid' and str(account['id'])=='1'
secret=base64.b32decode(account['totp_secret'].upper()+'='*((8-len(account['totp_secret'])%8)%8))
digest=hmac.new(secret,struct.pack('>Q',int(time.time())//30),hashlib.sha1).digest()
offset=digest[-1]&15
code=str((struct.unpack('>I',digest[offset:offset+4])[0]&0x7fffffff)%1000000).zfill(6)
context=ssl.create_default_context()
class LocalTLS(http.client.HTTPSConnection):
    def connect(self):
        self.sock=context.wrap_socket(socket.create_connection(('127.0.0.1',18444),timeout=20),server_hostname='comments.dcelysion.cn')
def request(path,body=None,cookie=''):
    conn=LocalTLS('comments.dcelysion.cn',18444,context=context,timeout=20)
    headers={'Origin':'https://comments.dcelysion.cn:18444','Content-Type':'application/json'}
    if cookie: headers['Cookie']=cookie
    conn.request('POST' if body is not None else 'GET',path,json.dumps(body) if body is not None else None,headers)
    response=conn.getresponse()
    data=json.loads(response.read())
    result=(response.status,data,response.getheader('set-cookie','').split(';')[0])
    conn.close()
    return result
status,_,_=request('/api/analytics')
assert status==401, f'Anonymous statistics expected401, got{status}'
status,login,cookie=request('/api/login',{'identity':account['email'],'password':account['password'],'code':code})
assert status==200 and login.get('ok') and cookie, 'Synthetic private login failed'
status,data,_=request('/api/analytics?range=7d',cookie=cookie)
assert status==200 and data.get('ok'), 'Private analytics API failed'
report=data['data']
assert report['source']=='Umami 自建', 'Wrong data source'
assert report['state']=='success', json.dumps({k:report[k] for k in ['state','stats','trend']})
assert report['stats']['data']=={'pageviews':2,'visitors':1,'visits':1}, 'Expected exactly two synthetic pageviews and one visitor/visit'
assert set(item['x'] for item in report['ranks']['path']['data'])=={'/__umami-qa-20261004/first/','/__umami-qa-20261004/second/'}
assert report['trend']['data']['pageviews'][-1]['x'].startswith('2026-10-04 00:00:00')
status,_,_=request('/api/analytics?websiteId=other',cookie=cookie)
assert status==400,'Client-selected site must be rejected'
request('/api/logout',{},cookie)
result={'anonymousStatus':401,'authenticatedStatus':200,'source':report['source'],'state':report['state'],'stats':report['stats']['data'],'trend':report['trend']['data'],'paths':report['ranks']['path']['data'],'clientWebsiteOverrideStatus':400}
Path('/opt/dcelysion-umami/admin-evidence.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
