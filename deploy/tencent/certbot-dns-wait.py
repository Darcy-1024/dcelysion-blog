#!/usr/bin/env python3
"""One-off DNS auth hook that survives desktop/SSH reconnects.

The coordinator publishes the requested TXT value and writes that same value to
the root-only ready file after verifying public DNS. This is not auto-renewal.
"""
import json
import os
import re
import time
from pathlib import Path

domain = os.environ['CERTBOT_DOMAIN']
validation = os.environ['CERTBOT_VALIDATION']
if os.geteuid() != 0 or domain != 'comments.dcelysion.cn':
    raise SystemExit('Unexpected execution identity or certificate domain.')
if not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', validation):
    raise SystemExit('Unexpected DNS validation value.')
challenge = Path('/run/dcelysion-acme-challenge.json')
ready = Path('/run/dcelysion-acme-ready')
fd = os.open(challenge, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as output:
    json.dump({'name': '_acme-challenge.' + domain, 'value': validation}, output)
print('DNS challenge prepared. Waiting for verified publication.', flush=True)
deadline = time.monotonic() + 1800
while time.monotonic() < deadline:
    if ready.exists() and ready.read_text().strip() == validation:
        print('Coordinator verified DNS publication.', flush=True)
        raise SystemExit(0)
    time.sleep(2)
raise SystemExit('DNS publication was not confirmed within 30 minutes.')
