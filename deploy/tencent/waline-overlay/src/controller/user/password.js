const BaseRest = require('../rest.js');

module.exports = class extends BaseRest {
  putAction() {
    this.ctx.status = 410;
    this.ctx.body = { errno: 410, errmsg: '请使用新的“忘记密码”页面申请重置链接。' };
    return think.prevent();
  }
};
