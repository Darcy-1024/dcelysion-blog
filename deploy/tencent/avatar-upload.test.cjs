'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

function fixture() {
  const elements = []; const events = {}; const requests = [];
  let response = { ok: false, status: 503, json: async () => ({ errno: 1 }) };
  let reloads = 0;
  class Element {
    constructor(tag) { this.tag = tag; this.listeners = {}; this.dataset = {}; this.children = []; this.parentElement = { querySelector: () => elements.find(e => e.className === 'dc-avatar-upload') }; elements.push(this); }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    setAttribute(name, value) { this[name] = value; }
    getAttribute(name) { return this[name]; }
    append(...items) { this.children.push(...items); }
    after(item) { this.afterElement = item; }
    closest() { return this.tag === 'avatar' ? this : null; }
    remove() { this.removed = true; }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
    async click() {
      if (this.tag === 'input') { this.files = [{ type: 'image/png', size: 100 }]; await this.listeners.change(); }
      else await this.listeners.click?.();
    }
  }
  const avatar = new Element('avatar');
  const avatarImage = new Element('img'); avatarImage.src = `https://comments.dcelysion.cn/api/avatar?id=${'a'.repeat(64)}`;
  const document = {
    head: new Element('head'), body: new Element('body'),
    createElement: tag => {
      const element = new Element(tag);
      if (tag === 'canvas') { element.getContext = () => ({ drawImage() {} }); element.toDataURL = () => 'data:image/png;base64,aGVsbG8='; }
      return element;
    },
    addEventListener: (type, callback) => { events[type] = callback; },
    querySelector: () => avatar,
    querySelectorAll: () => [avatarImage],
  };
  const window = { TOKEN: 'synthetic-token', serverURL: 'https://admin.example/waline-api/' };
  const location = { pathname: '/ui/profile', origin: 'https://admin.example', reload: () => { reloads++; } };
  runInNewContext(readFileSync(join(__dirname, 'avatar-upload-v1.js'), 'utf8'), {
    window, document, location, Element, URL: class extends URL { static createObjectURL() { return 'blob:fixture'; } static revokeObjectURL() {} },
    Image: class extends Element { constructor() { super('img'); this.naturalWidth = 400; this.naturalHeight = 300; } async decode() {} },
    MutationObserver: class { observe() {} }, localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null },
    navigator: { language: 'zh-CN' }, AbortSignal, alert: message => { throw new Error(message); },
    fetch: async (url, options) => { requests.push({ url: String(url), options }); return response; },
  });
  return { elements, requests, window, location, avatarImage, get reloads() { return reloads; }, set response(value) { response = value; },
    async open() {
      let prevented = false; let stopped = false;
      events.click({ target: avatar, preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(prevented, true); assert.equal(stopped, true);
      return elements.findLast(e => e.tag === 'dialog');
    },
  };
}
test('avatar click opens a preview; cancelling leaves the current avatar unchanged', async () => {
  const app = fixture(); const dialog = await app.open();
  assert.equal(dialog.open, true); assert.equal(app.requests.length, 0);
  await dialog.children.at(-1).children[0].click();
  assert.equal(dialog.removed, true); assert.equal(app.reloads, 0); assert.equal(app.requests.length, 0);
});
test('save uses the existing same-origin bearer session; failed saves can retry and successful saves reload', async () => {
  const app = fixture(); const dialog = await app.open(); const save = dialog.children.at(-1).children[1];
  await save.click();
  assert.equal(app.requests[0].url, 'https://admin.example/waline-api/avatar?lang=zh-CN');
  assert.equal(app.requests[0].options.headers.Authorization, 'Bearer synthetic-token');
  assert.deepEqual(JSON.parse(app.requests[0].options.body), { image: 'aGVsbG8=' });
  assert.equal(save.disabled, false); assert.equal(app.reloads, 0);
  app.response = { ok: true, status: 200, json: async () => ({ errno: 0, data: { avatar: 'https://comments.example/api/avatar?id=synthetic' } }) };
  await save.click(); assert.equal(app.reloads, 1);
});
test('an unexpected external API origin never receives the bearer token', async () => {
  const app = fixture(); const dialog = await app.open(); app.window.serverURL = 'https://external.example/api/';
  await dialog.children.at(-1).children[1].click();
  assert.equal(app.requests.length, 0); assert.equal(app.reloads, 0);
});
test('private management displays canonical avatar URLs through the existing same-origin proxy', () => {
  const app = fixture();
  assert.equal(app.avatarImage.src, `https://admin.example/waline-api/avatar?id=${'a'.repeat(64)}`);
});
