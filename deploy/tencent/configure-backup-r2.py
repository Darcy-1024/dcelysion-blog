#!/usr/bin/env python3
"""Read dedicated R2 S3 credentials from stdin and store them root-only."""
import json
import os
import re
import sys
from pathlib import Path

if os.geteuid() != 0:
    raise SystemExit('Run with sudo.')

data = json.load(sys.stdin)
access_key = data['accessKeyId']
secret_key = data['secretAccessKey']
if not re.fullmatch(r'[a-f0-9]{32}', access_key):
    raise SystemExit('Invalid access key ID format.')
if not re.fullmatch(r'[a-f0-9]{64}', secret_key):
    raise SystemExit('Invalid secret access key format.')

path = Path('/opt/dcelysion/backup-r2.conf')
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    output.write('[backup-r2]\ntype = s3\nprovider = Cloudflare\n')
    output.write(f'access_key_id = {access_key}\n')
    output.write(f'secret_access_key = {secret_key}\n')
    output.write('endpoint = https://25d4e6f2e01c0cde639588a28d13814d.r2.cloudflarestorage.com\n')
    output.write('region = auto\nno_check_bucket = true\n')
os.chmod(path, 0o600)
print('Dedicated R2 backup configuration saved with owner-only permissions.')
