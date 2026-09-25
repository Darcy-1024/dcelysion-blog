#!/usr/bin/env bash
# Run only after reviewing the target machine. Does not change DNS or public routes.
set -euo pipefail
umask 077

if [[ $EUID -ne 0 ]]; then
  echo 'Run with sudo.' >&2
  exit 1
fi

app_dir=/opt/dcelysion
install -d -m 0750 "$app_dir" "$app_dir/backups"
install -d -m 0755 /srv/dcelysion /srv/dcelysion/media /srv/dcelysion/releases /srv/dcelysion/acme
install -d -m 0755 /srv/dcelysion/media/music /srv/dcelysion/media/wallpapers /srv/dcelysion/media/gallery

if [[ ! -e "$app_dir/.env" ]]; then
  postgres_password=$(openssl rand -hex 32)
  jwt_token=$(openssl rand -hex 48)
  {
    printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
    printf 'JWT_TOKEN=%s\n' "$jwt_token"
    printf '%s\n' \
      'SITE_URL=https://blog.dcelysion.cn' \
      'SERVER_URL=https://comments.dcelysion.cn' \
      'SECURE_DOMAINS=blog.dcelysion.cn,comments.dcelysion.cn,localhost,127.0.0.1' \
      'COMMENT_AUDIT=true' \
      'AUTHOR_EMAIL=dcelysion@gmail.com' \
      'SMTP_HOST=' \
      'SMTP_PORT=465' \
      'SMTP_SECURE=true' \
      'SMTP_USER=' \
      'SMTP_PASS='
  } > "$app_dir/.env"
  chmod 0600 "$app_dir/.env"
  unset postgres_password jwt_token
fi

printf '%s\n' 'Directories prepared. Existing secrets, data and public routes preserved.'
