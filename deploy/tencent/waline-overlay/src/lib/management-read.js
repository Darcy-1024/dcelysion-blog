'use strict';

// Read through Waline's storage service; never access the database directly.
const commentFields = ['comment', 'nick', 'url', 'status', 'pid', 'rid', 'user_id', 'insertedAt', 'updatedAt'];
const userFields = ['display_name', 'email', 'url', 'type', 'label', 'auth_version', 'createdAt', 'updatedAt'];
const pick = (row, fields) => Object.fromEntries(['objectId', ...fields].map(key => [key, row[key]]));
const userView = row => ({ ...pick(row, userFields), type: /^verify:/iu.test(row.type) ? 'unverified' : row.type });

async function read(models, query) {
  const comments = models('Comment');
  const users = models('Users');
  const { resource, id, page = 1, pageSize = 15, search = '', status = '', path = '', userId = '' } = query;
  if (resource === 'comment' && id) {
    const [item] = await comments.select({ objectId: id }, { field: [...commentFields] });
    if (!item) return null;
    const rootId = item.rid || item.objectId;
    const threadWhere = { url: item.url, _complex: { _logic: 'or', objectId: rootId, rid: rootId } };
    const total = await comments.count(threadWhere);
    const thread = await comments.select(threadWhere, { field: [...commentFields], limit: pageSize, offset: (page - 1) * pageSize, order: [{ field: 'insertedAt', direction: 'asc' }, { field: 'objectId', direction: 'asc' }] });
    const deleteCount = await comments.count({ _complex: { _logic: 'or', objectId: item.objectId, pid: item.objectId, rid: item.objectId } });
    return { item: pick(item, commentFields), thread: thread.map(row => pick(row, commentFields)), deleteCount, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }
  if (resource === 'user' && id) {
    const [item] = await users.select({ objectId: id }, { field: [...userFields] });
    return item ? userView(item) : null;
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
  const rows = await model.select(where, { field: resource === 'comment' ? [...commentFields] : [...userFields], order: [{ field: resource === 'comment' ? 'insertedAt' : 'createdAt', direction: 'desc' }, { field: 'objectId', direction: 'desc' }], limit: pageSize, offset: (page - 1) * pageSize });
  return { items: rows.map(row => resource === 'comment' ? pick(row, commentFields) : userView(row)), total, page, pageSize, pages: Math.ceil(total / pageSize) };
}
module.exports = { read };
