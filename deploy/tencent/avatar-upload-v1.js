(() => {
  if (window.dcAvatarUploadInstalled) return;
  window.dcAvatarUploadInstalled = true;
  const chinese = (localStorage.getItem('i18nextLng') || navigator.language).toLowerCase().startsWith('zh');
  const text = chinese ? {
    choose: '上传头像', title: '更换头像', hint: '拖动图片调整位置，使用滑块缩放。也可聚焦图片后用方向键调整。动图使用静态画面。',
    zoom: '缩放', reset: '重置裁剪', crop: '头像裁剪区域',
    save: '保存头像', cancel: '取消', busy: '正在保存…', invalid: '请选择 10 MB 以内的 JPG、PNG、WebP 或 GIF 图片。',
    failed: '头像上传失败，请稍后重试。', login: '登录已失效，请重新登录。', rate: '请稍等几秒再更换头像。',
  } : {
    choose: 'Upload avatar', title: 'Change avatar', hint: 'Drag to position and use the slider to zoom. Focus the image and use arrow keys to adjust. Animations use a still frame.',
    zoom: 'Zoom', reset: 'Reset crop', crop: 'Avatar crop area',
    save: 'Save avatar', cancel: 'Cancel', busy: 'Saving…', invalid: 'Choose a JPG, PNG, WebP or GIF image up to 10 MB.',
    failed: 'Avatar upload failed. Please try again later.', login: 'Your session expired. Please log in again.', rate: 'Wait a few seconds before changing your avatar again.',
  };
  const style = document.createElement('style');
  style.textContent = '.dc-avatar-dialog{width:min(400px,calc(100vw - 48px));border:1px solid #dce5ff;border-radius:20px;padding:24px;color:#163958;background:#f5f8ff;box-shadow:0 20px 80px #0003}.dc-avatar-dialog::backdrop{background:#0006}.dc-avatar-dialog img{display:block;width:160px;height:160px;object-fit:cover;border-radius:50%;margin:20px auto}.dc-avatar-dialog button,.dc-avatar-upload{cursor:pointer;padding:8px 16px;border-radius:20px;border:1px solid #dce5ff;background:#fff;color:#163958}.dc-avatar-dialog button:disabled{opacity:.6;cursor:wait}.dc-avatar-actions{display:flex;justify-content:flex-end;gap:10px}.dc-avatar-dialog button[data-save]{background:#3f73ff;color:#fff}.dc-avatar-status{min-height:1.5em;color:#a12828}.dc-avatar-upload{display:block;margin:12px auto}';
  document.head.append(style);
  style.textContent += '.dc-avatar-dialog{box-sizing:border-box;max-height:calc(100dvh - 32px);overflow:auto}.dc-avatar-crop{display:block;width:min(256px,100%);height:auto;aspect-ratio:1;margin:16px auto;touch-action:none;cursor:grab;background:repeating-conic-gradient(#ddd 0% 25%,#fff 0% 50%) 0/16px 16px}.dc-avatar-crop:focus-visible{outline:3px solid #3f73ff;outline-offset:3px}.dc-avatar-dialog img{width:80px;height:80px;margin:12px auto}.dc-avatar-zoom{display:flex;align-items:center;gap:12px}.dc-avatar-zoom input{min-width:0;flex:1}.dc-avatar-actions{flex-wrap:wrap}';
  let dialog;
  let decoding = false;

  function chooseFile() {
    if (dialog?.open || decoding) return;
    const picker = document.createElement('input');
    picker.type = 'file'; picker.accept = 'image/jpeg,image/png,image/webp,image/gif';
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) {
        alert(text.invalid); return;
      }
      const objectUrl = URL.createObjectURL(file);
      if (dialog?.open || decoding) { URL.revokeObjectURL(objectUrl); return; }
      decoding = true;
      try {
        const image = new Image(); image.src = objectUrl;
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid image');
        // Freeze animated input once so dragging never changes the selected frame.
        const source = document.createElement('canvas');
        source.width = image.naturalWidth; source.height = image.naturalHeight;
        source.getContext('2d').drawImage(image, 0, 0);
        showPreview(source);
      } catch { alert(text.invalid); }
      finally { URL.revokeObjectURL(objectUrl); decoding = false; }
    }, { once: true });
    picker.click();
  }

  function showPreview(source) {
    if (!isProfile()) return;
    dialog = document.createElement('dialog'); dialog.className = 'dc-avatar-dialog';
    dialog.setAttribute('aria-labelledby', 'dc-avatar-title');
    const title = document.createElement('h3'); title.id = 'dc-avatar-title'; title.textContent = text.title;
    const preview = new Image(); preview.alt = text.title;
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
    canvas.className = 'dc-avatar-crop'; canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', text.crop);
    const zoomLabel = document.createElement('label'); zoomLabel.className = 'dc-avatar-zoom'; zoomLabel.textContent = text.zoom;
    const zoom = document.createElement('input'); zoom.type = 'range'; zoom.min = '1'; zoom.max = '4'; zoom.step = '0.01'; zoom.value = '1';
    zoomLabel.append(zoom);
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = text.reset; reset.dataset.reset = '';
    let centerX = source.width / 2; let centerY = source.height / 2; let drag;
    const edge = () => Math.min(source.width, source.height) / Number(zoom.value);
    function render() {
      const size = edge();
      centerX = Math.max(size / 2, Math.min(source.width - size / 2, centerX));
      centerY = Math.max(size / 2, Math.min(source.height - size / 2, centerY));
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, 256, 256);
      context.drawImage(source, centerX - size / 2, centerY - size / 2, size, size, 0, 0, 256, 256);
      preview.src = canvas.toDataURL('image/png');
    }
    const hint = document.createElement('p'); hint.textContent = text.hint;
    const status = document.createElement('p'); status.className = 'dc-avatar-status'; status.setAttribute('role', 'status');
    const actions = document.createElement('div'); actions.className = 'dc-avatar-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = text.cancel;
    const save = document.createElement('button'); save.type = 'button'; save.textContent = text.save; save.dataset.save = '';
    let busy = false;
    zoom.addEventListener('input', () => { if (!busy) render(); });
    reset.addEventListener('click', () => {
      if (busy) return;
      zoom.value = '1'; centerX = source.width / 2; centerY = source.height / 2; render();
    });
    canvas.addEventListener('pointerdown', event => {
      if (busy || drag || event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('pointermove', event => {
      if (busy || !drag || drag.id !== event.pointerId) return;
      const rect = canvas.getBoundingClientRect();
      centerX -= (event.clientX - drag.x) * edge() / rect.width;
      centerY -= (event.clientY - drag.y) * edge() / rect.height;
      drag.x = event.clientX; drag.y = event.clientY; render();
    });
    const endDrag = () => { drag = undefined; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);
    canvas.addEventListener('keydown', event => {
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!delta || busy) return;
      event.preventDefault(); centerX += delta[0] * edge() / 50; centerY += delta[1] * edge() / 50; render();
    });
    render();
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { dialog.remove(); dialog = undefined; }, { once: true });
    save.addEventListener('click', async () => {
      if (busy) return;
      const token = window.TOKEN ?? sessionStorage.getItem('TOKEN') ?? localStorage.getItem('TOKEN');
      if (!token) { status.textContent = text.login; return; }
      let api;
      try { api = new URL(window.serverURL, location.origin); }
      catch { status.textContent = text.failed; return; }
      // Tokens go only to the same origin, through the existing authenticated proxy.
      if (api.origin !== location.origin) { status.textContent = text.failed; return; }
      busy = true; drag = undefined; zoom.disabled = true; reset.disabled = true;
      save.disabled = true; cancel.disabled = true; save.textContent = text.busy; status.textContent = '';
      try {
        const endpoint = new URL('avatar', api.href.endsWith('/') ? api : `${api.href}/`);
        endpoint.searchParams.set('lang', chinese ? 'zh-CN' : 'en');
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ image: canvas.toDataURL('image/png').split(',')[1] }), redirect: 'error',
          signal: AbortSignal.timeout(30000),
        });
        if (response.status === 401) throw new Error(text.login);
        if (response.status === 429) throw new Error(text.rate);
        const result = await response.json();
        if (!response.ok || result.errno !== 0 || typeof result.data?.avatar !== 'string') throw new Error(text.failed);
        location.reload();
      } catch (error) {
        status.textContent = [text.login, text.rate].includes(error.message) ? error.message : text.failed;
        busy = false; save.disabled = false; cancel.disabled = false; save.textContent = text.save;
        zoom.disabled = false; reset.disabled = false;
      }
    });
    actions.append(cancel, save); dialog.append(title, canvas, zoomLabel, reset, preview, hint, status, actions);
    document.body.append(dialog); dialog.showModal();
  }

  function isProfile() { return /\/ui\/profile\/?$/.test(location.pathname); }
  function adaptAvatarUrls() {
    let api;
    try { api = new URL(window.serverURL, location.origin); }
    catch { return; }
    if (api.origin !== location.origin) return;
    for (const image of document.querySelectorAll('img[src]')) {
      let source;
      try { source = new URL(image.getAttribute('src'), location.origin); }
      catch { continue; }
      if (source.origin !== 'https://comments.dcelysion.cn' || source.pathname !== '/api/avatar' ||
          !/^[a-f0-9]{64}$/.test(source.searchParams.get('id') || '')) continue;
      const next = new URL('avatar', api.href.endsWith('/') ? api : `${api.href}/`);
      next.searchParams.set('id', source.searchParams.get('id'));
      if (image.src !== next.href) image.src = next.href;
    }
  }
  document.addEventListener('click', event => {
    if (!isProfile() || !(event.target instanceof Element)) return;
    if (!event.target.closest('.profile-avatar-btn,.dc-avatar-upload')) return;
    event.preventDefault(); event.stopImmediatePropagation(); chooseFile();
  }, true);
  function attach() {
    adaptAvatarUrls();
    if (!isProfile()) { if (dialog?.open) dialog.close(); return; }
    const avatar = document.querySelector('.profile-avatar-btn');
    if (!avatar || avatar.parentElement.querySelector('.dc-avatar-upload')) return;
    avatar.title = text.choose;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'dc-avatar-upload'; button.textContent = text.choose;
    avatar.after(button);
  }
  new MutationObserver(attach).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  attach();
})();
