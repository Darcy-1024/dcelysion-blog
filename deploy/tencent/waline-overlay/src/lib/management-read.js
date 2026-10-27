'use strict';

// Read through Waline's storage service; never access the database directly.
const commentFields = ['comment', 'nick', 'url', 'status', 'pid', 'rid', 'user_id', 'insertedAt', 'updatedAt'];
const userFields = ['display_name', 'email', 'avatar', 'url', 'type', 'label', 'auth_version', 'createdAt', 'updatedAt'];
const pick = (row, fields) => Object.fromEntries(['objectId', ...fields].map(key => [key, row[key]]));
const userView = async (row, avatar) => ({ ...pick(row, userFields), avatar: row.avatar || await avatar({ mail: row.email, nick: row.display_name, link: row.url }), type: /^verify:/iu.test(row.type) ? 'unverified' : row.type });

async function read(models, query, avatar = async () => '') {
  const comments = models('Comment');
  const users = models('Users');
  const linkedUsers = new Map();
  const commentView = async row => {
    let user;
    if (!row.avatar && row.user_id) {
      const key = String(row.user_id);
      if (!linkedUsers.has(key)) linkedUsers.set(key, Promise.resolve().then(() => users.select({ objectId: row.user_id }, { field: ['avatar', 'email', 'display_name', 'url'] })).then(rows => rows[0]).catch(() => undefined));
      user = await linkedUsers.get(key);
    }
    let source = row.avatar || user?.avatar || '';
    if (!source) {
      try {
        // Waline's default template calls trim on mail: missing values must be strings.
        source = await avatar({
          mail: row.mail || user?.email || '',
          nick: row.nick || user?.display_name || '',
          link: row.link || user?.url || '',
        });
      } catch {
        // Optional avatar enrichment must never hide otherwise readable comments.
        source = '';
      }
    }
    // Mail and other storage fields are inputs only, never part of the response.
    return { ...pick(row, commentFields), avatar: source };
  };
  const { resource, id, page = 1, pageSize = 15, search = '', status = '', path = '', userId = '' } = query;
  if (resource === 'comment' && id) {
    // Read existing storage fields rather than assuming an optional avatar column exists.
    const [item] = await comments.select({ objectId: id }, {});
    if (!item) return null;
    const rootId = item.rid || item.objectId;
    const threadWhere = { url: item.url, _complex: { _logic: 'or', objectId: rootId, rid: rootId } };
    const total = await comments.count(threadWhere);
    const thread = await comments.select(threadWhere, { limit: pageSize, offset: (page - 1) * pageSize, order: [{ field: 'insertedAt', direction: 'asc' }, { field: 'objectId', direction: 'asc' }] });
    const deleteCount = await comments.count({ _complex: { _logic: 'or', objectId: item.objectId, pid: item.objectId, rid: item.objectId } });
    return { item: await commentView(item), thread: await Promise.all(thread.map(commentView)), deleteCount, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }
  if (resource === 'user' && id) {
    const [item] = await users.select({ objectId: id }, { field: [...userFields] });
    return item ? userView(item, avatar) : null;
  }
  const where = {};
  if (resource === 'comment') {
    if (path) where.url = path;
    if (userId) where.user_id = userId;
    if (status) where.status = status === 'approved' ? ['NOT IN', ['waiting', 'spam']] : status;
    if (search) where.comment = ['LIKE', `%${search}%`];
  } else if (search) {
    where._complex = { _logic: 'or', email: ['LIKE', `%${search}%`], display_name: ['LIKE', `%${search}%`] };
  }
  const model = resource === 'comment' ? comments : users;
  const total = await model.count(where);
  const rows = await model.select(where, { ...(resource === 'comment' ? {} : { field: [...userFields] }), order: [{ field: resource === 'comment' ? 'insertedAt' : 'createdAt', direction: 'desc' }, { field: 'objectId', direction: 'desc' }], limit: pageSize, offset: (page - 1) * pageSize });
  return { items: await Promise.all(rows.map(row => resource === 'comment' ? commentView(row) : userView(row, avatar))), total, page, pageSize, pages: Math.ceil(total / pageSize) };
}
module.exports = { read };
