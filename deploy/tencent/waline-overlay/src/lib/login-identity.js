module.exports = async function findLoginUser(model, identity) {
  if (typeof identity !== 'string' || !identity.trim()) return null;

  const emailMatches = await model.select({ email: identity });
  if (emailMatches.length === 1) return emailMatches[0];
  if (emailMatches.length > 1) return null;

  const nicknameMatches = await model.select({ display_name: identity });
  return nicknameMatches.length === 1 ? nicknameMatches[0] : null;
};
