'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHandler, digest, normalizeEmail, validPassword } = require('./service.js');

class MemoryPool {
  constructor(users) {
    this.state = { users, tokens: [], limits: new Map() };
    this.lock = Promise.resolve();
  }

  async connect() {
    let snapshot;
    let unlock;
    const pool = this;
    return {
      async query(sql, values = []) {
        if (sql === 'BEGIN') {
          const previous = pool.lock;
          pool.lock = new Promise((resolve) => { unlock = resolve; });
          await previous;
          snapshot = structuredClone(pool.state);
          return { rows: [] };
        }
        if (sql === 'COMMIT') { pool.state = snapshot; unlock(); return { rows: [] }; }
        if (sql === 'ROLLBACK') { unlock(); return { rows: [] }; }
        if (sql.startsWith('SELECT pg_advisory') || sql.startsWith('DELETE FROM dc_password_reset WHERE expires_at') ||
          sql.startsWith('DELETE FROM dc_password_reset_limit WHERE window_started_at')) return { rows: [] };
        if (sql.startsWith('SELECT window_started_at')) {
          const row = snapshot.limits.get(values[0].toString('hex'));
          return { rows: row ? [row] : [] };
        }
        if (sql.startsWith('INSERT INTO dc_password_reset_limit')) {
          const key = values[0].toString('hex');
          const before = snapshot.limits.get(key);
          snapshot.limits.set(key, { window_started_at: values[1] && before ? before.window_started_at : new Date(),
            request_count: values[1] && before ? before.request_count + 1 : 1,
            next_allowed_at: new Date(Date.now() + 60000) });
          return { rows: [] };
        }
        if (sql.startsWith('SELECT id, email, type FROM wl_users')) {
          const user = snapshot.users.find((candidate) => candidate.email.toLowerCase() === values[0]);
          return { rows: user ? [user] : [] };
        }
        if (sql.startsWith('DELETE FROM dc_password_reset WHERE user_id')) {
          snapshot.tokens = snapshot.tokens.filter((entry) => entry.user_id !== values[0]);
          return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO dc_password_reset (')) {
          snapshot.tokens.push({ user_id: values[0], token_digest: values[1].toString('hex'), requested_email: values[2],
            expires_at: new Date(Date.now() + 15 * 60000), consumed_at: null });
          return { rows: [] };
        }
        if (sql.startsWith('SELECT r.user_id')) {
          const token = snapshot.tokens.find((entry) => entry.token_digest === values[0].toString('hex'));
          const user = snapshot.users.find((entry) => entry.id === token?.user_id);
          return { rows: token && user ? [{ ...token, email: user.email, type: user.type }] : [] };
        }
        if (sql.startsWith('UPDATE wl_users SET password')) {
          const user = snapshot.users.find((entry) => entry.id === values[1]);
          user.password = values[0];
          user.auth_version++;
          snapshot.tokens = snapshot.tokens.filter((entry) => entry.user_id !== user.id);
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      release() {},
    };
  }

  async query(sql, values) {
    if (sql.startsWith('SELECT 1 FROM dc_password_reset WHERE token_digest')) {
      const active = this.state.tokens.some((entry) => entry.token_digest === values[0].toString('hex') && entry.expires_at > new Date());
      return { rows: active ? [{ '?column?': 1 }] : [] };
    }
    if (sql.startsWith('DELETE FROM dc_password_reset WHERE token_digest')) {
      this.state.tokens = this.state.tokens.filter((entry) => entry.token_digest !== values[0].toString('hex'));
      return { rows: [] };
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  }
}

function fixture(users = [{ id: 1, email: 'test@example.com', type: 'guest', password: 'old', auth_version: 0 }], failMail = false) {
  const pool = new MemoryPool(users);
  const sent = [];
  const logs = [];
  const mailer = { async sendMail(message) { if (failMail) throw new Error('sensitive SMTP details'); sent.push(message); } };
  const app = createHandler({ pool, mailer, env: { SERVER_URL: 'https://comments.example.com', SITE_NAME: 'DcElysion', SMTP_USER: 'sender@example.com' },
    log: { info: (message) => logs.push(message), error: (message) => logs.push(message) }, hashPassword: (value) => `hash:${value}` });
  return { pool, sent, logs, app };
}

function mailToken(message) {
  return /#token=([A-Za-z0-9_-]{43})/u.exec(message.text)?.[1];
}

test('email normalization and password length are bounded without rewriting aliases', () => {
  assert.equal(normalizeEmail('  A.Name+tag@Example.COM  '), 'a.name+tag@example.com');
  assert.equal(normalizeEmail('bad'), null);
  assert.equal(validPassword('１２３４５６７８９０１２'), true);
  assert.equal(validPassword('short'), false);
});

test('request and reset are single-use, revoke sessions, and preserve Chinese mail text', async () => {
  const { pool, sent, app } = fixture();
  assert.equal((await app.request('test@example.com')).status, 202);
  await app.drain();
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /重置密码/u);
  assert.match(sent[0].text, /15 分钟/u);
  const token = mailToken(sent[0]);
  assert.equal(digest(token).toString('hex'), pool.state.tokens[0].token_digest);
  assert.equal((await app.confirm(token, 'new-password-123')).status, 200);
  assert.equal(pool.state.users[0].password, 'hash:new-password-123');
  assert.equal(pool.state.users[0].auth_version, 1);
  assert.equal((await app.confirm(token, 'another-password-123')).status, 400);
});

test('unknown, unverified and banned addresses have the same successful request response and receive no mail', async () => {
  const { app, sent } = fixture([{ id: 1, email: 'blocked@example.com', type: 'banned' },
    { id: 2, email: 'pending@example.com', type: 'verify:1234:0' }]);
  const responses = await Promise.all(['missing@example.com', 'blocked@example.com', 'pending@example.com'].map((email) => app.request(email)));
  assert.deepEqual(responses.map(({ status, body }) => [status, body.data.message]),
    Array(3).fill([202, responses[0].body.data.message]));
  await app.drain();
  assert.equal(sent.length, 0);
});

test('expired, replaced and concurrent replayed links fail', async () => {
  const { app, pool, sent } = fixture();
  await app.request('test@example.com'); await app.drain();
  const old = mailToken(sent[0]);
  pool.state.limits.clear();
  await app.request('test@example.com'); await app.drain();
  const latest = mailToken(sent[1]);
  assert.equal((await app.confirm(old, 'new-password-123')).status, 400);
  const results = await Promise.all([app.confirm(latest, 'first-password-123'), app.confirm(latest, 'second-password-123')]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
  pool.state.limits.clear();
  await app.request('test@example.com'); await app.drain();
  pool.state.tokens[0].expires_at = new Date(Date.now() - 1000);
  assert.equal((await app.confirm(mailToken(sent[2]), 'another-password-123')).status, 400);
});

test('mail failure removes unsent token and logs no sensitive exception', async () => {
  const { app, pool, logs } = fixture(undefined, true);
  assert.equal((await app.request('test@example.com')).status, 202);
  await app.drain();
  assert.equal(pool.state.tokens.length, 0);
  assert.equal(logs.some((line) => line.includes('sensitive')), false);
});

test('password update failure rolls back without consuming the token', async () => {
  const { app, pool, sent } = fixture();
  await app.request('test@example.com'); await app.drain();
  const token = mailToken(sent[0]);
  const broken = createHandler({ pool, mailer: { async sendMail() {} },
    env: { SERVER_URL: 'https://comments.example.com' },
    hashPassword() { throw new Error('simulated hash failure'); },
    log: { error() {}, info() {} } });
  assert.equal((await broken.confirm(token, 'new-password-123')).status, 503);
  assert.equal(pool.state.tokens.length, 1);
  assert.equal(pool.state.users[0].password, 'old');
  assert.equal((await app.confirm(token, 'new-password-123')).status, 200);
});

test('database connection failure returns a service error without exposing details', async () => {
  const logs = [];
  const app = createHandler({
    pool: { async connect() { throw new Error('private database address'); } },
    mailer: { async sendMail() {} },
    env: { SERVER_URL: 'https://comments.example.com' },
    log: { error(message) { logs.push(message); } },
  });
  const token = 'a'.repeat(43);
  for (const response of [await app.request('test@example.com'), await app.confirm(token, 'new-password-123')]) {
    assert.equal(response.status, 503);
    assert.equal(response.body.errno, 503);
    assert.doesNotMatch(JSON.stringify(response.body), /private database address/u);
  }
  assert.equal(logs.length, 2);
  assert.equal(logs.some((message) => message.includes('private database address')), false);
});
