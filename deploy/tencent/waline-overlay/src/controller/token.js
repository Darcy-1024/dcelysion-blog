const sessionToken = require('../lib/session-token.js');
const findLoginUser = require('../lib/login-identity.js');
const speakeasy = require('speakeasy');

const BaseRest = require('./rest.js');

module.exports = class extends BaseRest {
  constructor(...args) {
    super(...args);
    this.modelInstance = this.getModel('Users');
  }

  getAction() {
    return this.success(this.ctx.state.userInfo);
  }

  async postAction() {
    const { email, password, code } = this.post();
    const loginUser = await findLoginUser(this.modelInstance, email);

    const isVerifyUser = /^verify:/iu.test(loginUser?.type);
    const isBannedUser = loginUser?.type === 'banned';
    if (!loginUser || isVerifyUser || isBannedUser) {
      return this.fail();
    }

    const checkPassword = this.checkPassword(password, loginUser.password);

    if (!checkPassword) {
      return this.fail();
    }

    const twoFactorAuthSecret = loginUser['2fa'];

    if (twoFactorAuthSecret) {
      const verified = speakeasy.totp.verify({
        secret: twoFactorAuthSecret,
        encoding: 'base32',
        token: code,
        window: 2,
      });

      if (!verified) {
        return this.fail();
      }
    }

    let avatarUrl =
      loginUser.avatar ||
      (await think.service('avatar').stringify({
        mail: loginUser.email,
        nick: loginUser.display_name,
        link: loginUser.url,
      }));
    const { avatarProxy } = think.config();

    if (avatarProxy) {
      avatarUrl = `${avatarProxy}?url=${encodeURIComponent(avatarUrl)}`;
    }

    loginUser.avatar = avatarUrl;

    return this.success({
      ...loginUser,
      password: null,
      token: sessionToken.sign(loginUser, this.config('jwtKey')),
    });
  }

  deleteAction() {}
};
