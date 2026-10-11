(() => {
  if (window.dcAvatarUploadInstalled) return;
  window.dcAvatarUploadInstalled = true;
  const chinese = (localStorage.getItem('i18nextLng') || navigator.language).toLowerCase().startsWith('zh');
  const text = chinese ? {
    choose: '上传头像', title: '更换头像', hint: '支持 JPG、PNG、WebP、GIF，最大 10 MB。图片居中裁成方形；动图使用静态画面。',
    save: '保存头像', cancel: '取消', busy: '正在保存…', invalid: '请选择 10 MB 以内的 JPG、PNG、WebP 或 GIF 图片。',
    failed: '头像上传失败，请稍后重试。', login: '登录已失效，请重新登录。', rate: '请稍等几秒再更换头像。',
  } : {
    choose: 'Upload avatar', title: 'Change avatar', hint: 'JPG, PNG, WebP or GIF, up to 10 MB. Images are center-cropped to a square; animations use a still frame.',
    save: 'Save avatar', cancel: 'Cancel', busy: 'Saving…', invalid: 'Choose a JPG, PNG, WebP or GIF image up to 10 MB.',
    failed: 'Avatar upload failed. Please try again later.', login: 'Your session expired. Please log in again.', rate: 'Wait a few seconds before changing your avatar again.',
  };
  const style = document.createElement('style');
  style.textContent = '.dc-avatar-dialog{width:min(400px,calc(100vw - 48px));border:1px solid #dce5ff;border-radius:20px;padding:24px;color:#163958;background:#f5f8ff;box-shadow:0 20px 80px #0003}.dc-avatar-dialog::backdrop{background:#0006}.dc-avatar-dialog img{display:block;width:160px;height:160px;object-fit:cover;border-radius:50%;margin:20px auto}.dc-avatar-dialog button,.dc-avatar-upload{cursor:pointer;padding:8px 16px;border-radius:20px;border:1px solid #dce5ff;background:#fff;color:#163958}.dc-avatar-dialog button:disabled{opacity:.6;cursor:wait}.dc-avatar-actions{display:flex;justify-content:flex-end;gap:10px}.dc-avatar-dialog button[data-save]{background:#3f73ff;color:#fff}.dc-avatar-status{min-height:1.5em;color:#a12828}.dc-avatar-upload{display:block;margin:12px auto}';
  document.head.append(style);
  let dialog;

  function chooseFile() {
    if (dialog?.open) return;
    const picker = document.createElement('input');
    picker.type = 'file'; picker.accept = 'image/jpeg,image/png,image/webp,image/gif';
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) {
        alert(text.invalid); return;
      }
      const objectUrl = URL.createObjectURL(file);
      try {
        const image = new Image(); image.src = objectUrl;
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid image');
        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
        const edge = Math.min(image.naturalWidth, image.naturalHeight);
        canvas.getContext('2d').drawImage(image, (image.naturalWidth - edge) / 2, (image.naturalHeight - edge) / 2, edge, edge, 0, 0, 256, 256);
        showPreview(canvas.toDataURL('image/png'));
      } catch { alert(text.invalid); }
      finally { URL.revokeObjectURL(objectUrl); }
    }, { once: true });
    picker.click();
  }

  function showPreview(dataUrl) {
    if (!isProfile()) return;
    dialog = document.createElement('dialog'); dialog.className = 'dc-avatar-dialog';
    dialog.setAttribute('aria-labelledby', 'dc-avatar-title');
    const title = document.createElement('h3'); title.id = 'dc-avatar-title'; title.textContent = text.title;
    const preview = new Image(); preview.src = dataUrl; preview.alt = text.title;
    const hint = document.createElement('p'); hint.textContent = text.hint;
    const status = document.createElement('p'); status.className = 'dc-avatar-status'; status.setAttribute('role', 'status');
    const actions = document.createElement('div'); actions.className = 'dc-avatar-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = text.cancel;
    const save = document.createElement('button'); save.type = 'button'; save.textContent = text.save; save.dataset.save = '';
    let busy = false;
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
      busy = true; save.disabled = true; cancel.disabled = true; save.textContent = text.busy; status.textContent = '';
      try {
        const endpoint = new URL('avatar', api.href.endsWith('/') ? api : `${api.href}/`);
        endpoint.searchParams.set('lang', chinese ? 'zh-CN' : 'en');
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ image: dataUrl.split(',')[1] }), redirect: 'error',
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
      }
    });
    actions.append(cancel, save); dialog.append(title, preview, hint, status, actions);
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
