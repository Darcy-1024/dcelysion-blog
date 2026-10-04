"""Provision only new, isolated Umami 3.4.0 resources. Run as root on Tencent.
Secrets are generated on the server and never printed. Refuses an existing root.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import time

ROOT = Path('/opt/dcelysion-umami')
IMAGE = 'ghcr.io/umami-software/umami:3.4.0@sha256:85909afc45bdcda1917394594a087421fdbb05610fded0fa9f6fb861abb2f367'
PG = 'sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'

def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs)

def private(name, contents):
    path = ROOT / name
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write(contents)

assert os.geteuid() == 0
if ROOT.exists():
    assert ROOT.joinpath('OWNER').read_text().strip() == 'dcelysion-umami-20261004'
    raise RuntimeError('Existing Umami root: inspect instead of reprovisioning')
run('docker', 'image', 'inspect', IMAGE)
run('docker', 'image', 'inspect', PG)
ROOT.mkdir(mode=0o700)
private('OWNER', 'dcelysion-umami-20261004\n')
operator, dbpassword = secrets.token_hex(32), secrets.token_hex(32)
private('postgres.env', f'POSTGRES_USER=umami_operator\nPOSTGRES_PASSWORD={operator}\nPOSTGRES_DB=postgres\nTZ=UTC\n')
private('umami.env', f'DATABASE_URL=postgresql://umami_app:{dbpassword}@dc-umami-pg:5432/umami?connection_limit=5\nAPP_SECRET={secrets.token_hex(32)}\nTWO_FACTOR_ENCRYPTION_KEY={secrets.token_hex(32)}\nDISABLE_TELEMETRY=1\nHOSTNAME=0.0.0.0\n')
private('account-bootstrap.json', json.dumps({'adminPassword': secrets.token_urlsafe(32), 'readerPassword': secrets.token_urlsafe(32)}))
run('docker', 'network', 'create', '--internal', '--label', 'dc.task=umami-20261004', 'dc-umami-internal')
run('docker', 'network', 'create', '--label', 'dc.task=umami-20261004', 'dc-umami-ingress')
run('docker', 'volume', 'create', '--label', 'dc.task=umami-20261004', 'dc-umami-pgdata')
run('docker', 'run', '-d', '--name', 'dc-umami-pg', '--label', 'dc.task=umami-20261004',
    '--network', 'dc-umami-internal', '--restart', 'unless-stopped', '--memory', '192m',
    '--memory-swap', '192m', '--cpus', '0.25', '--pids-limit', '128',
    '--env-file', str(ROOT/'postgres.env'), '-v', 'dc-umami-pgdata:/var/lib/postgresql/data', PG,
    '-c', 'max_connections=25', '-c', 'shared_buffers=32MB')
for attempt in range(30):
    # TCP avoids mistaking the temporary initdb Unix-socket server for readiness.
    status = subprocess.run(['docker', 'exec', 'dc-umami-pg', 'pg_isready', '-h', '127.0.0.1', '-U', 'umami_operator'], capture_output=True)
    if status.returncode == 0:
        break
    time.sleep(1)
else:
    raise RuntimeError('New Umami PostgreSQL not ready')
sql = f"""CREATE ROLE umami_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '{dbpassword}';
CREATE DATABASE umami OWNER umami_app;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
REVOKE ALL ON DATABASE umami FROM PUBLIC;
GRANT CONNECT ON DATABASE umami TO umami_app;
"""
run('docker', 'exec', '-i', 'dc-umami-pg', 'psql', '-U', 'umami_operator', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', input=sql)
run('docker', 'exec', '-i', 'dc-umami-pg', 'psql', '-U', 'umami_operator', '-d', 'umami', '-v', 'ON_ERROR_STOP=1',
    input='REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT ALL ON SCHEMA public TO umami_app;')
run('docker', 'create', '--name', 'dc-umami', '--label', 'dc.task=umami-20261004',
    '--network', 'dc-umami-ingress', '--restart', 'unless-stopped', '--init',
    '--memory', '384m', '--memory-swap', '512m', '--cpus', '0.5', '--pids-limit', '128',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--env-file', str(ROOT/'umami.env'), '-p', '127.0.0.1:18300:3000', IMAGE)
run('docker', 'network', 'connect', 'dc-umami-internal', 'dc-umami')
run('docker', 'start', 'dc-umami')
private('deployment.json', json.dumps({'version': '3.4.0', 'image': IMAGE, 'postgresImage': PG, 'domain': 'stats.dcelysion.cn'}, indent=2))
print('Created isolated dc-umami + dc-umami-pg; credentials stored only in protected server files.')
