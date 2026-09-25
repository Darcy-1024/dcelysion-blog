#!/usr/bin/env python3
"""Compare imported rows to the original exports without logging personal data."""
import datetime
import json
import subprocess
import sys
from pathlib import Path

database, source = sys.argv[1:]
if database not in ('waline', 'waline_migration_check', 'waline_restore_check'):
    raise SystemExit('Unexpected database.')
source = Path(source)

def query(sql):
    result = subprocess.run(
        ['docker', 'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'waline',
         '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql],
        cwd='/opt/dcelysion', check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout)

def same(actual, expected, context):
    if actual != expected:
        raise SystemExit('Import mismatch: ' + context)

def check_date(row, key, ms, context):
    stamp = datetime.datetime.fromisoformat(row[key]).replace(tzinfo=datetime.timezone.utc).timestamp()
    if abs(stamp - ms / 1000) > 0.501:
        raise SystemExit('Timestamp mismatch: ' + context)

comments = json.loads((source / 'twikoo-comment.json').read_text())
counters = json.loads((source / 'twikoo-counter.json').read_text())
actual_comments = query('SELECT COALESCE(json_agg(t ORDER BY id),\'[]\'::json) FROM wl_comment t')
actual_counters = query('SELECT COALESCE(json_agg(t ORDER BY id),\'[]\'::json) FROM wl_counter t')
same(len(actual_comments), len(comments), 'comment count')
same(len(actual_counters), len(counters), 'counter count')
ids = {row['_id']: index + 1 for index, row in enumerate(comments)}
promoted = 0
for index, (original, actual) in enumerate(zip(comments, actual_comments)):
    context = 'comment row ' + str(index)
    same(actual['id'], index + 1, context + ' id')
    same(actual['user_id'], None, context + ' user')
    for key in ('comment', 'nick', 'mail', 'link', 'ip', 'ua', 'url'):
        same(actual[key], original[key], context + ' ' + key)
    orphan = original['pid'] is not None and (original['pid'] not in ids or original['rid'] not in ids)
    if orphan:
        promoted += 1
    for key in ('pid', 'rid'):
        same(actual[key], None if orphan or original[key] is None else ids[original[key]], context + ' ' + key)
    same(actual['status'], 'spam' if original['isSpam'] else 'approved', context + ' status')
    check_date(actual, 'insertedat', original['created'], context)
    check_date(actual, 'createdat', original['created'], context)
    check_date(actual, 'updatedat', original['updated'], context)
for index, (original, actual) in enumerate(zip(counters, actual_counters)):
    context = 'counter row ' + str(index)
    same(actual['id'], index + 1, context + ' id')
    for key in ('url', 'time'):
        same(actual[key], original[key], context + ' ' + key)
    check_date(actual, 'createdat', original['created'], context)
    check_date(actual, 'updatedat', original['updated'], context)
print(f'Verified {len(comments)} comments, {len(counters)} counters, {promoted} orphan promoted; text and private fields preserved.')
