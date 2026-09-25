#!/usr/bin/env python3
"""Read SMTP credentials as JSON on stdin; never log their values."""
import json
import os
import re
import sys
import tempfile
from pathlib import Path

path = Path('/opt/dcelysion/.env')
if os.geteuid() != 0:
    raise SystemExit('Run with sudo.')
payload = json.load(sys.stdin)
email = payload['email']
password = payload['password'].replace(' ', '')
if not re.fullmatch(r'[A-Za-z0-9._+%-]+@gmail\.com', email):
    raise SystemExit('Expected a Gmail sender address.')
if not re.fullmatch(r'[a-zA-Z]{16}', password):
    raise SystemExit('Expected a 16-letter Gmail app password.')
updates = {
    'SMTP_HOST': 'smtp.gmail.com',
    'SMTP_PORT': '465',
    'SMTP_SECURE': 'true',
    'SMTP_USER': email,
    'SMTP_PASS': password,
    'AUTHOR_EMAIL': email,
}
lines = path.read_text().splitlines()
seen = set()
for index, line in enumerate(lines):
    key = line.partition('=')[0]
    if key in updates:
        lines[index] = key + '=' + updates[key]
        seen.add(key)
lines.extend(key + '=' + value for key, value in updates.items() if key not in seen)
fd, temp_path = tempfile.mkstemp(prefix='.env-', dir=path.parent)
try:
    with os.fdopen(fd, 'w') as output:
        output.write('\n'.join(lines) + '\n')
    os.chmod(temp_path, 0o600)
    os.replace(temp_path, path)
finally:
    if os.path.exists(temp_path):
        os.unlink(temp_path)
print('SMTP configuration saved with owner-only permissions.')
