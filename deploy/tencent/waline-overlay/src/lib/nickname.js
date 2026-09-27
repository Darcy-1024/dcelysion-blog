function isValidNickname(nickname) {
  return typeof nickname === 'string' && nickname.length >= 2 && nickname === nickname.trim();
}

async function isNicknameTaken(model, nickname, currentId) {
  const matches = await model.select({ display_name: nickname });
  return matches.some((user) => String(user.objectId) !== String(currentId));
}

function isNicknameUniqueViolation(error) {
  for (let current = error; current; current = current.cause || current.originalError) {
    if (current.code === '23505' && current.constraint === 'wl_users_display_name_unique') {
      return true;
    }
  }
  return false;
}

module.exports = { isValidNickname, isNicknameTaken, isNicknameUniqueViolation };
