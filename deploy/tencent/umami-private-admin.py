"""Attach only the analytics adapter to the existing private test admin bundle.
Retains every other bundled module, mount, environment and database. No migration.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT=Path('/home/ubuntu/dc-admin-private-20261002')
UMAMI=Path('/opt/dcelysion-umami')
assert ROOT.joinpath('OWNER').read_text().strip()=='dc-admin-private-integration-20261002'
assert UMAMI.joinpath('OWNER').read_text().strip()=='dcelysion-umami-20261004'
def run(*args):
    return subprocess.run(args,check=True,capture_output=True,text=True).stdout
app=json.loads(run('docker','inspect','dc-admin-it-20261002-admin'))[0]
assert app['Config']['Labels']['dc.task']=='admin-private-20261002'
mounts={item['Destination']:Path(item['Source']) for item in app['Mounts']}
assert mounts['/it/backend']==ROOT/'backend'
assert mounts['/it/state'].is_relative_to(ROOT)
bundle=mounts['/it/backend']/'admin/server/index.mjs'
backup=bundle.with_name('index.before-umami.mjs')
assert not backup.exists(), 'Existing adapter patch: inspect instead of replacing'
original=bundle.read_text()
patched=original
for before,after in [
    ('var AnalyticsService = class {','var LegacyCloudAnalyticsService = class {'),
    ('var AnalyticsInputError = class extends Error {','var LegacyCloudAnalyticsInputError = class extends Error {'),
    ('function analyticsSettings(', 'function legacyCloudAnalyticsSettings('),
]:
    assert patched.count(before)==1, 'Unexpected existing bundle declaration'
    patched=patched.replace(before,after,1)
patched='import {AnalyticsService, AnalyticsInputError, analyticsSettings} from "./analytics-runtime.mjs";\n'+patched
adapter=bundle.with_name('analytics-selfhost.mjs')
adapter.write_bytes(Path('/home/ubuntu/analytics-selfhost.mjs').read_bytes())
wrapper=bundle.with_name('analytics-runtime.mjs')
wrapper.write_text('''import { readFileSync } from "node:fs";
import { analyticsSettings as settings } from "./analytics-selfhost.mjs";
export { AnalyticsService, AnalyticsInputError } from "./analytics-selfhost.mjs";
export function analyticsSettings() {
  const entries=readFileSync("/it/state/umami.env","utf8").trim().split("\\n").map(line=>{const i=line.indexOf("=");return [line.slice(0,i),line.slice(i+1)];});
  return settings({...process.env,...Object.fromEntries(entries)});
}
''')
secret=mounts['/it/state']/'umami.env'
assert not secret.exists()
env=UMAMI.joinpath('dashboard.env').read_text().replace('https://stats.dcelysion.cn/api','http://dc-umami:3000/api')+'ADMIN_UMAMI_ALLOW_INTERNAL_HTTP=1\n'
fd=os.open(secret,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as output: output.write(env)
os.chown(secret,1000,1000)
run('docker','network','connect','dc-admin-it-20261002-internal','dc-umami')
backup.write_text(original)
bundle.write_text(patched)
for path in [bundle,backup,adapter,wrapper]: os.chown(path,1000,1000)
run('docker','exec','dc-admin-it-20261002-admin','node','--check','/it/backend/admin/server/index.mjs')
run('docker','restart','dc-admin-it-20261002-admin')
result={'beforeSha256':hashlib.sha256(original.encode()).hexdigest(),'afterSha256':hashlib.sha256(patched.encode()).hexdigest(),'adapterSha256':hashlib.sha256(adapter.read_bytes()).hexdigest(),'scope':'private admin analytics only','rollbackBundle':str(backup)}
UMAMI.joinpath('private-admin-patch.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
