'use strict';

const crypto = require('node:crypto');
const http = require('node:http');

const GENERIC = '如果该邮箱对应可找回的账号，我们会发送重置邮件。请检查收件箱和垃圾邮件。';
const EXPIRED = '链接已失效，请重新申请';
const WINDOW_MS = 60 * 60 * 1000;
const TOKEN_MS = 15 * 60 * 1000;
const QUEUE_LIMIT = 20;

function digest(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : null;
}

function validPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 1024 &&
    Buffer.byteLength(value, 'utf8') <= 4096;
}

function makeMailer(env) {
  const nodemailer = require('nodemailer');
  const config = env.SMTP_SERVICE
    ? { service: env.SMTP_SERVICE }
    : { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 465), secure: env.SMTP_SECURE !== 'false' };
  config.auth = { user: env.SMTP_USER, pass: env.SMTP_PASS };
  config.connectionTimeout = 8000;
  config.greetingTimeout = 8000;
  config.socketTimeout = 10000;
  return nodemailer.createTransport(config);
}

function createHandler({ pool, mailer, env, log = console, hashPassword = (password) => new (require('phpass').PasswordHash)().hashPassword(password) }) {
  const baseUrl = new URL(env.PASSWORD_RESET_ORIGIN || env.SERVER_URL);
  if (!['https:', 'http:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('Invalid PASSWORD_RESET_ORIGIN');
  }
  if (baseUrl.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(baseUrl.hostname)) {
    throw new Error('Password reset origin must use HTTPS outside loopback');
  }
  const origin = baseUrl.origin;
  const queue = [];
  let drainPromise = null;

  function drain() {
    if (drainPromise) return drainPromise;
    drainPromise = (async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        try {
          const active = await pool.query('SELECT 1 FROM dc_password_reset WHERE token_digest = $1 AND expires_at > now()', [item.tokenDigest]);
          if (active.rows.length === 0) continue;
          const link = `${origin}/ui/reset-password#token=${encodeURIComponent(item.token)}`;
          await mailer.sendMail({
            from: env.SENDER_EMAIL && env.SENDER_NAME
              ? `"${env.SENDER_NAME}" <${env.SENDER_EMAIL}>`
              : env.SMTP_USER,
            to: item.email,
            subject: `【${env.SITE_NAME || 'DcElysion'}】重置密码`,
            text: `请点击以下链接设置新密码：\n${link}\n\n链接在 15 分钟内有效。如果不是您本人申请，请忽略这封邮件。\n${env.SITE_NAME || 'DcElysion'}`,
            html: `<p>请点击以下链接设置新密码：</p><p><a href="${link}">设置新密码</a></p><p>链接在 15 分钟内有效。如果不是您本人申请，请忽略这封邮件。</p><p>${env.SITE_NAME || 'DcElysion'}</p>`,
          });
          log.info('Password reset mail accepted by SMTP');
        } catch {
          // Mail transport errors may include addresses, credentials or links.
          log.error('Password reset mail failed');
          try {
            await pool.query('DELETE FROM dc_password_reset WHERE token_digest = $1', [item.tokenDigest]);
          } catch {
            log.error('Password reset token cleanup failed');
          }
        }
      }
    })().finally(() => {
      drainPromise = null;
      if (queue.length > 0) void drain();
    });
    return drainPromise;
  }

  async function request(email) {
    if (!email) return { status: 400, body: { errno: 400, errmsg: '请输入有效的邮箱地址' } };
    if (queue.length >= QUEUE_LIMIT) return { status: 503, body: { errno: 503, errmsg: '邮件服务繁忙，请稍后重试' } };
    const emailDigest = digest(email);
    let client;
    let item;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [email]);
      const limit = await client.query('SELECT window_started_at, request_count, next_allowed_at FROM dc_password_reset_limit WHERE email_digest = $1 FOR UPDATE', [emailDigest]);
      const now = Date.now();
      const previous = limit.rows[0];
      if (previous && (new Date(previous.next_allowed_at).getTime() > now ||
        (now - new Date(previous.window_started_at).getTime() < WINDOW_MS && previous.request_count >= 5))) {
        await client.query('COMMIT');
        return { status: 429, body: { errno: 429, errmsg: '请求过于频繁，请稍后重试' } };
      }
      const inWindow = previous && now - new Date(previous.window_started_at).getTime() < WINDOW_MS;
      await client.query(`INSERT INTO dc_password_reset_limit (email_digest, window_started_at, request_count, next_allowed_at)
        VALUES ($1, now(), 1, now() + interval '60 seconds')
        ON CONFLICT (email_digest) DO UPDATE SET
          window_started_at = CASE WHEN $2 THEN dc_password_reset_limit.window_started_at ELSE now() END,
          request_count = CASE WHEN $2 THEN dc_password_reset_limit.request_count + 1 ELSE 1 END,
          next_allowed_at = now() + interval '60 seconds'`, [emailDigest, Boolean(inWindow)]);
      const found = await client.query(`SELECT id, email, type FROM wl_users
        WHERE lower(trim(email)) = $1 ORDER BY id LIMIT 1 FOR UPDATE`, [email]);
      const user = found.rows[0];
      if (user && user.type !== 'banned' && !/^verify:/iu.test(user.type)) {
        const token = crypto.randomBytes(32).toString('base64url');
        const tokenDigest = digest(token);
        await client.query('DELETE FROM dc_password_reset WHERE user_id = $1', [user.id]);
        await client.query(`INSERT INTO dc_password_reset (user_id, token_digest, requested_email, expires_at)
          VALUES ($1, $2, $3, now() + interval '15 minutes')`, [user.id, tokenDigest, user.email]);
        item = { token, tokenDigest, email: user.email };
      }
      await client.query(`DELETE FROM dc_password_reset WHERE expires_at < now() - interval '1 day'`);
      await client.query(`DELETE FROM dc_password_reset_limit WHERE window_started_at < now() - interval '2 days'`);
      await client.query('COMMIT');
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      log.error('Password reset request database failed');
      return { status: 503, body: { errno: 503, errmsg: '服务暂不可用，请稍后重试' } };
    } finally {
      client?.release();
    }
    if (item) {
      queue.push(item);
      void drain();
    }
    return { status: 202, body: { errno: 0, data: { message: GENERIC } } };
  }

  async function confirm(token, password) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      return { status: 400, body: { errno: 400, errmsg: EXPIRED } };
    }
    if (!validPassword(password)) {
      return { status: 422, body: { errno: 422, errmsg: '密码至少 12 个字符，最多 1024 个字符且不超过 4096 字节' } };
    }
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const result = await client.query(`SELECT r.user_id, r.requested_email, r.expires_at, r.consumed_at,
        u.email, u.type FROM dc_password_reset r JOIN wl_users u ON u.id = r.user_id
        WHERE r.token_digest = $1 FOR UPDATE OF u, r`, [digest(token)]);
      const row = result.rows[0];
      if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now() ||
        row.email !== row.requested_email || row.type === 'banned' || /^verify:/iu.test(row.type)) {
        await client.query('ROLLBACK');
        return { status: 400, body: { errno: 400, errmsg: EXPIRED } };
      }
      const hash = hashPassword(password);
      await client.query('UPDATE wl_users SET password = $1, updatedat = now() WHERE id = $2', [hash, row.user_id]);
      // The database trigger increments auth_version and revokes all reset links.
      await client.query('COMMIT');
      return { status: 200, body: { errno: 0, data: { message: '密码已更新，请重新登录' } } };
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      log.error('Password reset confirmation failed');
      return { status: 503, body: { errno: 503, errmsg: '服务暂不可用，请稍后重试' } };
    } finally {
      client?.release();
    }
  }

  async function handle(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'POST' || !['/api/password-reset/request', '/api/password-reset/confirm'].includes(req.url)) {
      res.writeHead(404).end(JSON.stringify({ errno: 404, errmsg: '页面不存在' }));
      return;
    }
    let raw = '';
    try {
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 8192) throw new Error('too large');
      }
      const input = JSON.parse(raw);
      const result = req.url.endsWith('/request')
        ? await request(normalizeEmail(input.email))
        : await confirm(input.token, input.password);
      res.writeHead(result.status).end(JSON.stringify(result.body));
    } catch {
      res.writeHead(400).end(JSON.stringify({ errno: 400, errmsg: '请求格式错误' }));
    }
  }
  return { handle, request, confirm, drain, queue };
}

if (require.main === module) {
  const { Pool } = require('pg');
  const env = process.env;
  if ((!env.SMTP_HOST && !env.SMTP_SERVICE) || !env.PG_HOST || !env.PG_PASSWORD) {
    throw new Error('Password reset requires PostgreSQL and SMTP settings');
  }
  const pool = new Pool({ host: env.PG_HOST, port: Number(env.PG_PORT || 5432),
    database: env.PG_DB, user: env.PG_USER, password: env.PG_PASSWORD, max: 5 });
  const mailer = makeMailer(env);
  const app = createHandler({ pool, mailer, env });
  http.createServer(app.handle).listen(8362, '0.0.0.0');
}

module.exports = { createHandler, normalizeEmail, validPassword, digest, makeMailer };
