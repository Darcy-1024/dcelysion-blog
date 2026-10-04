"""Independent custom-format dump + verified upload. Never edits Waline backup jobs."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

os.umask(0o077)
root=Path('/opt/dcelysion-umami')
assert root.joinpath('OWNER').read_text().strip()=='dcelysion-umami-20261004'
folder=root/'backups'
folder.mkdir(mode=0o700,exist_ok=True)
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
dump=folder/f'umami-{stamp}.dump'
with dump.open('xb') as output:
    subprocess.run(['docker','exec','dc-umami-pg','pg_dump','-U','umami_operator','-d','umami','-Fc'],stdout=output,stderr=subprocess.PIPE,check=True)
    output.flush()
    os.fsync(output.fileno())
subprocess.run(['docker','exec','-i','dc-umami-pg','pg_restore','--list'],stdin=dump.open('rb'),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,check=True)
digest=hashlib.sha256(dump.read_bytes()).hexdigest()
checksum=dump.with_suffix('.dump.sha256')
checksum.write_text(digest+'  '+dump.name+'\n')
result={'dump':str(dump),'bytes':dump.stat().st_size,'sha256':digest,'customArchiveListed':True,'r2ReadbackVerified':False}
if os.environ.get('UMAMI_BACKUP_R2_ENABLED') != '1':
    result['r2State']='disabled_pending_valid_credentials'
    root.joinpath('backup-evidence.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result))
    raise SystemExit(0)
remote='backup-r2:dcelysion-db-backups/database/umami/'+dump.name
config=Path(os.environ.get('UMAMI_BACKUP_R2_CONFIG','/opt/dcelysion-umami/backup-r2.conf'))
assert config.is_file() and config.stat().st_mode & 0o777 == 0o600, 'Protected backup credentials required'
base=['rclone','--config',str(config),'--s3-no-check-bucket','--no-update-modtime']
for local,dest in [(dump,remote),(checksum,remote+'.sha256')]:
    subprocess.run(base+['copyto',str(local),dest],capture_output=True,check=True)
process=subprocess.Popen(base+['cat',remote],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
actual=hashlib.sha256()
while data:=process.stdout.read(65536): actual.update(data)
assert process.wait()==0 and actual.hexdigest()==digest,'R2 dump readback failed'
result={'dump':str(dump),'bytes':dump.stat().st_size,'sha256':digest,'remote':remote,'customArchiveListed':True,'r2ReadbackVerified':True}
root.joinpath('backup-evidence.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
