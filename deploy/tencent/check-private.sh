#!/usr/bin/env bash
set -euo pipefail
cd /opt/dcelysion
docker compose config --quiet
docker compose ps
docker compose exec -T postgres psql -U waline -d waline -c '\dt'
docker compose exec -T waline node <<'NODE'
const nodemailer = require('nodemailer');
const smtp = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 15000,
});
smtp.verify().then(() => {
  console.log('SMTP authentication verified (no email sent).');
  smtp.close();
}).catch((error) => {
  console.error('SMTP verification failed:', error.code, error.responseCode);
  smtp.close();
  process.exitCode = 1;
});
NODE
curl --fail --silent --show-error -H 'Origin: https://blog.dcelysion.cn' -H 'Referer: https://blog.dcelysion.cn/' http://127.0.0.1:8360/api/comment?path=/guestbook > /dev/null
printf '%s\n' 'Private comment API responds successfully.'
stat -c 'Secret file permissions: %a %U' .env
