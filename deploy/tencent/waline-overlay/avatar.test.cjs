'use strict';
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { deflateSync } = require('node:zlib');
const test = require('node:test');
const { normalizeAvatar, signature, chunk } = require('./src/lib/avatar-image.js');
const { saveAvatar } = require('./src/lib/avatar-store.js');
const { pathToFileURL } = require('node:url');
function png(width = 1, height = 1, raw = Buffer.from([0, 255, 0, 0, 255]), extra = []) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([signature, chunk('IHDR', header), ...extra, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
test('avatar decoder accepts bounded PNG and strips metadata; rejects corrupt, oversized, animated or forged images', () => {
  const valid = png();
  assert.deepEqual(normalizeAvatar(valid.toString('base64')), valid);
  const metadata = png(1, 1, undefined, [chunk('tEXt', Buffer.from('private metadata'))]);
  assert.deepEqual(normalizeAvatar(metadata.toString('base64')), valid);
  const corrupt = Buffer.from(valid); corrupt[45] ^= 1;
  for (const input of [corrupt, png(257), png(1, 1, Buffer.alloc(100000)), png(1, 1, Buffer.from([5, 1, 1, 1, 1])),
    png(1, 1, undefined, [chunk('acTL', Buffer.alloc(8))]), Buffer.from('<svg onload="alert(1)"/>'), Buffer.concat([valid, Buffer.from('extra')])]) {
    assert.throws(() => normalizeAvatar(input.toString('base64')));
  }
  assert.throws(() => normalizeAvatar('a'.repeat(600000)));
  assert.throws(() => normalizeAvatar('not base64'));
});
test('upload persists only the authenticated user, rolls back rate limits and stale/banned sessions, and replaces old bytes', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const pool = { connect: async () => ({ query: async (sql, args) => {
    const result = await db.query(sql, args); return { ...result, rowCount: result.affectedRows };
  }, release() {} }) };
  try {
    await db.exec("CREATE TABLE wl_users(id integer primary key,avatar varchar(255),auth_version integer,type text); INSERT INTO wl_users VALUES(1,'old',0,'guest'),(2,'untouched',0,'administrator');");
    await db.exec(await readFile(new URL('./004_user_avatars.sql', pathToFileURL(__filename)), 'utf8'));
    const user = { objectId: 1, auth_version: 0 }; const image = png();
    const url = await saveAvatar(pool, user, image, 'https://comments.example.com');
    assert.match(url, /^https:\/\/comments\.example\.com\/api\/avatar\?id=[a-f0-9]{64}$/);
    assert.equal((await db.query('SELECT avatar FROM wl_users WHERE id=1')).rows[0].avatar, url);
    assert.equal((await db.query('SELECT avatar FROM wl_users WHERE id=2')).rows[0].avatar, 'untouched');
    const second = png(1, 1, Buffer.from([0, 0, 255, 0, 255]));
    await assert.rejects(saveAvatar(pool, user, second, 'https://comments.example.com'), /RATE_LIMIT/);
    assert.equal((await db.query('SELECT avatar FROM wl_users WHERE id=1')).rows[0].avatar, url);
    await db.exec("UPDATE dc_user_avatars SET updated_at=now()-interval '10 seconds'");
    const next = await saveAvatar(pool, user, second, 'https://comments.example.com');
    assert.notEqual(next, url);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM dc_user_avatars')).rows[0].count, 1);
    await db.exec('UPDATE wl_users SET auth_version=1 WHERE id=1');
    await assert.rejects(saveAvatar(pool, user, image, 'https://comments.example.com'), /UNAUTHORIZED/);
    await db.exec("UPDATE wl_users SET type='banned' WHERE id=1");
    await assert.rejects(saveAvatar(pool, { objectId: 1, auth_version: 1 }, image, 'https://comments.example.com'), /UNAUTHORIZED/);
    assert.equal((await db.query('SELECT avatar FROM wl_users WHERE id=1')).rows[0].avatar, next);
  } finally { await db.close(); }
});
