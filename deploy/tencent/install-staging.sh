#!/usr/bin/env bash
set -euo pipefail
umask 022
root=${DCELY_DEPLOY_ROOT:-}
source_dir=${DCELY_SOURCE_DIR:-$root/home/ubuntu/dcelysion-deploy}
site_dir=$root/srv/dcelysion
releases=$site_dir/releases
available=$root/etc/nginx/sites-available
enabled=$root/etc/nginx/sites-enabled
nginx_bin=${DCELY_NGINX_BIN:-nginx}
systemctl_bin=${DCELY_SYSTEMCTL_BIN:-systemctl}
curl_bin=${DCELY_CURL_BIN:-curl}
python_bin=${DCELY_PYTHON_BIN:-python3}
expected=${1:?Pass the SHA-256 of site.tar.gz}
[[ $expected =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid SHA-256.' >&2; exit 1; }
install -d -m 0755 "$site_dir" "$releases" "$site_dir/media"
exec 9>"$site_dir/.install-staging.lock"
flock -n 9 || { echo 'Another static deployment is running.' >&2; exit 1; }
printf '%s  %s\n' "$expected" "$source_dir/site.tar.gz" | sha256sum --check
release=$releases/$(date -u +%Y%m%d)-${expected:0:12}
marker=$release/.release-sha256
validate_release() { "$python_bin" "$source_dir/verify-static-release.py" "$1"; }
if [[ -e $release || -L $release ]]; then
    if [[ ! -d $release || -L $release || ! -f $marker || $(cat "$marker") != "$expected" ]]; then
        echo 'Existing release is incomplete or has a different full digest; refusing to reuse it.' >&2
        exit 1
    fi
    validate_release "$release"
else
    stage=$(mktemp -d "$releases/.staging.XXXXXXXX")
    cleanup_stage() { rm -rf -- "$stage"; }
    trap cleanup_stage EXIT
    "$python_bin" - "$source_dir/site.tar.gz" "$stage" <<'PY'
import sys, tarfile
with tarfile.open(sys.argv[1]) as archive:
    archive.extractall(sys.argv[2], filter='data')
PY
    validate_release "$stage"
    find "$stage" -type d -exec chmod 0755 {} +
    find "$stage" -type f -exec chmod 0644 {} +
    printf '%s\n' "$expected" > "$stage/.release-sha256"
    mv -T -- "$stage" "$release"
    trap - EXIT
fi
current=$site_dir/current
staging_conf=$available/dcelysion-staging
acme_conf=$available/dcelysion-acme
staging_link=$enabled/dcelysion-staging
acme_link=$enabled/dcelysion-acme
default_link=$enabled/default
paths=("$current" "$staging_conf" "$acme_conf" "$staging_link" "$acme_link" "$default_link")
if [[ -e $current && ! -L $current ]]; then echo 'Current release path is not a symlink.' >&2; exit 1; fi
install -d -m 0755 "$available" "$enabled"
backup=$(mktemp -d "$site_dir/.install-staging-state.XXXXXXXX")
snapshot() {
    local index=$1 path=${paths[$1]}
    if [[ -L $path ]]; then
        printf 'link\n' > "$backup/$index.type"
        readlink -- "$path" > "$backup/$index.value"
    elif [[ -f $path ]]; then
        printf 'file\n' > "$backup/$index.type"
        cp -p -- "$path" "$backup/$index.value"
    elif [[ ! -e $path ]]; then
        printf 'absent\n' > "$backup/$index.type"
    else
        echo "Unsupported deployment path type: $path" >&2
        return 1
    fi
}
restore() {
    local index=$1 path=${paths[$1]} type
    type=$(cat "$backup/$index.type")
    if [[ -L $path || -f $path ]]; then rm -f -- "$path"; fi
    if [[ -e $path ]]; then echo "Cannot restore unexpected directory: $path" >&2; return 1; fi
    case "$type" in
        link) ln -s -- "$(cat "$backup/$index.value")" "$path" ;;
        file) cp -p -- "$backup/$index.value" "$path" ;;
        absent) ;;
        *) echo "Invalid saved state for $path" >&2; return 1 ;;
    esac
}
changed=0
next_link=
next_staging_conf=
next_acme_conf=
finish() {
    local result=$?
    trap - EXIT
    if [[ -n $next_link ]]; then rm -f -- "$next_link"; fi
    if [[ -n $next_staging_conf ]]; then rm -f -- "$next_staging_conf"; fi
    if [[ -n $next_acme_conf ]]; then rm -f -- "$next_acme_conf"; fi
    if (( result != 0 && changed )); then
        local rollback_failed=0
        for index in "${!paths[@]}"; do restore "$index" || rollback_failed=1; done
        "$nginx_bin" -t || rollback_failed=1
        "$systemctl_bin" reload nginx || rollback_failed=1
        if (( rollback_failed )); then
            echo "Deployment failed; rollback also failed. State backup retained at: $backup" >&2
            exit "$result"
        else
            echo 'Deployment failed; previous current and Nginx state restored.' >&2
        fi
    fi
    rm -rf -- "$backup"
    exit "$result"
}
trap finish EXIT
for index in "${!paths[@]}"; do snapshot "$index"; done
changed=1
next_staging_conf=$(mktemp "$available/.dcelysion-staging.next.XXXXXXXX")
next_acme_conf=$(mktemp "$available/.dcelysion-acme.next.XXXXXXXX")
install -m 0644 "$source_dir/nginx-staging.conf" "$next_staging_conf"
install -m 0644 "$source_dir/nginx-acme.conf" "$next_acme_conf"
mv -Tf -- "$next_staging_conf" "$staging_conf"
next_staging_conf=
mv -Tf -- "$next_acme_conf" "$acme_conf"
next_acme_conf=
ln -sfn "$staging_conf" "$staging_link"
ln -sfn "$acme_conf" "$acme_link"
if [[ -L $default_link ]]; then rm -f -- "$default_link"; fi
"$nginx_bin" -t
next_link=$site_dir/.current.next.$$
ln -s -- "$release" "$next_link"
mv -Tf -- "$next_link" "$current"
next_link=
"$systemctl_bin" reload nginx
"$curl_bin" --connect-timeout 5 --max-time 15 --fail --silent --show-error http://127.0.0.1:8080/ > /dev/null
changed=0
printf 'Private static site deployed: %s\n' "$release"
