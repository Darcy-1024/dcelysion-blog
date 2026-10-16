'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { read } = require('./src/lib/management-read.js');

// Load the deployed controller without its logic layer: missing logic must fail closed.
const source = readFileSync(path.join(__dirname, 'src/controller/management.js'), 'utf8');

function controller(userInfo, events) {
  const ownerRow = {
    objectId: 7, display_name: 'Owner', email: 'owner@example.invalid',
    avatar: 'https://example.invalid/avatar.png', type: 'administrator',
    password: 'not-public', '2fa': 'not-public',
  };
  class BaseRest {
    constructor() {
      this.ctx = {
        state: { userInfo },
        throw(status) { events.push(`deny:${status}`); throw Object.assign(new Error('Denied'), { status }); },
      };
    }
    get() { events.push('query'); return { resource: 'user' }; }
    getModel(name) {
      events.push(`model:${name}`);
      return {
        async count() { events.push(`count:${name}`); return 1; },
        async select() { events.push(`select:${name}`); return [ownerRow]; },
      };
    }
    success(result) { events.push('success'); return result; }
  }
  const moduleValue = { exports: {} };
  new Function('require', 'module', 'think', source)(name => {
    if (name === './rest.js') return BaseRest;
    if (name === '../lib/management-read.js') return { read };
    throw new Error(`Unexpected module: ${name}`);
  }, moduleValue, {
    service() { events.push('avatar'); throw new Error('Uploaded avatar should not need the service'); },
  });
  return new moduleValue.exports();
}

for (const [name, user, status] of [
  ['missing session', undefined, 401],
  ['empty session', {}, 401],
  ['administrator role without identity', { type: 'administrator' }, 401],
  ['guest session', { objectId: 8, type: 'guest' }, 403],
]) {
  test(`controller rejects ${name} before query, database or avatar access`, async () => {
    const events = [];
    await assert.rejects(controller(user, events).getAction(), error => error.status === status);
    assert.deepEqual(events, [`deny:${status}`]);
  });
}

test('owner authorization precedes the real management read and preserves its safe DTO', async () => {
  const events = [];
  const owner = {
    get objectId() { events.push('identity'); return 7; },
    get type() { events.push('role'); return 'administrator'; },
  };
  const result = await controller(owner, events).getAction();
  assert.deepEqual(events, [
    'identity', 'role', 'query', 'model:Comment', 'model:Users', 'count:Users', 'select:Users', 'success',
  ]);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].email, 'owner@example.invalid');
  assert.equal('password' in result.items[0], false);
  assert.equal('2fa' in result.items[0], false);
});

test('anonymous and guest user lists project public commenter fields from sensitive rows', async () => {
  const userSource = readFileSync(path.join(__dirname, 'src/controller/user.js'), 'utf8');
  for (const userInfo of [{}, { objectId: 9, type: 'guest' }]) {
    const secretFields = { email: 'private@example.invalid', password: 'SECRET_PASSWORD', '2fa': 'SECRET_2FA', auth_version: 23, ip: 'SECRET_IP', ua: 'SECRET_UA' };
    const usersModel = { async select() { return [{ objectId: 8, type: 'guest', ...secretFields }]; } };
    const commentsModel = {
      async count() { return [{ user_id: 8, mail: secretFields.email, count: 3 }]; },
      async select() { return [{ nick: 'Public name', link: 'https://example.invalid', mail: secretFields.email, ...secretFields }]; },
    };
    class BaseRest {
      constructor() { this.ctx = { state: { userInfo } }; }
      getModel(name) { return name === 'Users' ? usersModel : commentsModel; }
      get() { return { page: 1, pageSize: 15 }; }
      config(name) { return name ? undefined : {}; }
      success(result) { return result; }
    }
    const moduleValue = { exports: {} };
    new Function('require', 'module', 'think', userSource)(name => {
      if (name === './rest.js') return BaseRest;
      if (name === '../lib/nickname.js') return {};
      throw new Error(`Unexpected module: ${name}`);
    }, moduleValue, {
      isEmpty: value => !value || Object.keys(value).length === 0,
      isArray: Array.isArray,
      service: () => ({ stringify: async () => 'https://example.invalid/public-avatar.png' }),
    });
    const result = await new moduleValue.exports().getAction();
    assert.deepEqual(result, [{ count: 3, nick: 'Public name', link: 'https://example.invalid', avatar: 'https://example.invalid/public-avatar.png' }]);
    for (const key of ['email', 'mail', 'password', '2fa', 'auth_version', 'ip', 'ua']) {
      assert.equal(key in result[0], false, `${key} must not be public`);
    }
  }
});
