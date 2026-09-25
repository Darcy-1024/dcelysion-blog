'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
process.env.NODE_PATH = path.join(__dirname, 'node_modules');
require('node:module').Module._initPaths();
const jwt = require('jsonwebtoken');
const nunjucks = require('nunjucks');
const session = require('../waline-overlay/src/lib/session-token.js');
const chinese = require('../waline-overlay/src/locales/zh-CN.json');

test('new session JWT has explicit purpose/version; legacy is accepted only at version zero', () => {
  const key = 'test-key';
  const signed = session.sign({ objectId: 7, auth_version: 2 }, key);
  assert.deepEqual(session.verify(signed, key), { userId: '7', version: 2, legacy: false });
  const legacy = jwt.sign('7', key);
  assert.deepEqual(session.verify(legacy, key), { userId: '7', version: 0, legacy: true });
  assert.equal(session.verify(jwt.sign({ sub: '7', purpose: 'reset', version: 2 }, key), key), null);
});

test('all fixed-version mail templates render Simplified Chinese while preserving user content', () => {
  const url = 'https://comments.example.com/verification?token=1234';
  const register = nunjucks.renderString(chinese['Please click <a href="{{url}}">{{url}}<a/> to confirm registration, the link is valid for 1 hour. If you are not registering, please ignore this email.'], { url });
  assert.match(register, /确认注册/u);
  assert.match(register, /1 个小时/u);
  assert.match(register, /1234/u);
  const rawComment = 'My original English text 😊';
  const vars = { site: { name: 'DcElysion', url: 'https://blog.example.com', postUrl: 'https://blog.example.com/post#1' },
    self: { nick: '访客', comment: rawComment }, parent: { nick: '作者', comment: '原评论' } };
  for (const key of ['MAIL_SUBJECT', 'MAIL_TEMPLATE', 'MAIL_SUBJECT_ADMIN', 'MAIL_TEMPLATE_ADMIN']) {
    const rendered = nunjucks.renderString(chinese[key], vars);
    assert.doesNotMatch(rendered, /內容|Reply|Comment/u);
    if (key.includes('TEMPLATE') && key.endsWith('ADMIN')) assert.match(rendered, /My original English text 😊/u);
    if (key === 'MAIL_TEMPLATE') assert.match(rendered, /原评论/u);
  }
});
