#!/usr/bin/env bash
# Valid anonymous posting test in a separate DB/container with email disabled.
set -euo pipefail
cd /opt/dcelysion
docker compose exec -T postgres createdb -U waline waline_anonymous_direct_check
docker compose exec -T postgres psql -U waline -d waline_anonymous_direct_check -v ON_ERROR_STOP=1 < vendor/waline.pgsql > /dev/null
docker compose run --rm -d --no-deps --name dcelysion-anonymous-check \
  -p 127.0.0.1:18361:8360 -e PG_DB=waline_anonymous_direct_check \
  -e SMTP_HOST= -e SMTP_SERVICE= -e SMTP_USER= -e SMTP_PASS= -e AUTHOR_EMAIL= waline > /dev/null
trap 'docker stop dcelysion-anonymous-check >/dev/null 2>&1 || true' EXIT
python3 <<'PY'
import json, time, urllib.request, urllib.error
base = 'http://127.0.0.1:18361/api/comment'
headers = {'Content-Type':'application/json', 'Origin':'https://blog.dcelysion.cn', 'Referer':'https://blog.dcelysion.cn/'}
for attempt in range(30):
    try:
        with urllib.request.urlopen(urllib.request.Request(base+'?path=/__anonymous_test__',headers=headers),timeout=2) as response:
            if response.status == 200: break
    except (OSError, urllib.error.URLError):
        time.sleep(1)
else:
    raise SystemExit('Isolated service did not become ready.')
req=urllib.request.Request(base,headers=headers,data=json.dumps({'url':'/__anonymous_test__','comment':'Anonymous direct publication verification','nick':'','mail':'','link':''}).encode())
with urllib.request.urlopen(req,timeout=30) as response:
    result=json.load(response)
if result.get('errno') != 0 or result.get('data',{}).get('status') != 'approved':
    raise SystemExit('Anonymous comment was not immediately approved.')
with urllib.request.urlopen(urllib.request.Request(base+'?path=/__anonymous_test__',headers=headers),timeout=30) as response:
    public=json.load(response)
if public.get('errno') != 0 or public['data']['count'] != 1 or public['data']['data'][0]['comment'] != result['data']['comment']:
    raise SystemExit('Approved anonymous comment is missing from the public list.')
print('Anonymous submission accepted without nickname/email/login, immediately approved and publicly readable; no email configured.')
PY
test "$(docker compose exec -T postgres psql -U waline -d waline_anonymous_direct_check -Atc "SELECT count(*) FROM wl_comment WHERE status='approved' AND user_id IS NULL")" = 1
