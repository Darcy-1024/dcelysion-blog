#!/usr/bin/env bash
# Pure local fault injection. Requires native symlinks; no host service commands.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
if command -v python3 >/dev/null 2>&1 && python3 -c 'import tarfile' >/dev/null 2>&1; then
    test_python=(python3)
    export DCELY_TEST_PYTHON_KIND=python3
    export DCELY_TEST_PYTHON_BIN=$(command -v python3)
elif command -v py >/dev/null 2>&1 && py -3 -c 'import tarfile' >/dev/null 2>&1; then
    test_python=(py -3)
    export DCELY_TEST_PYTHON_KIND=py
    export DCELY_TEST_PYTHON_BIN=$(command -v py)
else
    echo 'Python 3 with tarfile is required for this local test.' >&2
    exit 1
fi
work=$(mktemp -d "${TMPDIR:-/tmp}/dcely-test.XXXXXXXX")
touch "$work/.dcely-test-owned"
cleanup() { [[ -f $work/.dcely-test-owned && $work == "${TMPDIR:-/tmp}"/dcely-test.* ]] && rm -rf -- "$work"; }
trap cleanup EXIT
root=$work/root
source_dir=$root/home/ubuntu/dcelysion-deploy
bin=$work/bin
mkdir -p "$source_dir" "$bin" "$root/etc/nginx/sites-available" "$root/etc/nginx/sites-enabled"
cp "$repo/deploy/tencent/verify-static-release.py" "$source_dir/"
printf 'server { listen 127.0.0.1:8080; }\n' > "$source_dir/nginx-staging.conf"
printf 'server { listen 80; }\n' > "$source_dir/nginx-acme.conf"
printf 'old default\n' > "$root/etc/nginx/sites-available/default"
if ! ln -s "$root/etc/nginx/sites-available/default" "$root/etc/nginx/sites-enabled/default"; then
    echo 'This local test requires native symbolic-link support (Linux or permitted Windows symlinks).' >&2
    exit 1
fi
if [[ ! -L $root/etc/nginx/sites-enabled/default ]]; then
    echo 'This local test requires native symbolic links; Git Bash copied the target instead.' >&2
    exit 1
fi
cat > "$bin/flock" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat > "$bin/python3" <<'SH'
#!/usr/bin/env bash
if [[ $DCELY_TEST_PYTHON_KIND == py ]]; then exec "$DCELY_TEST_PYTHON_BIN" -3 "$@"; fi
exec "$DCELY_TEST_PYTHON_BIN" "$@"
SH
cat > "$bin/nginx" <<'SH'
#!/usr/bin/env bash
if [[ -f $DCELY_TEST_NGINX_FAIL ]]; then rm -f "$DCELY_TEST_NGINX_FAIL"; exit 1; fi
exit 0
SH
cat > "$bin/systemctl" <<'SH'
#!/usr/bin/env bash
if [[ -f $DCELY_TEST_RELOAD_ALWAYS_FAIL ]]; then exit 1; fi
if [[ -f $DCELY_TEST_RELOAD_FAIL ]]; then rm -f "$DCELY_TEST_RELOAD_FAIL"; exit 1; fi
exit 0
SH
cat > "$bin/curl" <<'SH'
#!/usr/bin/env bash
if [[ -f $DCELY_TEST_CURL_FAIL ]]; then rm -f "$DCELY_TEST_CURL_FAIL"; exit 1; fi
exit 0
SH
chmod +x "$bin/"*
export PATH=$bin:$PATH
export DCELY_DEPLOY_ROOT=$root DCELY_SOURCE_DIR=$source_dir
export DCELY_NGINX_BIN=$bin/nginx DCELY_SYSTEMCTL_BIN=$bin/systemctl DCELY_CURL_BIN=$bin/curl DCELY_PYTHON_BIN=$bin/python3
export DCELY_TEST_NGINX_FAIL=$work/nginx.fail DCELY_TEST_RELOAD_FAIL=$work/reload.fail DCELY_TEST_CURL_FAIL=$work/curl.fail DCELY_TEST_RELOAD_ALWAYS_FAIL=$work/reload-always.fail
create_tar() {
    "${test_python[@]}" - "$source_dir/site.tar.gz" "$1" <<'PY'
import io, sys, tarfile
files = {
    'index.html': '<html><script src="/_astro/main.js"></script></html>',
    '404.html': '<html>404</html>',
    'pagefind/pagefind.js': 'search',
    '_astro/main.js': sys.argv[2],
}
with tarfile.open(sys.argv[1], 'w:gz') as archive:
    for name, text in files.items():
        data = text.encode()
        info = tarfile.TarInfo(name)
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))
PY
    sha256sum "$source_dir/site.tar.gz" | cut -d ' ' -f1
}
run() { bash "$repo/deploy/tencent/install-staging.sh" "$1" > "$work/run.log" 2>&1; }
assert_absent() {
    [[ ! -e $root/srv/dcelysion/current && ! -L $root/srv/dcelysion/current ]]
    [[ ! -e $root/etc/nginx/sites-available/dcelysion-staging ]]
    [[ ! -e $root/etc/nginx/sites-available/dcelysion-acme ]]
    [[ ! -L $root/etc/nginx/sites-enabled/dcelysion-staging ]]
    [[ ! -L $root/etc/nginx/sites-enabled/dcelysion-acme ]]
    [[ -L $root/etc/nginx/sites-enabled/default ]]
}
first=$(create_tar first)
for flag in "$DCELY_TEST_NGINX_FAIL" "$DCELY_TEST_RELOAD_FAIL" "$DCELY_TEST_CURL_FAIL"; do
    touch "$flag"
    if run "$first"; then echo 'Expected first-deploy failure.' >&2; exit 1; fi
    assert_absent
