const BaseRest = require('./rest.js');
const { read } = require('../lib/management-read.js');
module.exports = class extends BaseRest {
  async getAction() {
    // Keep the boundary here even if a deployment omits the matching logic file.
    const user = this.ctx.state.userInfo;
    if (!user?.objectId) return this.ctx.throw(401);
    if (user.type !== 'administrator') return this.ctx.throw(403);
    return this.success(await read(name => this.getModel(name), this.get(), user => think.service('avatar').stringify(user)));
  }
};
