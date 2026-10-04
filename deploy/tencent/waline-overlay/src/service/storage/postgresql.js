const MySQL = require('./mysql.js');
const { toSqlOrder } = require('./order.js');

const mapKeys = ({ insertedat, createdat, updatedat, ...item }) => {
  const mapFields = {
    insertedAt: insertedat,
    createdAt: createdat,
    updatedAt: updatedat,
  };

  for (const field in mapFields) {
    if (!mapFields[field]) {
      continue;
    }

    item[field] = mapFields[field];
  }

  return item;
};
module.exports = class extends MySQL {
  // Based on @waline/vercel 1.41.6 (GPL-2.0), see vendor/LICENSE.
  // Unlike upstream update(), keep the complete condition in the actual UPDATE.
  async managementState(id, oldType, oldVersion, type) {
    if (!['guest', 'banned'].includes(oldType) || !['guest', 'banned'].includes(type)) return false;
    const affected = await this.model(this.tableName)
      .where({ id, type: oldType, auth_version: oldVersion })
      .update({ type, auth_version: oldVersion + 1 });
    return affected === 1;
  }
  mapOrderField(field) {
    return super.mapOrderField(field).toLowerCase();
  }

  getSqlOrder(order) {
    return toSqlOrder(order, { nulls: true });
  }

  model(tableName) {
    return super.model(tableName.toLowerCase());
  }

  async select(where, options = {}) {
    const lowerWhere = {};

    for (const i in where) {
      lowerWhere[i.toLowerCase()] = where[i];
    }

    if (Array.isArray(options.field)) {
      options.field = options.field.map((field) => field.toLowerCase());
    }

    const data = await super.select(lowerWhere, options);

    return data.map(mapKeys);
  }

  async add(data) {
    ['insertedAt', 'createdAt', 'updatedAt']
      .filter((key) => data[key])
      .forEach((key) => {
        const val = data[key];

        data[key.toLowerCase()] =
          val instanceof Date ? think.datetime(val, 'YYYY-MM-DD HH:mm:ss') : val;
        // oxlint-disable-next-line typescript/no-dynamic-delete
        delete data[key];
      });

    return super.add(data).then(mapKeys);
  }

  async count(...args) {
    let result = await super.count(...args);

    try {
      if (Array.isArray(result)) {
        result.forEach((r) => {
          r.count = Math.trunc(Number(r.count));
        });
      } else {
        result = Math.trunc(Number(result));
      }
    } catch (err) {
      console.log(err);
    }

    return result;
  }

  async setSeqId(id) {
    const instance = this.model(this.tableName);

    return instance.query(`ALTER SEQUENCE ${instance.tableName}_seq RESTART WITH ${id};`);
  }
};
