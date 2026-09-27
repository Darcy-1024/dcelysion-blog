const Base = require('./base.js');

module.exports = class TokenLogic extends Base {
  getAction() {}

  async postAction() {
    this.rules = {
      email: {
        required: true,
        string: true,
      },
      password: {
        required: true,
        string: true,
      },
    };

    await this.useCaptchaCheck();
  }

  deleteAction() {}
};
