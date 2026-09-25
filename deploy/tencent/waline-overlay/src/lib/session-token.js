const jwt = require('jsonwebtoken');

function sign(user, key) {
  return jwt.sign(
    { sub: String(user.objectId), purpose: 'session', version: Number(user.auth_version) || 0 },
    key,
  );
}

function verify(token, key) {
  const value = jwt.verify(token, key);
  if (typeof value === 'string' && /^\d+$/u.test(value)) {
    return { userId: value, version: 0, legacy: true };
  }
  if (
    !value ||
    typeof value !== 'object' ||
    value.purpose !== 'session' ||
    typeof value.sub !== 'string' ||
    !/^\d+$/u.test(value.sub) ||
    !Number.isSafeInteger(value.version) ||
    value.version < 0
  ) {
    return null;
  }
  return { userId: value.sub, version: value.version, legacy: false };
}

module.exports = { sign, verify };