done
run "$first"
[[ -L $root/srv/dcelysion/current ]]
[[ ! -L $root/etc/nginx/sites-enabled/default ]]
old_current=$(readlink "$root/srv/dcelysion/current")
old_conf=$(cat "$root/etc/nginx/sites-available/dcelysion-staging")
old_acme=$(cat "$root/etc/nginx/sites-available/dcelysion-acme")
old_staging_link=$(readlink "$root/etc/nginx/sites-enabled/dcelysion-staging")
old_acme_link=$(readlink "$root/etc/nginx/sites-enabled/dcelysion-acme")
[[ $(cat "$old_current/.release-sha256") == "$first" ]]
printf 'untouched media\n' > "$root/srv/dcelysion/media/sentinel"
run "$first"
[[ $(readlink "$root/srv/dcelysion/current") == "$old_current" ]]
printf 'changed config\n' > "$source_dir/nginx-staging.conf"
second=$(create_tar second)
assert_old() {
    [[ $(readlink "$root/srv/dcelysion/current") == "$old_current" ]]
    [[ $(cat "$root/etc/nginx/sites-available/dcelysion-staging") == "$old_conf" ]]
    [[ $(cat "$root/etc/nginx/sites-available/dcelysion-acme") == "$old_acme" ]]
    [[ $(readlink "$root/etc/nginx/sites-enabled/dcelysion-staging") == "$old_staging_link" ]]
    [[ $(readlink "$root/etc/nginx/sites-enabled/dcelysion-acme") == "$old_acme_link" ]]
    [[ ! -e $root/etc/nginx/sites-enabled/default && ! -L $root/etc/nginx/sites-enabled/default ]]
    [[ $(cat "$root/srv/dcelysion/media/sentinel") == 'untouched media' ]]
}
for flag in "$DCELY_TEST_NGINX_FAIL" "$DCELY_TEST_RELOAD_FAIL" "$DCELY_TEST_CURL_FAIL"; do
    touch "$flag"
    if run "$second"; then echo 'Expected injected failure.' >&2; exit 1; fi
    assert_old
done
external_conf=$work/external-staging.conf
cp "$root/etc/nginx/sites-available/dcelysion-staging" "$external_conf"
rm -f "$root/etc/nginx/sites-available/dcelysion-staging"
ln -s "$external_conf" "$root/etc/nginx/sites-available/dcelysion-staging"
touch "$DCELY_TEST_NGINX_FAIL"
if run "$second"; then echo 'Expected symlinked-config failure.' >&2; exit 1; fi
[[ -L $root/etc/nginx/sites-available/dcelysion-staging ]]
[[ $(readlink "$root/etc/nginx/sites-available/dcelysion-staging") == "$external_conf" ]]
[[ $(cat "$external_conf") == "$old_conf" ]]
assert_old
rm -f "$root/etc/nginx/sites-available/dcelysion-staging"
cp "$external_conf" "$root/etc/nginx/sites-available/dcelysion-staging"

touch "$DCELY_TEST_RELOAD_ALWAYS_FAIL"
if run "$second"; then echo 'Expected persistent reload failure.' >&2; exit 1; fi
grep -q 'State backup retained at:' "$work/run.log"
retained=$(sed -n 's/.*State backup retained at: //p' "$work/run.log")
[[ -f $retained/0.type && -f $retained/1.type ]]
rm -f "$DCELY_TEST_RELOAD_ALWAYS_FAIL"
assert_old
printf 'invalid archive' > "$source_dir/site.tar.gz"
broken=$(sha256sum "$source_dir/site.tar.gz" | cut -d ' ' -f1)
if run "$broken"; then echo 'Expected extraction failure.' >&2; exit 1; fi
assert_old
third=$(create_tar third)
partial=$root/srv/dcelysion/releases/$(date -u +%Y%m%d)-${third:0:12}
mkdir -p "$partial"
printf 'partial\n' > "$partial/index.html"
if run "$third"; then echo 'Expected incomplete release refusal.' >&2; exit 1; fi
assert_old
echo 'Static deployment local fault tests passed.'
