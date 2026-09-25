const nunjucks = require('nunjucks');
const { PasswordHash } = require('phpass');

const defaultLocales = require('../locales/index.js');
const chineseMail = require('../locales/zh-CN.json');

const defaultLang = 'en-us';

module.exports = {
  success(...args) {
    this.ctx.success(...args);

    return think.prevent();
  },
  fail(...args) {
    this.ctx.fail(...args);

    return think.prevent();
  },
  jsonOrSuccess(...args) {
    return this[this.ctx.state.deprecated ? 'json' : 'success'](...args);
  },
  locale(message, variables) {
    const { lang: userLang } = this.get();
    const lang = (userLang || defaultLang).toLowerCase();

    const customLocales = this.config('locales');
    const locales = customLocales || defaultLocales;

    const localMessage =
      locales?.[lang]?.[message] ||
      defaultLocales?.[lang]?.[message] ||
      defaultLocales[defaultLang][message];

    if (localMessage) {
      message = localMessage;
    }

    return nunjucks.renderString(message, variables);
  },
  mailLocale(message, variables) {
    const template = chineseMail[message];
    if (!template) {
      throw new Error(`缺少简体中文邮件模板: ${message}`);
    }
    return nunjucks.renderString(template, variables);
  },
  getModel(modelName) {
    const { storage, customModel } = this.config();

    if (typeof customModel === 'function') {
      const modelInstance = customModel(modelName, this);

      if (modelInstance) {
        return modelInstance;
      }
    }

    return this.service(`storage/${storage}`, modelName);
  },
  hashPassword(password) {
    const PwdHash = this.config('encryptPassword') || PasswordHash;
    const pwdHash = new PwdHash();

    return pwdHash.hashPassword(password);
  },
  checkPassword(password, storeHash) {
    const PwdHash = this.config('encryptPassword') || PasswordHash;
    const pwdHash = new PwdHash();

    return pwdHash.checkPassword(password, storeHash);
  },
};
