'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { PasswordHash } = require('phpass');
const { SMTPServer } = require('smtp-server');
const { createHandler, makeMailer } = require('./service.js');

function serialPool(db) {
  let lock = Promise.resolve();
  return {
    async connect() {
      let unlock;
      let locked = false;
      return {
        async query(sql, params) {
          if (sql === 'BEGIN') {
            const previous = lock;
            lock = new Promise((resolve) => { unlock = resolve; });
            await previous;
            locked = true;
          }
          try { return await db.query(sql, params); }
          finally {
            if (locked && (sql === 'COMMIT' || sql === 'ROLLBACK')) { locked = false; unlock(); }
          }
        },
        release() { if (locked) unlock(); },
      };
    },
    query(sql, params) { return db.query(sql, params); },
  };
}

function decodeMimeSubject(raw) {
  const header = /^Subject: [^\r\n]*(?:\r\n[ \t][^\r\n]*)*/imu.exec(raw)?.[0] || '';
  const encoded = [...header.matchAll(/=\?UTF-8\?Q\?([^?]+)\?=/giu)].map((match) => match[1]).join('');
  const bytes = [];
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === '=') { bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16)); index += 2; }
    else bytes.push(encoded.charCodeAt(index));
  }
  return Buffer.from(bytes).toString('utf8');
}

test('real PostgreSQL migration, hashed password, reset and profile change triggers', async () => {
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, '../vendor/waline.pgsql'), 'utf8'));
    const migration = fs.readFileSync(path.join(__dirname, '001_password_reset.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const hasher = new PasswordHash();
    const oldHash = hasher.hashPassword('old-password-123');
    const inserted = await db.query(`INSERT INTO wl_users (display_name, email, password, type, "2fa")
      VALUES ('Test', 'person@example.com', $1, 'guest', 'JBSWY3DPEHPK3PXP') RETURNING id`, [oldHash]);
    const id = inserted.rows[0].id;
    const unaffected = await db.query(`INSERT INTO wl_users (display_name, email, password, type)
      VALUES ('Other', 'other@example.com', $1, 'guest') RETURNING id`, [oldHash]);
    const sent = [];
    const app = createHandler({ pool: serialPool(db), mailer: { async sendMail(message) { sent.push(message); } },
      env: { SERVER_URL: 'http://127.0.0.1:18360', SMTP_USER: 'sender@example.com' } });
    assert.equal((await app.request('person@example.com')).status, 202);
    await app.drain();
    const token = /#token=([A-Za-z0-9_-]{43})/u.exec(sent[0].text)[1];
    const before = await db.query('SELECT password, auth_version FROM wl_users WHERE id = $1', [id]);
    assert.equal(before.rows[0].auth_version, 0);
    assert.equal(hasher.checkPassword('old-password-123', before.rows[0].password), true);
    assert.equal((await app.confirm(token, 'new-password-123')).status, 200);
    const after = await db.query('SELECT password, auth_version, type, email, "2fa" FROM wl_users WHERE id = $1', [id]);
    assert.equal(hasher.checkPassword('new-password-123', after.rows[0].password), true);
    assert.equal(hasher.checkPassword('old-password-123', after.rows[0].password), false);
    assert.equal(after.rows[0].auth_version, 1);
    assert.equal(after.rows[0].type, 'guest');
    assert.equal(after.rows[0].email, 'person@example.com');
    assert.equal(after.rows[0]['2fa'], 'JBSWY3DPEHPK3PXP');
    assert.equal((await db.query('SELECT auth_version FROM wl_users WHERE id = $1', [unaffected.rows[0].id])).rows[0].auth_version, 0);
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM dc_password_reset')).rows[0].count, 0);
    assert.equal((await app.confirm(token, 'other-password-123')).status, 400);

    await db.query(`UPDATE dc_password_reset_limit SET next_allowed_at = now() - interval '1 second'`);
    assert.equal((await app.request('person@example.com')).status, 202);
    await app.drain();
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM dc_password_reset')).rows[0].count, 1);
    await db.query('UPDATE wl_users SET email = $1 WHERE id = $2', ['changed@example.com', id]);
    assert.equal((await db.query('SELECT auth_version FROM wl_users WHERE id = $1', [id])).rows[0].auth_version, 2);
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM dc_password_reset')).rows[0].count, 0);

    // HTTP entry point and a local SMTP receiver use no external recipients.
    const received = [];
    const smtp = new SMTPServer({ secure: false, disabledCommands: ['STARTTLS'],
      onAuth(auth, _session, callback) {
        callback(auth.username === 'sender@example.com' && auth.password === 'test-secret' ? null : new Error('auth failed'), { user: auth.username });
      },
      onData(stream, session, callback) {
        let raw = '';
        stream.on('data', (chunk) => { raw += chunk; });
        stream.on('end', () => { received.push({ raw, recipient: session.envelope.rcptTo[0].address }); callback(); });
      },
    });
    await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
    const env = { SERVER_URL: 'http://127.0.0.1:18360', SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtp.server.address().port), SMTP_SECURE: 'false', SMTP_USER: 'sender@example.com', SMTP_PASS: 'test-secret' };
    const smtpApp = createHandler({ pool: serialPool(db), mailer: makeMailer(env), env });
    const api = http.createServer(smtpApp.handle);
    await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${api.address().port}/api/password-reset/request`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'changed@example.com', lang: 'en' }),
      });
      assert.equal(response.status, 202);
      assert.equal((await response.json()).errno, 0);
      await smtpApp.drain();
      assert.equal(received.length, 1);
      assert.equal(received[0].recipient, 'changed@example.com');
      assert.match(received[0].raw, /token=/u);
      assert.match(decodeMimeSubject(received[0].raw), /重置密码/u);
      await db.query(`UPDATE dc_password_reset_limit SET next_allowed_at = now() - interval '1 second'`);
      const second = await fetch(`http://127.0.0.1:${api.address().port}/api/password-reset/request`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'changed@example.com', lang: 'zh-CN' }),
      });
      assert.equal(second.status, 202);
      await smtpApp.drain();
      assert.equal(received.length, 2);
      assert.match(decodeMimeSubject(received[1].raw), /重置密码/u);
    } finally {
      await new Promise((resolve) => api.close(resolve));
      await new Promise((resolve) => smtp.close(resolve));
    }
  } finally {
    await db.close();
  }
});
