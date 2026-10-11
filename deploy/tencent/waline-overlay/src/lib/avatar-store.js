'use strict';
const { createHash } = require('node:crypto');
let pool;
function getPool() {
  if (!pool) {
    let Pool;
    try { ({ Pool } = require('pg')); }
    catch { ({ Pool } = require('/app/password-reset/node_modules/pg')); }
    pool = new Pool({ host: process.env.PG_HOST, port: Number(process.env.PG_PORT || 5432),
      database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
      ssl: process.env.PG_SSL === 'true', max: 2 });
  }
  return pool;
}
async function saveAvatar(db, user, image, origin) {
  const digest = createHash('sha256').update(image).digest('hex');
  const avatar = new URL(`/api/avatar?id=${digest}`, origin).href;
  if (avatar.length > 255) throw new Error('INVALID_ORIGIN');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Recheck session version/role while locking the same user row as bans/password changes.
    const changed = await client.query(`UPDATE wl_users SET avatar=$1 WHERE id=$2
      AND auth_version=$3 AND type IN ('guest','administrator') RETURNING id`,
    [avatar, user.objectId, user.auth_version]);
    if (!changed.rowCount) throw new Error('UNAUTHORIZED');
    const stored = await client.query(`INSERT INTO dc_user_avatars(user_id,digest,image) VALUES($1,$2,$3)
      ON CONFLICT(user_id) DO UPDATE SET digest=excluded.digest,image=excluded.image,updated_at=now()
      WHERE dc_user_avatars.updated_at < now() - interval '5 seconds' RETURNING user_id`,
    [user.objectId, digest, image]);
    if (!stored.rowCount) throw new Error('RATE_LIMIT');
    await client.query('COMMIT');
    return avatar;
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}
module.exports = { getPool, saveAvatar };
