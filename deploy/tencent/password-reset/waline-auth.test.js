'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
process.env.NODE_PATH = path.join(__dirname, 'node_modules');
require('node:module').Module._initPaths();
const jwt = require('jsonwebtoken');
const session = require('../waline-overlay/src/lib/session-token.js');

const key = 'test-secret';
let currentUser;
global.think = {
  Logic: class {
    constructor(ctx) { this.ctx = ctx; }
    getModel() { return { async select() { return currentUser ? [{ ...currentUser }] : []; } }; }
    get() { return {}; }
    config() { return {}; }
  },
  config(name) { return name === 'jwtKey' ? key : {}; },
  isEmpty(value) { return value == null || (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0); },
  isString(value) { return typeof value === 'string'; },
  isNumber(value) { return typeof value === 'number'; },
  isArray: Array.isArray,
  isFunction(value) { return typeof value === 'function'; },
};
const BaseLogic = require('../waline-overlay/src/logic/base.js');

async function authenticated(token, version) {
  currentUser = { objectId: 7, id: 7, email: 'test@example.com', type: 'guest', avatar: 'avatar', auth_version: version };
  const ctx = { req: { headers: { authorization: `Bearer ${token}` } }, state: { oauthServices: [] }, path: '/api/user' };
  const logic = new BaseLogic(ctx);
  logic.referrerCheck = () => true;
  await logic.__before();
  return ctx.state.userInfo;
}

test('every Waline logic path rejects stale session and reset-purpose bearer', async () => {
  const old = jwt.sign('7', key);
  const versionOne = session.sign({ objectId: 7, auth_version: 1 }, key);
  const resetPurpose = jwt.sign({ sub: '7', purpose: 'reset', version: 1 }, key);
  assert.equal((await authenticated(old, 0)).objectId, 7);
  assert.deepEqual(await authenticated(old, 1), {});
  assert.equal((await authenticated(versionOne, 1)).objectId, 7);
  assert.deepEqual(await authenticated(versionOne, 2), {});
  assert.deepEqual(await authenticated(resetPurpose, 1), {});
});
