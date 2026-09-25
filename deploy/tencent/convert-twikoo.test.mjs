import assert from 'node:assert/strict';
import test from 'node:test';
import { convert } from './convert-twikoo.mjs';

const stamp = Date.UTC(2024, 0, 1, 12, 0, 0);
const comment = (id, overrides = {}) => ({
  _id: id, uid: 'old-user', nick: "O'Brien", mail: 'a@example.test', mailMd5: 'hash',
  link: '', ua: 'test', ip: '127.0.0.1', master: false, url: '/a/', href: 'https://example.test/a/',
  comment: '<p>Backslash \\ and quote \'</p>', pid: null, rid: null,
  isSpam: false, created: stamp, updated: stamp, ...overrides,
});
const counter = (id, overrides = {}) => ({
  _id: id, url: '/a/', title: 'Title', time: 42, created: stamp, updated: stamp, ...overrides,
});

test('maps stable IDs, replies, statuses, counts and escapes SQL literals', () => {
  const { sql, manifest } = convert([
    comment('root'),
    comment('child', { pid: 'root', rid: 'root', isSpam: true }),
    comment('grandchild', { pid: 'child', rid: 'root' }),
  ], [counter('counter')]);
  assert.match(sql, /SET LOCAL standard_conforming_strings = on/);
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM wl_comment\) OR EXISTS \(SELECT 1 FROM wl_counter\)/);
  assert.match(sql, /<p>Backslash \\ and quote ''<\/p>/);
  assert.match(sql, /\(2, NULL, .*?, 1, 1, 'spam'/);
  assert.match(sql, /\(3, NULL, .*?, 2, 1, 'approved'/);
  assert.match(sql, /SELECT setval\('wl_comment_seq', 3, true\)/);
  assert.match(sql, /SELECT setval\('wl_counter_seq', 1, true\)/);
  assert.equal(manifest.replyCount, 2);
  assert.equal(manifest.spamCount, 1);
  assert.doesNotMatch(JSON.stringify(manifest), /O'Brien|example\.test|127\.0\.0\.1/);
});

test('rejects missing, duplicate and inconsistent reply IDs', () => {
  assert.throws(() => convert([comment('a'), comment('a')], [counter('c')]), /comment\[1\]._id: duplicate/);
  assert.throws(() => convert([comment('a', { pid: 'missing', rid: 'missing' })], [counter('c')]), /comment\[0\].pid: orphan parent/);
  assert.throws(() => convert([comment('a'), comment('b', { pid: 'a' })], [counter('c')]), /comment\[1\].pid\/rid/);
  assert.throws(() => convert([comment('a'), comment('b', { pid: 'a', rid: 'a' }), comment('c', { pid: 'a', rid: 'b' })], [counter('c')]), /comment\[2\].rid: root references a reply/);
  assert.throws(() => convert([comment('a')], [counter('c'), counter('c')]), /counter\[1\]._id: duplicate/);
});

test('explicit root policy preserves orphan body while recording lost relationship', () => {
  const { sql, manifest } = convert([comment('orphan', { pid: 'missing', rid: 'missing' })], [counter('c')], { orphanPolicy: 'root' });
  assert.match(sql, /\(1, NULL, '<p>Backslash/);
  assert.match(sql, /'O''Brien', NULL, NULL, 'approved'/);
  assert.equal(manifest.orphanPromotedCount, 1);
  assert.equal(manifest.replyCount, 0);
});

test('rejects data that PostgreSQL would truncate or corrupt', () => {
  assert.throws(() => convert([comment('a', { nick: 'x'.repeat(256) })], [counter('c')]), /comment\[0\].nick: exceeds varchar\(255\)/);
  assert.throws(() => convert([comment('a', { comment: 'x\0y' })], [counter('c')]), /comment\[0\].comment: NUL/);
  assert.throws(() => convert([comment('a', { created: Number.MAX_SAFE_INTEGER })], [counter('c')]), /comment\[0\].created: invalid date/);
  assert.throws(() => convert([comment('a', { isSpam: 'false' })], [counter('c')]), /comment\[0\].isSpam: expected boolean/);
  assert.throws(() => convert([comment('a')], [counter('c', { time: 2_147_483_648 })]), /counter\[0\].time: expected nonnegative int32/);
  assert.throws(() => convert([comment('a')], [counter('c', { url: 'x'.repeat(256) })]), /counter\[0\].url: exceeds varchar\(255\)/);
});

test('CLI publishes a complete package once and refuses to reuse its directory', async () => {
  const { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const temporary = mkdtempSync(join(tmpdir(), 'twikoo-package-'));
  const cli = resolve('deploy/tencent/convert-twikoo.mjs');
  const verify = resolve('deploy/tencent/check-migration-package.py');
  const output = join(temporary, 'package');
  const source = (folder, body) => {
    mkdirSync(folder);
    const commentPath = join(folder, 'comments.json');
    const counterPath = join(folder, 'counters.json');
    writeFileSync(commentPath, JSON.stringify([comment('root', { comment: body })]));
    writeFileSync(counterPath, JSON.stringify([counter('counter')]));
    return [commentPath, counterPath];
  };
  const run = (inputs, target = output) => spawnSync(process.execPath, [cli, ...inputs, target], { encoding: 'utf8' });
  const check = () => spawnSync(process.platform === 'win32' ? 'py' : 'python3', [...(process.platform === 'win32' ? ['-3'] : []), verify, output], { encoding: 'utf8' });
  try {
    const first = source(join(temporary, 'first'), 'SYNTHETIC_OLD');
    assert.equal(run(first).status, 0);
    assert.equal(check().status, 0);
    const names = ['twikoo-comment.json', 'twikoo-counter.json', 'migration.sql', 'manifest.json'];
    const before = names.map((name) => readFileSync(join(output, name)));
    const second = source(join(temporary, 'second'), 'SYNTHETIC_NEW');
    assert.notEqual(run(second).status, 0);
    names.forEach((name, index) => assert.deepEqual(readFileSync(join(output, name)), before[index]));
    assert.match(readFileSync(join(output, 'migration.sql'), 'utf8'), /SYNTHETIC_OLD/);
    assert.doesNotMatch(readFileSync(join(output, 'migration.sql'), 'utf8'), /SYNTHETIC_NEW/);
    for (const name of ['twikoo-comment.json', 'migration.sql']) {
      const file = join(output, name);
      const original = readFileSync(file);
      writeFileSync(file, Buffer.concat([original, Buffer.from('changed')]));
      assert.notEqual(check().status, 0);
      writeFileSync(file, original);
    }
    assert.equal(check().status, 0);
    const invalid = source(join(temporary, 'invalid'), 'invalid');
    writeFileSync(invalid[0], JSON.stringify([comment('root', { isSpam: 'false' })]));
    const missing = join(temporary, 'invalid-output');
    assert.notEqual(run(invalid, missing).status, 0);
    assert.equal(existsSync(missing), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});