'use strict';

const PAGE_SIZE = 20;
function normalizePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') ||
    /[?#\\\s\u0000-\u001f\u007f]/u.test(value) || value.length > 1024) throw new Error('INVALID_PATH');
  let path;
  try {
    // Decode/re-encode once so Chinese and percent-encoded paths share one key.
    path = new URL(value.replace(/\/{2,}/gu, '/'), 'https://content.invalid').pathname
      .split('/').map(segment => {
        const decoded = decodeURIComponent(segment);
        if (/[/?#\\\u0000-\u001f\u007f]/u.test(decoded)) throw new Error('INVALID_PATH');
        return encodeURIComponent(decoded);
      }).join('/');
  } catch { throw new Error('INVALID_PATH'); }
  path = path.replace(/\/+$/u, '') || '/';
  if (path.length > 1024) throw new Error('INVALID_PATH');
  return path;
}
function normalizeOffset(value) {
  if (value === undefined || value === '') return 0;
  if (!/^(0|[1-9][0-9]{0,6})$/u.test(String(value))) throw new Error('INVALID_OFFSET');
  return Number(value);
}
async function readLikes(db, path, userId = null, offset = 0) {
  // One SQL snapshot keeps count, own state and page in agreement under concurrent writes.
  // Project only fields intended for public display; never fetch email, IP or credentials.
  const result = await db.query(`WITH visible AS (
    SELECT l.user_id,l.created_at,COALESCE(u.display_name,'') AS nick,COALESCE(u.avatar,'') AS avatar
    FROM dc_content_likes l JOIN wl_users u ON u.id=l.user_id
    WHERE l.path=$1 AND u.type IN ('guest','administrator')
  ), page AS (
    SELECT * FROM visible ORDER BY created_at DESC,user_id DESC LIMIT 21 OFFSET $3
  ) SELECT (SELECT count(*)::int FROM visible) AS count,
    EXISTS(SELECT 1 FROM visible WHERE user_id=$2) AS liked,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',user_id,'nick',nick,'avatar',avatar)
      ORDER BY created_at DESC,user_id DESC) FROM page),'[]'::jsonb) AS users`,
  [path, userId, offset]);
  const row = result.rows[0];
  const hasMore = row.users.length > PAGE_SIZE;
  return { count: row.count, liked: row.liked, users: row.users.slice(0, PAGE_SIZE),
    hasMore, nextOffset: hasMore ? offset + PAGE_SIZE : null };
}
async function saveLike(db, user, path, liked) {
  if (!user?.objectId || !['guest', 'administrator'].includes(user.type) ||
    !Number.isInteger(Number(user.auth_version))) throw new Error('UNAUTHORIZED');
  if (typeof liked !== 'boolean') throw new Error('INVALID_LIKED');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Serialize against account bans, password/version changes and same-account writes.
    const authorized = await client.query(`SELECT id FROM wl_users WHERE id=$1 AND auth_version=$2
      AND type IN ('guest','administrator') FOR UPDATE`, [user.objectId, user.auth_version]);
    if (!authorized.rows.length) throw new Error('UNAUTHORIZED');
    if (liked) await client.query(`INSERT INTO dc_content_likes(path,user_id) VALUES($1,$2)
      ON CONFLICT(path,user_id) DO NOTHING`, [path, user.objectId]);
    else await client.query('DELETE FROM dc_content_likes WHERE path=$1 AND user_id=$2', [path, user.objectId]);
    const data = await readLikes(client, path, user.objectId);
    await client.query('COMMIT');
    return data;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
module.exports = { normalizePath, normalizeOffset, readLikes, saveLike };
