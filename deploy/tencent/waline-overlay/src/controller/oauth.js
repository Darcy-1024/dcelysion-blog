const sessionToken = require('../lib/session-token.js');
const { isValidNickname, isNicknameTaken, isNicknameUniqueViolation } = require('../lib/nickname.js');

module.exports = class OAuthController extends think.Controller {
  constructor(ctx) {
    super(ctx);
    this.modelInstance = this.getModel('Users');
  }

  async indexAction() {
    const { code, state, type, redirect } = this.get();
    const { oauthUrl } = this.config();

    if (!code) {
      const { serverURL } = this.ctx;
      const redirectUrl = think.buildUrl(`${serverURL}/api/oauth`, {
        redirect,
        type,
      });

      this.redirect(
        think.buildUrl(`${oauthUrl}/${type}`, {
          redirect: redirectUrl,
          state: this.ctx.state.token || '',
        }),
      );
      return;
    }

    /** User = { id, name, email, avatar,url }; */
    const params = { code, state };

    if (type === 'facebook') {
      const { serverURL } = this.ctx;
      const redirectUrl = think.buildUrl(`${serverURL}/api/oauth`, {
        redirect,
        type,
      });

      params.state = think.buildUrl(undefined, {
        redirect: redirectUrl,
        state: this.ctx.state.token || '',
      });
    }

    const user = await fetch(think.buildUrl(`${oauthUrl}/${type}`, params), {
      method: 'GET',
      headers: {
        'user-agent': '@waline',
      },
    }).then((resp) => resp.json());

    if (!user?.id) {
      return this.fail(user);
    }

    const userBySocial = await this.modelInstance.select({ [type]: user.id });

    // when the social account has been linked, then redirect to this linked account profile page. It may be current account or another.
    // If it's another account, user should unlink the social type in that account and then link it.
    if (!think.isEmpty(userBySocial)) {
      const token = sessionToken.sign(userBySocial[0], this.config('jwtKey'));

      if (redirect) {
        this.redirect(think.buildUrl(redirect, { token }));
        return;
      }

      return this.success();
    }

    const current = this.ctx.state.userInfo;

    // when login user link social type, then update data
    if (!think.isEmpty(current)) {
      const updateData = { [type]: user.id };

      if (!current.avatar && user.avatar) {
        updateData.avatar = user.avatar;
      }

      await this.modelInstance.update(updateData, {
        objectId: current.objectId,
      });

      this.redirect('/ui/profile');
      return;
    }

    // when user has not login, then we create account by the social type!
    const count = await this.modelInstance.count();
    const data = {
      display_name: user.name,
      email: user.email,
      url: user.url,
      avatar: user.avatar,
      [type]: user.id,
      password: this.hashPassword(Math.random()),
      type: think.isEmpty(count) ? 'administrator' : 'guest',
    };

    if (!isValidNickname(data.display_name)) {
      return this.fail(this.locale('Nickname must be at least 2 characters and have no leading or trailing spaces.'));
    }
    if (await isNicknameTaken(this.modelInstance, data.display_name)) {
      return this.fail(this.locale('Nickname is already in use. Choose another nickname.'));
    }

    let cmtUser;
    try {
      cmtUser = await this.modelInstance.add(data);
    } catch (error) {
      if (isNicknameUniqueViolation(error)) {
        return this.fail(this.locale('Nickname is already in use. Choose another nickname.'));
      }
      throw error;
    }

    if (!redirect) {
      return this.success();
    }

    // and then generate token!
    const token = sessionToken.sign({ ...cmtUser, auth_version: 0 }, this.config('jwtKey'));

    this.redirect(`${redirect}${redirect.includes('?') ? '&' : '?'}token=${token}`);
  }
};
