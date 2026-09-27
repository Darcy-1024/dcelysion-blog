const assert = require('node:assert/strict');
const test = require('node:test');
const findLoginUser = require('./waline-overlay/src/lib/login-identity.js');
const { isValidNickname, isNicknameTaken, isNicknameUniqueViolation } = require('./waline-overlay/src/lib/nickname.js');

function model(users) {
  return { select: async (where) => users.filter((user) => Object.entries(where).every(([key, value]) => user[key] === value)) };
}

test('login accepts email or one exact nickname, with email taking priority', async () => {
  const users = [
    { objectId: 1, email: 'a@example.com', display_name: 'Alice' },
    { objectId: 2, email: 'b@example.com', display_name: 'a@example.com' },
  ];
  assert.equal((await findLoginUser(model(users), 'Alice')).objectId, 1);
  assert.equal((await findLoginUser(model(users), 'a@example.com')).objectId, 1);
  assert.equal(await findLoginUser(model(users), 'alice'), null);
  assert.equal(await findLoginUser(model(users), '  '), null);
  assert.equal(await findLoginUser(model(users), {}), null);
});

test('ambiguous nicknames fail closed', async () => {
  const users = [
    { objectId: 1, email: 'a@example.com', display_name: 'Same' },
    { objectId: 2, email: 'b@example.com', display_name: 'Same' },
  ];
  assert.equal(await findLoginUser(model(users), 'Same'), null);
  assert.equal((await findLoginUser(model(users), 'a@example.com')).objectId, 1);
});

test('registration and edits reject another account nickname', async () => {
  const users = [{ objectId: 3, display_name: 'Taken' }];
  assert.equal(await isNicknameTaken(model(users), 'Taken'), true);
  assert.equal(await isNicknameTaken(model(users), 'Taken', '3'), false);
  assert.equal(isValidNickname('Valid'), true);
  assert.equal(isValidNickname(' Valid'), false);
  assert.equal(isValidNickname(' '), false);
  assert.equal(isNicknameUniqueViolation({ code: '23505', constraint: 'wl_users_display_name_unique' }), true);
  assert.equal(isNicknameUniqueViolation({ code: '23505', constraint: 'different_index' }), false);
});
