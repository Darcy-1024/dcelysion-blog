'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const labelAnonymousComments = require('./waline-overlay/src/lib/anonymous-label.js');

const extensionPath = path.join(__dirname, 'waline-overlay/src/extend/controller.js');
const extensionSource = fs.readFileSync(extensionPath, 'utf8');
const extension = { exports: {} };
vm.runInNewContext(extensionSource, {
  module: extension,
  require(id) {
    if (id === '../lib/anonymous-label.js') return labelAnonymousComments;
    if (id === 'phpass') return { PasswordHash: class {} };
    if (id === 'nunjucks') return {};
    return {};
  },
  think: { prevent: () => undefined },
});

function render(pathname, data, deprecated = false) {
  let result;
  const controller = {
    ...extension.exports,
    ctx: {
      path: pathname,
      state: { deprecated },
      success: (value) => { result = value; },
    },
    json: (value) => { result = value; },
  };
  controller.jsonOrSuccess(data);
  return result;
}

test('page data and replies label only comments published without an account', () => {
  const response = {
    page: 2,
    totalPages: 3,
    data: [
      {
        objectId: 1,
        user_id: null,
        nick: '自填昵称',
        mail: 'registered@example.com',
        comment: '<p>Hello</p>',
        children: [
          { objectId: 2, user_id: null, nick: '匿名用户', comment: '<p>Reply</p>' },
          { objectId: 3, user_id: 7, type: 'guest', nick: '注册用户', label: '会员', comment: '<p>Reply</p>' },
        ],
      },
      { objectId: 4, user_id: 1, type: 'administrator', label: '站长', comment: '<p>Admin</p>' },
      { objectId: 5, user_id: 999, nick: '旧用户', comment: '<p>Orphan</p>' },
    ],
  };

  assert.equal(render('/api/comment', response), response);
  assert.equal(response.page, 2);
  assert.equal(response.data[0].nick, '自填昵称');
  assert.equal(response.data[0].label, '匿名');
  assert.equal(response.data[0].children[0].label, '匿名');
  assert.equal(response.data[0].children[1].label, '会员');
  assert.equal(response.data[1].label, '站长');
  assert.equal(response.data[2].label, undefined);
});

test('single creation result, recent list, and legacy JSON use the same label', () => {
  const created = { objectId: 6, user_id: undefined, nick: '匿名用户', comment: '<p>New</p>' };
  assert.equal(render('/api/comment', created).label, '匿名');
  const recent = [{ objectId: 7, user_id: null, comment: '<p>Recent</p>' }];
  assert.equal(render('/api/comment', recent)[0].label, '匿名');
  const legacy = { data: [{ objectId: 8, user_id: null, comment: '<p>Old API</p>' }] };
  assert.equal(render('/comment', legacy, true).data[0].label, '匿名');
});

test('non-comment API and count data are unchanged', () => {
  const userResponse = { data: [{ user_id: null, comment: 'profile text' }] };
  render('/api/user', userResponse);
  assert.equal(userResponse.data[0].label, undefined);

  const count = { page: 1, data: [{ objectId: 1, user_id: null, count: 3 }] };
  render('/api/comment', count);
  assert.equal(count.data[0].label, undefined);
});
