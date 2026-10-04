"""Install the full candidate only into the existing labelled integration service.

Old container, configuration, budget journal and databases are retained. This is
not the static blog release installer and cannot change a production release.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time

root = Path('/home/ubuntu/dc-admin-private-20261002')
work = root/'launch-20261004'
old = 'dc-admin-it-20261002-admin'
new = 'dc-admin-it-20261004-candidate'
docker = ['sudo', '-n', 'docker']
os.umask(0o077)
assert (root/'OWNER').read_text().strip() == 'dc-admin-private-integration-20261002'
inspect = json.loads(subprocess.run(docker+['inspect', old], check=True, capture_output=True, text=True).stdout)[0]
assert inspect['Config']['Labels']['dc.task'] == 'admin-private-20261002'
assert inspect['State']['Running']
assert not (work/'deployed.json').exists()
# Secret values remain in 0600 operator files and are never printed.
(work/'previous-container.json').write_text(json.dumps(inspect, indent=2))
archive = work/'admin-candidate.tar.gz'
candidate = work/'candidate'
assert not candidate.exists()
candidate.mkdir()
with tarfile.open(archive) as tar:
    assert all(not m.issym() and not m.islnk() and not m.isdev() for m in tar.getmembers())
    tar.extractall(candidate, filter='data')
manifest = json.loads((candidate/'manifest.json').read_text())
for entry in manifest['entries']:
    assert hashlib.sha256((candidate/entry['path']).read_bytes()).hexdigest() == entry['sha256']
def sql(query):
    return subprocess.run(docker+['exec', 'dc-admin-it-20261002-pg', 'psql', '-U', 'it_operator', '-d', 'dc_admin_restore_20261002', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], check=True, capture_output=True, text=True).stdout.strip()
assert sql('SELECT current_database()') == 'dc_admin_restore_20261002'
tables = sql("SELECT tablename FROM pg_tables WHERE schemaname='dc_admin' ORDER BY tablename").splitlines()
assert tables == ['audit', 'draft_saves', 'drafts', 'job_logs', 'jobs', 'media', 'media_refs', 'sessions']
assert sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='dc_admin' AND (table_name='drafts' AND column_name='base_dependencies' OR table_name='sessions' AND column_name='public_id' OR table_name='audit' AND column_name IN ('object_id','request_id'))") == '4'
assert sql("SELECT count(*) FROM dc_admin.media WHERE document->>'privateCopy' IN ('queued','running')") == '0', 'Do not auto-start pending R2 work'
constraints_before = sql("SELECT conname FROM pg_constraint WHERE conrelid='dc_admin.media'::regclass ORDER BY conname").splitlines()
(work/'schema-before.json').write_text(json.dumps({'tables': tables, 'mediaConstraints': constraints_before}))
# Preserve a new incremental test-only backup before applying 007.
with (work/'before-007.dump').open('wb') as backup:
    subprocess.run(docker+['exec', 'dc-admin-it-20261002-pg', 'pg_dump', '-U', 'it_operator', '-Fc', 'dc_admin_restore_20261002'], check=True, stdout=backup)
if not {'media_purpose_valid', 'media_destination_snapshot'}.issubset(constraints_before):
    sql((candidate/'admin/server/migrations/007_media_purpose.sql').read_text())
assert sql("SELECT count(*) FROM pg_constraint WHERE conrelid='dc_admin.media'::regclass AND conname IN ('media_purpose_valid','media_destination_snapshot')") == '2'
repository = work/'repository'
shutil.copytree(root/'repository', repository)
# New manifest adapters/configuration with the existing synthetic content only.
for name in ['config', 'utils', 'types', 'constants', 'i18n']:
    source = Path('/home/dc-builder/admin-launch-20261004/src')/name
    shutil.copytree(source, repository/'src'/name, dirs_exist_ok=True)
env = dict(line.split('=', 1) for line in inspect['Config']['Env'])
assert '/dc_admin_restore_20261002' in env['ADMIN_DATABASE_URL']
assert env['ADMIN_OWNER_WALINE_ID'] == '1'
for key in ['ADMIN_EXECUTOR_STATE_ROOT', 'ADMIN_PUBLISH_REMOTE', 'ADMIN_PUBLISH_BRANCH', 'ADMIN_TENCENT_SSH_HOST', 'ADMIN_BUILD_REMOTE_URL', 'ADMIN_BUILD_REMOTE_TOKEN']:
    env.pop(key, None)
umami = dict(line.split('=', 1) for line in (Path('/opt/dcelysion-umami')/'dashboard.env').read_text().splitlines() if '=' in line)
env.update({k: v for k, v in umami.items() if k in ['ADMIN_UMAMI_SOURCE', 'ADMIN_UMAMI_API_KEY', 'ADMIN_UMAMI_WEBSITE_ID']})
env.update(ADMIN_UMAMI_SOURCE='self-hosted', ADMIN_UMAMI_ENDPOINT='http://dc-umami:3000/api', ADMIN_UMAMI_ALLOW_INTERNAL_HTTP='1', ADMIN_UMAMI_REGION='')
keys = json.loads((work/'r2-runtime.json').read_text())
destinations = {}
for purpose, bucket, host in [('article','dcelysion-admin-public','admin-media.dcelysion.cn'), ('gallery','dcelysion-gallery','gallery.dcelysion.cn'), ('wallpaper','dcelysion-wallpapers','wallpapers.dcelysion.cn'), ('music','dcelysion-music','music.dcelysion.cn')]:
    destinations[purpose] = {'bucket': bucket, 'prefix': 'admin-v1', 'publicBase': 'https://'+host+'/admin-v1', 'tencentRoot': '/it/media-public/'+purpose}
env.update(ADMIN_MEDIA_PUBLIC_BASE='https://admin-media.dcelysion.cn/admin-v1', ADMIN_MEDIA_DESTINATIONS=json.dumps(destinations, separators=(',',':')),
    ADMIN_R2_PRIVATE_BUCKET='dcelysion-admin-private', ADMIN_R2_PUBLIC_BUCKET='dcelysion-admin-public', ADMIN_R2_PREFIX='admin-v1',
    ADMIN_R2_ENDPOINT=keys['endpoint'], ADMIN_R2_ACCESS_KEY_ID=keys['accessKeyId'], ADMIN_R2_SECRET_ACCESS_KEY=keys['secretAccessKey'], ADMIN_R2_PRIVATE_CONFIRMED='1',
    ADMIN_MEDIA_TENCENT_VERIFIED_DELIVERY='0')
env_file = work/'candidate.env'
env_file.write_text(''.join(k+'='+v+'\n' for k, v in env.items()))
subprocess.run(['sudo','-n','chmod','-R','a+rX',str(candidate),str(repository)], check=True)
subprocess.run(docker+['stop','--time','60',old], check=True, capture_output=True)
args = docker+['run','-d','--name',new,'--label','dc.task=admin-private-20261002','--network','container:dc-admin-it-20261002-waline',
    '--memory','512m','--memory-swap','512m','--cpus','.5','--pids-limit','128','--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--tmpfs','/tmp:rw,nosuid,noexec,size=32m,uid=1000,gid=1000','--env-file',str(env_file),'--workdir','/it/backend']
for source, target, readonly in [(candidate,'backend',True),(repository,'repository',True),(root/'restored-20261002/media-private','media-private',False),(root/'restored-20261002/media-public','media-public',False)]:
    args += ['--mount',f'type=bind,source={source},target=/it/{target}'+(',readonly' if readonly else '')]
args += [inspect['Image'],'node','/it/backend/admin/server/index.mjs']
try:
    subprocess.run(args, check=True, capture_output=True)
    time.sleep(3)
    current = json.loads(subprocess.run(docker+['inspect',new], check=True, capture_output=True,text=True).stdout)[0]
    assert current['State']['Running'], 'Candidate did not remain running'
except BaseException:
    subprocess.run(docker+['stop',new], capture_output=True)
    subprocess.run(docker+['start',old], check=True, capture_output=True)
    raise
result = {'candidate':new,'previous':old,'image':inspect['Image'],'archiveSHA256':hashlib.sha256(archive.read_bytes()).hexdigest(),'migration':'001-007 objects/constraints checked; only missing 007 applied','mdxExecutorEnabled':False,'r2Destinations':destinations,'tencentDeliveryEnabled':False,'productionChanged':False}
(work/'deployed.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
