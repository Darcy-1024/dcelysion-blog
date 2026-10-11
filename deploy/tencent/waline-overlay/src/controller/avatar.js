'use strict';
const Base = require('./rest.js');
const { normalizeAvatar } = require('../lib/avatar-image.js');
const { getPool, saveAvatar } = require('../lib/avatar-store.js');
module.exports = class extends Base {
  async getAction() {
    const digest = this.get('id');
    if (!/^[a-f0-9]{64}$/.test(digest || '')) return this.ctx.throw(404);
    const result = await getPool().query('SELECT image FROM dc_user_avatars WHERE digest=$1 LIMIT 1', [digest]);
    if (!result.rows.length) return this.ctx.throw(404);
    this.ctx.set('Content-Type', 'image/png');
    this.ctx.set('X-Content-Type-Options', 'nosniff');
    this.ctx.set('Cache-Control', 'public, max-age=300');
    this.ctx.body = result.rows[0].image;
  }
  async postAction() {
    const user = this.ctx.state.userInfo;
    if (!user?.objectId || !['guest', 'administrator'].includes(user.type)) return this.ctx.throw(401);
    let image;
    try { image = normalizeAvatar(this.post('image')); }
    catch { this.ctx.status = 400; return this.fail(this.locale('Please choose a valid avatar image.')); }
    let avatar;
    try {
      const origin = new URL(process.env.SERVER_URL);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('INVALID_ORIGIN');
      avatar = await saveAvatar(getPool(), user, image, origin);
    } catch (error) {
      if (error.message === 'UNAUTHORIZED') return this.ctx.throw(401);
      if (error.message === 'RATE_LIMIT') { this.ctx.status = 429; return this.fail(this.locale('Wait a few seconds before changing your avatar again.')); }
      // Do not include database details or credentials in the response/log.
      this.ctx.status = 503; return this.fail(this.locale('Avatar saving is temporarily unavailable. Please try again later.'));
    }
    // ThinkJS success() throws its stop-processing sentinel; keep it outside the storage catch.
    return this.success({ avatar });
  }
};
