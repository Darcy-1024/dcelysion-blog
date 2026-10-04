const Base = require('./base.js');
module.exports = class extends Base {
  getAction() {
    const user = this.ctx.state.userInfo;
    if (!user?.objectId) return this.ctx.throw(401);
    if (user.type !== 'administrator') return this.ctx.throw(403);
    this.rules = {
      resource: { in: ['comment', 'user'], required: true },
      id: { int: { min: 1 } },
      userId: { int: { min: 1 } },
      page: { int: { min: 1, max: 100000 }, default: 1 },
      pageSize: { int: { min: 1, max: 50 }, default: 15 },
      search: { string: true, length: { max: 150 } },
      path: { string: true, length: { max: 500 } },
      status: { in: ['approved', 'waiting', 'spam'] },
    };
  }
  postAction() { return this.ctx.throw(405); }
  putAction() { return this.ctx.throw(405); }
  deleteAction() { return this.ctx.throw(405); }
};
