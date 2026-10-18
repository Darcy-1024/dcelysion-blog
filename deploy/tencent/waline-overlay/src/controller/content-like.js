'use strict';
const Base = require('./rest.js');
const { getPool } = require('../lib/avatar-store.js');
const { normalizePath, normalizeOffset, readLikes, saveLike } = require('../lib/content-like-store.js');

module.exports = class extends Base {
  async getAction() {
    this.ctx.set('Cache-Control', 'no-store');
    let path, offset;
    try { path = normalizePath(this.get('path')); offset = normalizeOffset(this.get('offset')); }
    catch { return this.ctx.throw(400); }
    const user = this.ctx.state.userInfo;
    const userId = user?.objectId && ['guest', 'administrator'].includes(user.type) ? user.objectId : null;
    let data;
    try { data = await readLikes(getPool(), path, userId, offset); }
    catch { this.ctx.status = 503; return this.fail('Content likes are temporarily unavailable.'); }
    return this.success(data);
  }
  async postAction() {
    this.ctx.set('Cache-Control', 'no-store');
    const user = this.ctx.state.userInfo;
    if (!user?.objectId || !['guest', 'administrator'].includes(user.type)) return this.ctx.throw(401);
    let path;
    try { path = normalizePath(this.post('path')); }
    catch { return this.ctx.throw(400); }
    const liked = this.post('liked');
    if (typeof liked !== 'boolean') return this.ctx.throw(400);
    let data;
    try { data = await saveLike(getPool(), user, path, liked); }
    catch (error) {
      if (error.message === 'UNAUTHORIZED') return this.ctx.throw(401);
      this.ctx.status = 503; return this.fail('Content likes are temporarily unavailable.');
    }
    // ThinkJS success() can throw PREVENT_NEXT_PROCESS; never catch it as a DB failure.
    return this.success(data);
  }
  putAction() { return this.ctx.throw(405); }
  deleteAction() { return this.ctx.throw(405); }
};
