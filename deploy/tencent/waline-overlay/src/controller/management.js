const BaseRest = require('./rest.js');
const { read } = require('../lib/management-read.js');
module.exports = class extends BaseRest {
  async getAction() {
    return this.success(await read(name => this.getModel(name), this.get()));
  }
};
