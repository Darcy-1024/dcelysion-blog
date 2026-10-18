'use strict';
const Base = require('./base.js');
const { normalizePath, normalizeOffset } = require('../lib/content-like-store.js');
module.exports = class extends Base {
  // Inherit current Waline JWT verification, auth_version checks and origin policy.
  getAction() {
    try { normalizePath(this.get('path')); normalizeOffset(this.get('offset')); }
    catch { return this.ctx.throw(400); }
  }
  postAction() {
    const user = this.ctx.state.userInfo;
    if (!user?.objectId || !['guest', 'administrator'].includes(user.type)) return this.ctx.throw(401);
    try { normalizePath(this.post('path')); }
    catch { return this.ctx.throw(400); }
    if (typeof this.post('liked') !== 'boolean') return this.ctx.throw(400);
  }
  putAction() { return this.ctx.throw(405); }
  deleteAction() { return this.ctx.throw(405); }
};
