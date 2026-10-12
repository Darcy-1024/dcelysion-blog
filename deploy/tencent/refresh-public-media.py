#!/usr/bin/env python3
"""Single scheduled writer for the public eligibility pipeline; no budget writes."""
import fcntl
import json
import pathlib
import subprocess
import sys

BASE = pathlib.Path('/opt/dcelysion-media-stage3/operator/all-public-20261012')
BIN = pathlib.Path('/opt/dcelysion-media-stage3/operator/public-sync')
ROOT = '/opt/dcelysion-media-stage3/public'
BASE.mkdir(mode=0o700, exist_ok=True)
lock = (BASE / 'refresh.lock').open('w')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

def run(script, *args):
    subprocess.run([sys.executable, str(BIN / script), *map(str, args)], check=True)

run('public_r2_plan.py', BASE / 'scheduled-plan.json')
run('sync_public_media.py', BASE / 'scheduled-plan.json', '--root', ROOT, '--receipts', BASE / 'receipts.json', '--s3-source')
run('sync-published-site-media.py', ROOT, BASE / 'local-plan.json')
run('register-public-media.py', '--root', ROOT, '--receipts', BASE / 'receipts.json', '--local-plan', BASE / 'local-plan.json',
    '--report', BASE / 'scheduled-registration.json', '--manifest-out', BASE / 'public-manifest.json')
