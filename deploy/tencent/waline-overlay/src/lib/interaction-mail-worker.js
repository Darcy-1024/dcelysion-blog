'use strict';

const { normalizePath } = require('./content-like-store.js');
const { getPool } = require('./avatar-store.js');
const MAX_ATTEMPTS = 5;
const BACKOFF = [30, 120, 600, 1800, 1800];

function enabled(env) {
  return env.INTERACTION_NOTIFY_ENABLED === 'true' && Boolean(env.INTERACTION_NOTIFY_EMAIL?.trim());
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}
function makeMail(payload, env) {
  const origin = new URL(env.SITE_URL);
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('INVALID_SITE_URL');
  // Revalidate DB content; never let visitor input replace the configured origin.
  const path = normalizePath(payload.path);
  const url = `${origin.origin}${path}${payload.kind === 'comment' ? `#${encodeURIComponent(payload.id)}` : ''}`;
  const action = payload.kind === 'like' ? '新点赞' : '新留言 / 评论';
  const nick = String(payload.nick || '访客').slice(0, 255);
  const comment = String(payload.comment || '').slice(0, 20000);
  const status = payload.kind === 'comment' ? `\n状态：${payload.status || 'approved'}` : '';
  return {
    from: env.SENDER_EMAIL && env.SENDER_NAME
      ? { name: env.SENDER_NAME, address: env.SENDER_EMAIL } : env.SMTP_USER,
    to: env.INTERACTION_NOTIFY_EMAIL.trim(),
    subject: `【${env.SITE_NAME || 'DcElysion'}】${action}`,
    text: `${nick}：${action}${status}\n${comment}\n${url}`,
    html: `<p>${escapeHtml(nick)}：${action}${escapeHtml(status)}</p><pre>${escapeHtml(comment)}</pre><p><a href="${escapeHtml(url)}">查看互动</a></p>`,
  };
}
function makeMailer(env) {
  if (!(env.SMTP_HOST || env.SMTP_SERVICE) || !env.SMTP_USER || !env.SMTP_PASS) return null;
  const nodemailer = require('../../password-reset/node_modules/nodemailer');
  return nodemailer.createTransport({
    ...(env.SMTP_SERVICE ? { service: env.SMTP_SERVICE } : {
      host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 465), secure: env.SMTP_SECURE !== 'false',
    }),
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000,
  });
}
async function deliverOne(db, mailer, env, log = console) {
  if (!enabled(env)) return false;
  // Atomic lease supports concurrent workers; a crash is recovered after two minutes.
  const result = await db.query(`UPDATE dc_interaction_mail SET attempts=attempts+1,last_error='WORKER_INTERRUPTED',
    next_attempt_at=now()+interval '2 minutes' WHERE event_key=(
      SELECT event_key FROM dc_interaction_mail WHERE finished_at IS NULL AND attempts<$1
        AND next_attempt_at<=now() ORDER BY next_attempt_at,event_key FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING *`, [MAX_ATTEMPTS]);
  const row = result.rows[0];
  if (!row) return false;
  try {
    const ownMail = String(row.payload.mail || '').trim().toLowerCase();
    const isOwn = ownMail && [env.AUTHOR_EMAIL, env.INTERACTION_NOTIFY_EMAIL]
      .some(mail => mail?.trim().toLowerCase() === ownMail);
    if (!isOwn) {
      if (!mailer) throw new Error('SMTP_NOT_CONFIGURED');
      const response = await mailer.sendMail(makeMail(row.payload, env));
      if (!response?.accepted?.length || response.rejected?.length) throw new Error('SMTP_NOT_ACCEPTED');
    }
    await db.query(`UPDATE dc_interaction_mail SET finished_at=now(),payload='{}'::jsonb,
      last_error=NULL WHERE event_key=$1 AND attempts=$2`, [row.event_key, row.attempts]);
    log.info('Interaction mail completed');
  } catch (error) {
    // Never persist/log raw SMTP errors: they may include credentials or addresses.
    const code = ['SMTP_NOT_CONFIGURED', 'SMTP_NOT_ACCEPTED', 'INVALID_SITE_URL', 'INVALID_PATH']
      .includes(error.message) ? error.message : 'DELIVERY_FAILED';
    await db.query(`UPDATE dc_interaction_mail SET last_error=$2,
      next_attempt_at=now()+($3::integer * interval '1 second') WHERE event_key=$1 AND attempts=$4`,
    [row.event_key, code, BACKOFF[row.attempts - 1], row.attempts]);
    log.error(`Interaction mail failed (${row.attempts}/${MAX_ATTEMPTS}; ${code})`);
  }
  return true;
}
async function start({ db = getPool(), env = process.env, mailer = makeMailer(env), log = console } = {}) {
  if (!enabled(env)) throw new Error('Interaction mail worker is disabled');
  let stopped = false;
  let wake;
  const stop = () => { stopped = true; wake?.(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    while (!stopped) {
      let worked = false;
      try { worked = await deliverOne(db, mailer, env, log); }
      catch { log.error('Interaction mail queue unavailable'); }
      if (!worked && !stopped) await new Promise(resolve => {
        const timer = setTimeout(resolve, 2000);
        wake = () => { clearTimeout(timer); resolve(); };
      });
    }
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    mailer?.close?.();
    await db.end?.();
  }
}
if (require.main === module) start().catch(() => {
  console.error('Interaction mail worker cannot start'); process.exitCode = 1;
});
module.exports = { enabled, makeMail, deliverOne, start };
