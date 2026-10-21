'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { enabled, makeMail, deliverOne, start } = require('./src/lib/interaction-mail-worker.js');
const env = { INTERACTION_NOTIFY_ENABLED: 'true', INTERACTION_NOTIFY_EMAIL: 'owner@example.invalid',
  AUTHOR_EMAIL: 'author@example.invalid', SITE_URL: 'https://blog.example.invalid', SMTP_USER: 'sender@example.invalid' };
const log = { info() {}, error() {} };
async function fixture() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(readFileSync(path.join(__dirname, '../vendor/waline.pgsql'), 'utf8'));
  await db.exec(`INSERT INTO wl_users(id,display_name,email,type) VALUES
    (1,'visitor','visitor@example.invalid','guest'),(2,'admin','admin@example.invalid','administrator'),
    (3,'owner','owner@example.invalid','guest');`);
  await db.exec(readFileSync(path.join(__dirname, '005_content_likes.sql'), 'utf8'));
  await db.exec(`INSERT INTO dc_content_likes(path,user_id) VALUES('/historical',1);
    INSERT INTO wl_comment(id,nick,url,comment,status) VALUES(100,'old','/old','old','approved');`);
  const migration = readFileSync(path.join(__dirname, '006_interaction_mail.sql'), 'utf8');
  await db.exec(migration);
  return { db, migration };
}
test('real schema migration queues atomic new events, retains dedup across unlike and migration re-entry', async () => {
  const { db, migration } = await fixture();
  try {
    await db.exec(`INSERT INTO dc_content_likes(path,user_id) VALUES('/posts/new',1);
      DELETE FROM dc_content_likes WHERE path='/posts/new';
      INSERT INTO dc_content_likes(path,user_id) VALUES('/posts/new',1),('/admin',2);
      INSERT INTO wl_comment(id,user_id,nick,url,comment,status) VALUES
        (101,1,'ignored','/guestbook','hello','waiting'),(102,2,'admin','/a','own','approved'),
        (103,NULL,'anonymous','/dynamic/1','message','approved'),(104,1,'spam','/a','spam','spam');
      UPDATE wl_comment SET status='approved' WHERE id=101;`);
    const rows = (await db.query('SELECT * FROM dc_interaction_mail ORDER BY event_key')).rows;
    assert.deepEqual(rows.map(row => row.event_key), ['comment:101', 'comment:103', 'like:1:/historical', 'like:1:/posts/new']);
    assert.equal(rows[0].payload.nick, 'visitor');
    assert.equal(rows[0].payload.status, 'waiting');
    assert.ok(rows[2].finished_at);
    await db.exec(migration);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM dc_interaction_mail')).rows[0].n, 4);
    await db.exec("BEGIN; INSERT INTO dc_content_likes(path,user_id) VALUES('/rolled-back',1); ROLLBACK;");
    assert.equal((await db.query("SELECT * FROM dc_interaction_mail WHERE event_key='like:1:/rolled-back'")).rows.length, 0);
  } finally { await db.close(); }
});
test('delivery failure persists safely; a fresh worker retries, concurrent claims do not double send, own events skip', async () => {
  const { db } = await fixture();
  try {
    await db.exec("INSERT INTO dc_content_likes(path,user_id) VALUES('/retry',1);");
    await deliverOne(db, { sendMail: async () => { throw new Error('SECRET credential'); } }, env, log);
    let row = (await db.query("SELECT * FROM dc_interaction_mail WHERE event_key='like:1:/retry'")).rows[0];
    assert.equal(row.attempts, 1); assert.equal(row.last_error, 'DELIVERY_FAILED');
    assert.ok(row.next_attempt_at > new Date()); assert.equal(row.finished_at, null);
    await db.exec('UPDATE dc_interaction_mail SET next_attempt_at=now() WHERE finished_at IS NULL');
    let sent = 0;
    const mailer = { sendMail: async mail => { sent++; assert.equal(mail.to, env.INTERACTION_NOTIFY_EMAIL); return { accepted: [mail.to], rejected: [] }; } };
    await Promise.all([deliverOne(db, mailer, env, log), deliverOne(db, mailer, env, log)]);
    assert.equal(sent, 1);
    row = (await db.query("SELECT * FROM dc_interaction_mail WHERE event_key='like:1:/retry'")).rows[0];
    assert.equal(row.attempts, 2); assert.ok(row.finished_at); assert.deepEqual(row.payload, {});
    await db.exec("DELETE FROM dc_content_likes WHERE path='/retry'; INSERT INTO dc_content_likes(path,user_id) VALUES('/retry',1),('/own',3);");
    await deliverOne(db, mailer, env, log); assert.equal(sent, 1);
    await db.exec("INSERT INTO dc_content_likes(path,user_id) VALUES('/no-smtp',1)");
    for (let i = 0; i < 5; i++) {
      await deliverOne(db, null, env, log);
      await db.exec('UPDATE dc_interaction_mail SET next_attempt_at=now() WHERE finished_at IS NULL');
    }
    assert.equal(await deliverOne(db, mailer, env, log), false);
    row = (await db.query("SELECT * FROM dc_interaction_mail WHERE event_key='like:1:/no-smtp'")).rows[0];
    assert.equal(row.attempts, 5); assert.equal(row.last_error, 'SMTP_NOT_CONFIGURED'); assert.equal(row.finished_at, null);
  } finally { await db.close(); }
});
test('leases recover after restart, and worker lifecycle drains without incoming HTTP requests', async () => {
  const { db } = await fixture();
  try {
    await db.exec("INSERT INTO dc_content_likes(path,user_id) VALUES('/crash',1);");
    // A previous process died after claiming an attempt.
    await db.exec("UPDATE dc_interaction_mail SET attempts=1,last_error='WORKER_INTERRUPTED',next_attempt_at=now()-interval '1 second' WHERE finished_at IS NULL");
    let sent = 0; let ended = false;
    const pool = { query: (...args) => db.query(...args), end: async () => { ended = true; } };
    await start({ db: pool, env, log, mailer: { sendMail: async () => {
      sent++; process.emit('SIGTERM'); return { accepted: [env.INTERACTION_NOTIFY_EMAIL] };
    } } });
    assert.equal(sent, 1); assert.equal(ended, true);
    assert.equal((await db.query("SELECT attempts FROM dc_interaction_mail WHERE event_key='like:1:/crash'")).rows[0].attempts, 2);
  } finally { await db.close(); }
});
test('mail escapes visitor HTML and uses only configured site origin; enable switch is explicit', () => {
  assert.equal(enabled({ INTERACTION_NOTIFY_EMAIL: 'owner@example.invalid' }), false);
  assert.equal(enabled(env), true);
  const mail = makeMail({ kind: 'comment', nick: '<img onerror="bad">', comment: '<script>alert(1)</script>', path: '/guestbook', id: '42', status: 'waiting' }, env);
  assert.ok(mail.html.includes('&lt;script&gt;')); assert.ok(!mail.html.includes('<img'));
  assert.ok(mail.html.includes('https://blog.example.invalid/guestbook#42'));
  assert.ok(!mail.html.includes('visitor@example.invalid'));
  for (const path of ['https://evil.invalid', '//evil.invalid', '/%2f%2fevil.invalid', '/a?redirect=x', '/a\\b']) {
    assert.throws(() => makeMail({ kind: 'like', path }, env), /INVALID_PATH/);
  }
  assert.throws(() => makeMail({ kind: 'like', path: '/' }, { ...env, SITE_URL: 'javascript:alert(1)' }), /INVALID_SITE_URL/);
});
test('new channel suppresses only the legacy author mail after explicit enable; reply mail remains', async () => {
  const vm = require('node:vm');
  const module = { exports: {} };
  const runtimeEnv = { ...env, INTERACTION_NOTIFY_ENABLED: 'false' };
  vm.runInNewContext(readFileSync(path.join(__dirname, 'src/service/notify.js'), 'utf8'), {
    module, process: { env: runtimeEnv }, console: log,
    think: { Service: class {}, isEmpty: value => !value },
    require: name => name.includes('interaction-mail-worker') ? { enabled }
      : name.includes('nodemailer') ? { createTransport() {} } : {},
  });
  const notify = new module.exports({ ctx: { state: { oauthServices: [{ name: 'github' }] } } });
  for (const method of ['wechat', 'qywxAmWechat', 'qq', 'telegram', 'pushplus', 'discord', 'lark']) notify[method] = async () => false;
  let mails = [];
  notify.mail = async mail => { mails.push(mail.to); };
  const comment = { type: 'guest', status: 'approved', mail: 'visitor@example.invalid', user_id: 1 };
  const parent = { type: 'guest', mail: 'parent@example.invalid', user_id: 2 };
  await notify.run(comment, parent);
  assert.deepEqual(mails, [env.AUTHOR_EMAIL, parent.mail]);
  runtimeEnv.INTERACTION_NOTIFY_ENABLED = 'true'; mails = [];
  // A successful second channel must not affect the independent outbox delivery.
  notify.wechat = async () => ({ success: true });
  await notify.run(comment, parent);
  assert.deepEqual(mails, [parent.mail]);
});
