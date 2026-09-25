#!/usr/bin/env python3
"""Read S3 credentials on stdin and save a root-only rclone configuration."""
import json
import os
import re
import sys
from pathlib import Path

if os.geteuid() != 0:
    raise SystemExit('Run with sudo.')
data = json.load(sys.stdin)
if not re.fullmatch(r'[a-f0-9]{32}', data['accessKeyId']):
    raise SystemExit('Invalid access key ID format.')
if not re.fullmatch(r'[a-f0-9]{64}', data['secretAccessKey']):
    raise SystemExit('Invalid secret access key format.')
path = Path('/opt/dcelysion/rclone.conf')
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as output:
    output.write('[r2]\ntype = s3\nprovider = Cloudflare\n')
    output.write('access_key_id = ' + data['accessKeyId'] + '\n')
    output.write('secret_access_key = ' + data['secretAccessKey'] + '\n')
    output.write('endpoint = https://25d4e6f2e01c0cde639588a28d13814d.r2.cloudflarestorage.com\n')
    output.write('region = auto\nno_check_bucket = true\n')
os.chmod(path, 0o600)
print('R2 transfer configuration saved with owner-only permissions.')
