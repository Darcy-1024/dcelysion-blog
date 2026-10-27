'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, mkdtempSync, existsSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

const script = join(__dirname, 'patch-waline-admin.py');
const fixture = process.env.WALINE_ADMIN_FIXTURE && resolve(process.env.WALINE_ADMIN_FIXTURE);
const python = process.env.PYTHON || 'python';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const anchor = '} catch {\n\t\t\ts(e("email or password error"));';

test('isolated patch changes only the login catch and preserves language fallback', () => {
  const original = Buffer.from(`before login\n${anchor}\n after login`);
  const dir = mkdtempSync(join(tmpdir(), 'waline-admin-patch-'));
  try {
    const output = join(dir, 'admin.js');
    const input = join(dir, 'fixture.js');
    writeFileSync(input, original);
    const code = `import importlib.util, hashlib\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('patch',${JSON.stringify(script)})\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nsource=Path(${JSON.stringify(input)}).read_bytes()\nm.EXPECTED_SHA256=hashlib.sha256(source).hexdigest()\nPath(${JSON.stringify(output)}).write_bytes(m.patch_bytes(source))\n`;
    const result = spawnSync(python, ['-B', '-c', code], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const source = original.toString('utf8');
    const patched = readFileSync(output, 'utf8');
    const [before, after] = source.split(anchor);
    assert.ok(before && after);
    assert.ok(patched.startsWith(before));
    assert.ok(patched.endsWith(after));
    const replacement = patched.slice(before.length, patched.length - after.length);
    assert.ok(replacement.startsWith('} catch {\n\t\t\ts(e("login flow incomplete", '));
    assert.equal(patched.replace(replacement, anchor), source);
    const call = replacement.slice('} catch {\n\t\t\t'.length);
    for (const [lang, expected] of [
      ['zh-CN', '登录流程未完成，请刷新登录页后重试。'],
      ['zh-cn', '登录流程未完成，请刷新登录页后重试。'],
      ['zh-TW', '登入流程未完成，請重新整理登入頁後重試。'],
      ['en-US', 'Login did not complete. Refresh the login page and try again.'],
      ['fr', 'Login did not complete. Refresh the login page and try again.'],
    ]) {
      let message;
      runInNewContext(call, { ui: { language: lang }, e: (key, options) => options.defaultValue, s: value => { message = value; } });
      assert.equal(message, expected);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verified official fixture changes only the exact target', { skip: !fixture || !existsSync(fixture) ? 'set WALINE_ADMIN_FIXTURE to the official 0.34.2 admin.js' : false }, () => {
  const original = readFileSync(fixture);
  assert.equal(sha(original), 'fb745bd9bd983a6170877861f701752304b1534b835fe72b9db12c36999c627f');
  const dir = mkdtempSync(join(tmpdir(), 'waline-admin-official-'));
  try {
    const output = join(dir, 'admin.js');
    const result = spawnSync(python, [script, fixture, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const source = original.toString('utf8'), patched = readFileSync(output, 'utf8');
    const [before, after] = source.split(anchor);
    assert.ok(before && after);
    assert.ok(patched.startsWith(before));
    assert.ok(patched.endsWith(after));
    const replacement = patched.slice(before.length, patched.length - after.length);
    assert.ok(replacement.startsWith('} catch {\n\t\t\ts(e("login flow incomplete", '));
    assert.equal(patched.replace(replacement, anchor), source);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('wrong input hash fails closed without touching the output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'waline-admin-reject-'));
  try {
    const input = join(dir, 'bad.js'), output = join(dir, 'admin.js');
    writeFileSync(input, anchor);
    let result = spawnSync(python, [script, input, output], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SHA-256 mismatch/);
    assert.equal(existsSync(output), false);
    writeFileSync(output, 'previous asset');
    result = spawnSync(python, [script, input, output], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(readFileSync(output, 'utf8'), 'previous asset');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('zero or duplicate anchors fail closed after hash verification', () => {
  // Override the trusted hash only in this isolated module import to exercise
  // the independent anchor guard; the production CLI has no hash override.
  const code = `import importlib.util, hashlib\nspec=importlib.util.spec_from_file_location('patch',${JSON.stringify(script)})\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nfor source in (b'no anchor', m.ANCHOR + m.ANCHOR):\n m.EXPECTED_SHA256=hashlib.sha256(source).hexdigest()\n try:\n  m.patch_bytes(source)\n except ValueError as error:\n  assert 'exactly one' in str(error)\n else:\n  raise AssertionError('ambiguous source accepted')\n`;
  const result = spawnSync(python, ['-B', '-c', code], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
