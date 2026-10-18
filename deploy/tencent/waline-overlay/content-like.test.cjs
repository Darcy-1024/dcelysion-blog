'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizePath, normalizeOffset, readLikes, saveLike } = require('./src/lib/content-like-store.js');

test('content keys normalize trailing slashes and Unicode; malformed paths/offsets are bounded', () => {
  for (const [input, expected] of [['/posts/test/', '/posts/test'], ['/dynamic//1', '/dynamic/1'],
    ['/posts/中文', '/posts/%E4%B8%AD%E6%96%87'], ['/posts/%e4%b8%ad%e6%96%87/', '/posts/%E4%B8%AD%E6%96%87'], ['/', '/'],
    ['/posts/%252F', '/posts/%252F']]) {
    assert.equal(normalizePath(input), expected);
    assert.equal(normalizePath(expected), expected);
  }
  for (const value of [null, {}, '', 'https://example.com/a', '//example.com/a', '/a?x=1', '/a#b', '/a\\b', '/%2fhost', '/%0a', '/%', '/a b', '/'.repeat(1025)]) {
    assert.throws(() => normalizePath(value), /INVALID_PATH/);
  }
  assert.equal(normalizeOffset(undefined), 0); assert.equal(normalizeOffset('20'), 20);
  for (const value of ['-1', '1.5', '1e2', '01', '10000000', 'x']) assert.throws(() => normalizeOffset(value));
});

test('real SQL enforces account identity, idempotency, current auth_version, paging and minimal public DTO', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const pool = { query: (sql, args) => db.query(sql, args), connect: async () => ({
    query: (sql, args) => db.query(sql, args), release() {},
  }) };
  try {
    await db.exec(`CREATE TABLE wl_users(id integer PRIMARY KEY,display_name text,avatar text,type text,auth_version integer,email text);
      INSERT INTO wl_users SELECT id,'user-'||id,'https://avatar.invalid/'||id,'guest',0,'private-'||id||'@example.invalid'
      FROM generate_series(1,25) id;
      CREATE TABLE wl_counter(path text,reaction0 integer); INSERT INTO wl_counter VALUES('/posts/test',50);`);
    await db.exec(readFileSync(path.join(__dirname, '005_content_likes.sql'), 'utf8'));
    const user = { objectId: 1, auth_version: 0, type: 'guest' };
    await assert.rejects(saveLike(pool, {}, '/posts/test', true), /UNAUTHORIZED/);
    await assert.rejects(saveLike(pool, user, '/posts/test', 'true'), /INVALID_LIKED/);
    assert.equal((await saveLike(pool, user, '/posts/test', true)).count, 1);
    assert.equal((await saveLike(pool, user, '/posts/test', true)).count, 1);
    assert.equal((await saveLike(pool, user, '/dynamic/1', true)).count, 1);
    assert.equal((await readLikes(pool, '/posts/test')).liked, false);
    assert.equal((await readLikes(pool, '/posts/test', 1)).liked, true);
    assert.equal((await saveLike(pool, user, '/posts/test', false)).count, 0);
    assert.equal((await saveLike(pool, user, '/posts/test', false)).count, 0);
    await db.exec(`INSERT INTO dc_content_likes(path,user_id) SELECT '/posts/test',id FROM wl_users;
      UPDATE wl_users SET type='banned' WHERE id=25; UPDATE wl_users SET type='verify:test' WHERE id=24;`);
    const first = await readLikes(pool, '/posts/test', 1);
    assert.equal(first.count, 23); assert.equal(first.liked, true);
    assert.equal(first.users.length, 20); assert.equal(first.hasMore, true); assert.equal(first.nextOffset, 20);
    assert.deepEqual(first.users.map(user => user.id), Array.from({ length: 20 }, (_, i) => 23 - i));
    assert.deepEqual(Object.keys(first.users[0]).sort(), ['avatar', 'id', 'nick']);
    assert.equal(JSON.stringify(first).includes('private-'), false);
    const last = await readLikes(pool, '/posts/test', null, 20);
    assert.deepEqual(last.users.map(user => user.id), [3, 2, 1]); assert.equal(last.hasMore, false); assert.equal(last.nextOffset, null);
    await db.exec('UPDATE wl_users SET auth_version=1 WHERE id=1');
    await assert.rejects(saveLike(pool, user, '/posts/test', false), /UNAUTHORIZED/);
    assert.equal((await readLikes(pool, '/posts/test', 1)).liked, true);
    await assert.rejects(saveLike(pool, { objectId: 25, type: 'guest', auth_version: 0 }, '/posts/test', false), /UNAUTHORIZED/);
    await db.exec('DELETE FROM wl_users WHERE id=1');
    assert.equal((await readLikes(pool, '/posts/test')).count, 22);
    assert.equal((await db.query('SELECT reaction0 FROM wl_counter')).rows[0].reaction0, 50);
  } finally { await db.close(); }
});

function controller(user, body, store) {
  class Base {
    constructor() { this.ctx = { state: { userInfo: user }, set() {}, throw(status) { throw Object.assign(new Error('HTTP'), { status }); } }; }
    get(key) { return { path: '/posts/test', offset: '0' }[key]; }
    post(key) { return body[key]; }
    success(data) { throw Object.assign(new Error('PREVENT_NEXT_PROCESS'), { data }); }
    fail(message) { return { error: message }; }
  }
  const moduleValue = { exports: {} };
  new Function('require', 'module', readFileSync(path.join(__dirname, 'src/controller/content-like.js'), 'utf8'))(
    name => name === './rest.js' ? Base : name.includes('avatar-store') ? { getPool: () => ({}) } : {
      normalizePath, normalizeOffset, readLikes: store, saveLike: store,
    }, moduleValue);
  return new moduleValue.exports();
}
test('controller fails closed before storage, rejects invalid writes and preserves ThinkJS success signal', async () => {
  let called = 0; const store = async () => { called++; return { count: 1, liked: true, users: [] }; };
  for (const user of [undefined, {}, { objectId: 1, type: 'banned' }, { type: 'administrator' }]) {
    await assert.rejects(controller(user, { path: '/posts/test', liked: true }, store).postAction(), e => e.status === 401);
  }
  const user = { objectId: 1, type: 'guest', auth_version: 0 };
  await assert.rejects(controller(user, { path: '/posts/test', liked: 'true' }, store).postAction(), e => e.status === 400);
  assert.equal(called, 0);
  const good = controller(user, { path: '/posts/test/', liked: true }, store);
  await assert.rejects(good.postAction(), e => e.message === 'PREVENT_NEXT_PROCESS' && e.data.liked);
  assert.equal(good.ctx.status, undefined); assert.equal(called, 1);
  await assert.rejects(controller(user, { path: '/posts/test', liked: true }, async () => { throw new Error('UNAUTHORIZED'); }).postAction(), e => e.status === 401);
  const broken = controller(user, { path: '/posts/test', liked: true }, async () => { throw new Error('PRIVATE_DATABASE_PASSWORD'); });
  assert.deepEqual(await broken.postAction(), { error: 'Content likes are temporarily unavailable.' });
  assert.equal(broken.ctx.status, 503);
});
