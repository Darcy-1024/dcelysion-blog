/**
 * Offline Twikoo JSON -> Waline 1.41.6 PostgreSQL migration.
 *
 * Usage: node deploy/tencent/convert-twikoo.mjs <comments.json> <counters.json> <output-directory>
 * Keep the output directory private: migration.sql and the source backups contain PII.
 */
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const INT_MAX = 2_147_483_647;
const COMMENT_FIELDS = ['_id', 'uid', 'nick', 'mail', 'mailMd5', 'link', 'ua', 'ip', 'master', 'url', 'href', 'comment', 'pid', 'rid', 'isSpam', 'created', 'updated'];
const COUNTER_FIELDS = ['_id', 'url', 'title', 'time', 'created', 'updated'];
const COMMENT_FILE = 'twikoo-comment.json';
const COUNTER_FILE = 'twikoo-counter.json';

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function pathExists(path) {
  try { lstatSync(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function fail(kind, index, field, reason) {
  throw new Error(`${kind}[${index}].${field}: ${reason}`);
}

function stringField(row, kind, index, field, max = Infinity, nullable = false) {
  const value = row[field];
  if (nullable && value === null) return null;
  if (typeof value !== 'string') fail(kind, index, field, 'expected string');
  if (value.includes('\0')) fail(kind, index, field, 'NUL is unsupported by PostgreSQL');
  if ([...value].length > max) fail(kind, index, field, `exceeds varchar(${max})`);
  return value;
}

function dateField(row, kind, index, field) {
  const value = row[field];
  if (!Number.isSafeInteger(value)) fail(kind, index, field, 'expected safe integer milliseconds');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(kind, index, field, 'invalid date');
  const iso = date.toISOString();
  if (!/^\d{4}-/.test(iso)) fail(kind, index, field, 'outside supported timestamp range');
  return value;
}

function sqlString(value) {
  return value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;
}

function sqlDate(ms) {
  // PostgreSQL's timestamp(0) necessarily loses subsecond precision.
  return `to_timestamp(${ms} / 1000.0)::timestamp(0)`;
}

function requiredShape(row, kind, index, fields) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail(kind, index, '*', 'expected object');
  for (const field of fields) if (!Object.hasOwn(row, field)) fail(kind, index, field, 'missing');
}

function positiveId(row, kind, index) {
  const id = stringField(row, kind, index, '_id');
  if (!id) fail(kind, index, '_id', 'empty');
  return id;
}

export function convert(comments, counters, { orphanPolicy = 'error' } = {}) {
  if (!['error', 'root'].includes(orphanPolicy)) throw new Error('Unsupported orphan policy');
  if (!Array.isArray(comments) || !Array.isArray(counters)) throw new Error('Both inputs must be JSON arrays');
  if (!comments.length || !counters.length) throw new Error('Inputs must not be empty');
  if (comments.length > INT_MAX || counters.length > INT_MAX) throw new Error('Too many rows for integer IDs');

  const commentIds = new Map();
  const counterIds = new Set();
  comments.forEach((row, i) => {
    requiredShape(row, 'comment', i, COMMENT_FIELDS);
    const id = positiveId(row, 'comment', i);
    if (commentIds.has(id)) fail('comment', i, '_id', 'duplicate');
    commentIds.set(id, i + 1);
  });
  counters.forEach((row, i) => {
    requiredShape(row, 'counter', i, COUNTER_FIELDS);
    const id = positiveId(row, 'counter', i);
    if (counterIds.has(id)) fail('counter', i, '_id', 'duplicate');
    counterIds.add(id);
  });

  let spamCount = 0;
  let masterCount = 0;
  let replyCount = 0;
  let orphanPromotedCount = 0;
  const commentValues = comments.map((row, i) => {
    const uid = stringField(row, 'comment', i, 'uid');
    const mailMd5 = stringField(row, 'comment', i, 'mailMd5');
    const href = stringField(row, 'comment', i, 'href');
    void uid; void mailMd5; void href; // validated, retained in private source backup only
    const nick = stringField(row, 'comment', i, 'nick', 255);
    const mail = stringField(row, 'comment', i, 'mail', 255);
    const link = stringField(row, 'comment', i, 'link', 255);
    const ua = stringField(row, 'comment', i, 'ua');
    const ip = stringField(row, 'comment', i, 'ip', 100);
    const url = stringField(row, 'comment', i, 'url', 255);
    const body = stringField(row, 'comment', i, 'comment');
    let pid = stringField(row, 'comment', i, 'pid', Infinity, true);
    let rid = stringField(row, 'comment', i, 'rid', Infinity, true);
    if (typeof row.master !== 'boolean') fail('comment', i, 'master', 'expected boolean');
    if (typeof row.isSpam !== 'boolean') fail('comment', i, 'isSpam', 'expected boolean');
    if (row.master) masterCount++;
    if (row.isSpam) spamCount++;
    const created = dateField(row, 'comment', i, 'created');
    const updated = dateField(row, 'comment', i, 'updated');
    if (updated < created) fail('comment', i, 'updated', 'before created');
    if ((pid === null) !== (rid === null)) fail('comment', i, 'pid/rid', 'both must be null or set');
    if (pid !== null && (!commentIds.has(pid) || !commentIds.has(rid))) {
      if (orphanPolicy !== 'root') fail('comment', i, !commentIds.has(pid) ? 'pid' : 'rid', 'orphan parent');
      pid = null;
      rid = null;
      orphanPromotedCount++;
    }
    if (pid !== null) {
      replyCount++;
      if (pid === row._id || rid === row._id) fail('comment', i, 'pid/rid', 'self reference');
      const root = comments[commentIds.get(rid) - 1];
      if (root.rid !== null || root.pid !== null) fail('comment', i, 'rid', 'root references a reply');
      if (pid !== rid) {
        const parent = comments[commentIds.get(pid) - 1];
        if (parent.rid !== rid) fail('comment', i, 'pid', 'parent belongs to another root');
      }
    }
    return `(${i + 1}, NULL, ${sqlString(body)}, ${sqlDate(created)}, ${sqlString(ip)}, ${sqlString(link)}, ${sqlString(mail)}, ${sqlString(nick)}, ${pid === null ? 'NULL' : commentIds.get(pid)}, ${rid === null ? 'NULL' : commentIds.get(rid)}, ${sqlString(row.isSpam ? 'spam' : 'approved')}, ${sqlString(ua)}, ${sqlString(url)}, ${sqlDate(created)}, ${sqlDate(updated)})`;
  });

  const counterUrls = new Set();
  const counterValues = counters.map((row, i) => {
    const url = stringField(row, 'counter', i, 'url', 255);
    stringField(row, 'counter', i, 'title');
    if (counterUrls.has(url)) fail('counter', i, 'url', 'duplicate page key');
    counterUrls.add(url);
    if (!Number.isInteger(row.time) || row.time < 0 || row.time > INT_MAX) fail('counter', i, 'time', 'expected nonnegative int32');
    const created = dateField(row, 'counter', i, 'created');
    const updated = dateField(row, 'counter', i, 'updated');
    if (updated < created) fail('counter', i, 'updated', 'before created');
    return `(${i + 1}, ${row.time}, ${sqlString(url)}, ${sqlDate(created)}, ${sqlDate(updated)})`;
  });

  const sql = [
    '-- Private: contains historical comments, email addresses, IP addresses and user agents.',
    '-- Generated for Waline 1.41.6 PostgreSQL schema; review before importing.',
    'BEGIN;',
    'SET LOCAL standard_conforming_strings = on;',
    "SET LOCAL TIME ZONE 'UTC';",
    'DO $migration_guard$ BEGIN',
    '  IF EXISTS (SELECT 1 FROM wl_comment) OR EXISTS (SELECT 1 FROM wl_counter) THEN',
    "    RAISE EXCEPTION 'Waline comment/counter tables must both be empty';",
    '  END IF;',
    'END $migration_guard$;',
    'INSERT INTO wl_comment (id, user_id, comment, insertedat, ip, link, mail, nick, pid, rid, status, ua, url, createdat, updatedat) VALUES',
    `${commentValues.join(',\n')};`,
    'INSERT INTO wl_counter (id, time, url, createdat, updatedat) VALUES',
    `${counterValues.join(',\n')};`,
    `SELECT setval('wl_comment_seq', ${comments.length}, true);`,
    `SELECT setval('wl_counter_seq', ${counters.length}, true);`,
    'COMMIT;',
    '',
  ].join('\n');
  const manifest = {
    source: 'Twikoo JSON export', target: 'Waline 1.41.6 PostgreSQL',
    commentCount: comments.length, counterCount: counters.length,
    replyCount, orphanPromotedCount, spamCount, approvedCount: comments.length - spamCount, masterCount,
    idMapping: 'Source array order -> 1-based integer IDs; pid/rid remapped through source _id.',
    mappings: {
      comment: '_id->id, comment->comment, created->insertedAt/createdAt, updated->updatedAt, ip/link/mail/nick/ua/url/pid/rid direct, isSpam->status, user_id=NULL',
      counter: '_id->id, time->time, url/created/updated direct',
    },
    backupOnlyFields: { comment: ['uid', 'mailMd5', 'href', 'master'], counter: ['title'] },
    limitations: [
      'Waline timestamp(0) rounds source millisecond timestamps to seconds.',
      'Twikoo master badge has no matching historical user row; preserved in backup only.',
      'Twikoo HTML is stored unchanged but Waline renders it through MarkdownIt and DOMPurify.',
      ...(orphanPromotedCount ? [`${orphanPromotedCount} orphan reply/replies promoted to root comments; original relationship remains in private source backup.`] : []),
    ],
  };
  return { sql, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (![5, 6].includes(process.argv.length)) throw new Error('Usage: convert-twikoo.mjs <comments.json> <counters.json> <output-directory> [--orphan-policy=root]');
    const orphanPolicy = process.argv[5] === '--orphan-policy=root' ? 'root' : 'error';
    if (process.argv.length === 6 && orphanPolicy === 'error') throw new Error('Unsupported orphan policy');
    const [commentPath, counterPath, outputPath] = process.argv.slice(2, 5).map((path) => resolve(path));
    if (commentPath === counterPath) throw new Error('Source files must be distinct');
    const output = resolve(outputPath);
    if (output === commentPath || output === counterPath) throw new Error('Output directory must differ from source files');
    if (basename(commentPath) === basename(counterPath)) throw new Error('Source basenames must be distinct');
    if (pathExists(output)) throw new Error('Output directory already exists; choose a new migration package directory.');
    const commentBytes = readFileSync(commentPath);
    const counterBytes = readFileSync(counterPath);
    const comments = JSON.parse(commentBytes.toString('utf8'));
    const counters = JSON.parse(counterBytes.toString('utf8'));
    const { sql, manifest } = convert(comments, counters, { orphanPolicy });
    const sqlBytes = Buffer.from(sql, 'utf8');
    manifest.packageVersion = 1;
    manifest.files = {
      [COMMENT_FILE]: sha256(commentBytes),
      [COUNTER_FILE]: sha256(counterBytes),
      'migration.sql': sha256(sqlBytes),
    };
    mkdirSync(dirname(output), { recursive: true });
    const temporary = mkdtempSync(join(dirname(output), `.${basename(output)}.tmp-`));
    try {
      writeFileSync(join(temporary, COMMENT_FILE), commentBytes, { mode: 0o600 });
      writeFileSync(join(temporary, COUNTER_FILE), counterBytes, { mode: 0o600 });
      writeFileSync(join(temporary, 'migration.sql'), sqlBytes, { mode: 0o600 });
      writeFileSync(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      if (pathExists(output)) throw new Error('Output directory appeared during conversion; refusing to replace it.');
      renameSync(temporary, output);
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
    console.log(`Converted ${manifest.commentCount} comments and ${manifest.counterCount} counters; ${manifest.replyCount} replies, ${manifest.orphanPromotedCount} orphan promoted, ${manifest.spamCount} spam.`);
  } catch (error) {
    // Validation errors deliberately contain only row indices and field names.
    console.error(error.message);
    process.exitCode = 1;
  }
}
