'use strict';
const Base = require('./base.js');
module.exports = class extends Base {
  async __before() {
    // Avatar bytes are public, like existing avatar URLs. No account fields are exposed.
    if (this.ctx.method === 'GET') return;
    return super.__before();
  }
  getAction() {
    if (!/^[a-f0-9]{64}$/.test(this.get('id') || '')) return this.ctx.throw(404);
  }
  postAction() {
    const user = this.ctx.state.userInfo;
    if (!user?.objectId || !['guest', 'administrator'].includes(user.type)) return this.ctx.throw(401);
  }
  putAction() { return this.ctx.throw(405); }
  deleteAction() { return this.ctx.throw(405); }
};
