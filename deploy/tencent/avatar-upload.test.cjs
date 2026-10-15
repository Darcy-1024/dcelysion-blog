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
    getBoundingClientRect() { return { left: 0, top: 0, width: 256, height: 256 }; }
    setPointerCapture(id) { this.capturedPointer = id; }
    releasePointerCapture(id) { if (this.capturedPointer === id) this.capturedPointer = undefined; }
    hasPointerCapture(id) { return this.capturedPointer === id; }
    async dispatch(type, values = {}) {
      const event = { target: this, currentTarget: this, pointerId: 1, button: 0, clientX: 0, clientY: 0, preventDefault() { this.defaultPrevented = true; }, ...values };
      await this.listeners[type]?.(event);
      return event;
    }
    async click() {
      if (this.tag === 'input' && this.type === 'file') { this.files = [{ type: 'image/png', size: 100 }]; await this.listeners.change(); }
      else await this.listeners.click?.();
    }
  }
  const avatar = new Element('avatar');
  const avatarImage = new Element('img'); avatarImage.src = `https://comments.dcelysion.cn/api/avatar?id=${'a'.repeat(64)}`;
  const document = {
    head: new Element('head'), body: new Element('body'),
    createElement: tag => {
      const element = new Element(tag);
      if (tag === 'canvas') {
        element.draws = []; element.operations = [];
        element.getContext = () => ({
          clearRect(...args) { element.operations.push({ type: 'clear', args }); },
          drawImage(...args) { element.draws.push(args); element.operations.push({ type: 'draw', args }); },
        });
        element.toDataURL = () => `data:image/png;base64,${Buffer.from(JSON.stringify(element.draws.at(-1).slice(1))).toString('base64')}`;
      }
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
  return { elements, requests, window, location, avatarImage,
    get canvas() { return elements.findLast(e => e.tag === 'canvas'); },
    get draws() { return this.canvas.draws; },
    get canvasOperations() { return this.canvas.operations; },
    get zoom() { return elements.findLast(e => e.tag === 'input' && e.type === 'range'); },
    get reset() { return elements.findLast(e => e.tag === 'button' && 'reset' in e.dataset); },
    get save() { return elements.findLast(e => e.tag === 'button' && 'save' in e.dataset); },
    get preview() { return elements.findLast(e => e.tag === 'img'); },
    get crop() { return this.draws.at(-1).slice(1); },
    get reloads() { return reloads; }, set response(value) { response = value; },
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
  app.zoom.value = '2'; await app.zoom.dispatch('input');
  await app.canvas.dispatch('pointerdown', { clientX: 128, clientY: 128 });
  await app.canvas.dispatch('pointermove', { clientX: 160, clientY: 160 });
  const currentAvatar = app.avatarImage.src;
  await dialog.children.at(-1).children[0].click();
  assert.equal(dialog.removed, true); assert.equal(app.reloads, 0); assert.equal(app.requests.length, 0);
  assert.equal(app.avatarImage.src, currentAvatar);
});
test('crop starts centered on the original image and refreshes its circular preview', async () => {
  const app = fixture(); await app.open();
  assert.equal(app.canvas.className, 'dc-avatar-crop');
  assert.equal(app.canvas.width, 256); assert.equal(app.canvas.height, 256);
  const source = app.draws[0][0];
  assert.equal(source.width, 400); assert.equal(source.height, 300);
  assert.equal(source.draws.length, 1); assert.equal(source.draws[0][0].src, 'blob:fixture');
  assert.deepEqual(source.draws[0].slice(1), [0, 0]);
  assert.deepEqual(app.crop, [50, 0, 300, 300, 0, 0, 256, 256]);
  assert.equal(app.preview.src, app.canvas.toDataURL('image/png'));
  assert.deepEqual(app.canvasOperations.map(operation => operation.type), ['clear', 'draw']);
  assert.deepEqual(app.canvasOperations[0].args, [0, 0, 256, 256]);
  assert.equal(Number(app.zoom.min), 1); assert.equal(Number(app.zoom.max), 4); assert.equal(Number(app.zoom.step), 0.01);
});
test('dragging and zooming use original image coordinates and clamp at image boundaries', async () => {
  const app = fixture(); await app.open(); const canvas = app.canvas; const initialPreview = app.preview.src;
  await canvas.dispatch('pointerdown', { clientX: 128, clientY: 128 });
  assert.equal(canvas.capturedPointer, 1);
  await canvas.dispatch('pointermove', { clientX: 160, clientY: 128 });
  assert.deepEqual(app.crop, [12.5, 0, 300, 300, 0, 0, 256, 256]);
  assert.notEqual(app.preview.src, initialPreview);
  app.zoom.value = '2'; await app.zoom.dispatch('input');
  assert.deepEqual(app.crop, [87.5, 75, 150, 150, 0, 0, 256, 256]);
  await canvas.dispatch('pointermove', { clientX: 10000, clientY: 10000 });
  assert.deepEqual(app.crop, [0, 0, 150, 150, 0, 0, 256, 256]);
  await canvas.dispatch('pointermove', { clientX: -10000, clientY: -10000 });
  assert.deepEqual(app.crop, [250, 150, 150, 150, 0, 0, 256, 256]);
  await canvas.dispatch('pointerup', { clientX: -10000, clientY: -10000 });
  const stoppedCrop = app.crop;
  await canvas.dispatch('pointermove', { clientX: 128, clientY: 128 });
  assert.deepEqual(app.crop, stoppedCrop);
  app.zoom.value = '1'; await app.zoom.dispatch('input');
  assert.deepEqual(app.crop, [100, 0, 300, 300, 0, 0, 256, 256]);
  assert.equal(app.preview.src, canvas.toDataURL('image/png'));
});
test('pointer cancellation stops dragging and reset restores the original centered crop', async () => {
  const app = fixture(); await app.open(); const canvas = app.canvas;
  app.zoom.value = '3'; await app.zoom.dispatch('input');
  await canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
  await canvas.dispatch('pointermove', { clientX: 120, clientY: 120 });
  await canvas.dispatch('pointercancel'); const cancelledCrop = app.crop;
  await canvas.dispatch('pointermove', { clientX: 240, clientY: 240 });
  assert.deepEqual(app.crop, cancelledCrop);
  await app.reset.click();
  assert.equal(Number(app.zoom.value), 1);
  assert.deepEqual(app.crop, [50, 0, 300, 300, 0, 0, 256, 256]);
  assert.equal(app.preview.src, canvas.toDataURL('image/png'));
  assert.equal(app.requests.length, 0);
});
test('arrow keys move the crop and unrelated keys leave it unchanged', async () => {
  const app = fixture(); await app.open(); app.zoom.value = '2'; await app.zoom.dispatch('input');
  const before = app.crop;
  const right = await app.canvas.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(right.defaultPrevented, true);
  assert.equal(app.crop[0], before[0] + 3); assert.equal(app.crop[1], before[1]);
  const down = await app.canvas.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(down.defaultPrevented, true); assert.equal(app.crop[1], before[1] + 3);
  const moved = app.crop; await app.canvas.dispatch('keydown', { key: 'a' });
  assert.deepEqual(app.crop, moved);
});
test('save uses the existing same-origin bearer session; failed saves can retry and successful saves reload', async () => {
  const app = fixture(); await app.open(); const save = app.save;
  app.zoom.value = '2'; await app.zoom.dispatch('input');
  await save.click();
  assert.equal(app.requests[0].url, 'https://admin.example/waline-api/avatar?lang=zh-CN');
  assert.equal(app.requests[0].options.headers.Authorization, 'Bearer synthetic-token');
  assert.deepEqual(JSON.parse(app.requests[0].options.body), { image: app.canvas.toDataURL('image/png').split(',')[1] });
  assert.deepEqual(JSON.parse(Buffer.from(JSON.parse(app.requests[0].options.body).image, 'base64').toString()), app.crop);
  assert.equal(save.disabled, false); assert.equal(app.reloads, 0);
  assert.equal(app.zoom.disabled, false); assert.equal(app.reset.disabled, false);
  app.response = { ok: true, status: 200, json: async () => ({ errno: 0, data: { avatar: 'https://comments.example/api/avatar?id=synthetic' } }) };
  await save.click(); assert.equal(app.reloads, 1);
});
test('an unexpected external API origin never receives the bearer token', async () => {
  const app = fixture(); const dialog = await app.open(); app.window.serverURL = 'https://external.example/api/';
  await dialog.children.at(-1).children[1].click();
  assert.equal(app.requests.length, 0); assert.equal(app.reloads, 0);
});
test('saving without a bearer session never sends a request', async () => {
  const app = fixture(); await app.open(); delete app.window.TOKEN;
  await app.save.click();
  assert.equal(app.requests.length, 0); assert.equal(app.reloads, 0);
  assert.equal(app.elements.find(e => e.className === 'dc-avatar-status').textContent, '登录已失效，请重新登录。');
});
test('private management displays canonical avatar URLs through the existing same-origin proxy', () => {
  const app = fixture();
  assert.equal(app.avatarImage.src, `https://admin.example/waline-api/avatar?id=${'a'.repeat(64)}`);
});
