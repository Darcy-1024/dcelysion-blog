(() => {
  const zh = {
    back: '返回登录', forgotTitle: '找回密码', forgotHelp: '输入注册邮箱，我们会发送一封验证邮件。',
    email: '邮箱地址', send: '发送重置邮件', resetTitle: '设置新密码',
    passwordHelp: '密码至少 12 个字符，最多 1024 个字符。', password: '新密码',
    confirm: '确认新密码', show: '显示密码', save: '保存新密码', applyAgain: '重新申请链接',
    sending: '正在发送…', saving: '正在保存…', sent: '如果该邮箱对应可找回的账号，我们会发送重置邮件。请检查收件箱和垃圾邮件。',
    mismatch: '两次输入的密码不一致，请重新输入。', invalid: '密码至少 12 个字符，最多 1024 个字符且不超过 4096 字节。',
    expired: '链接已失效，请重新申请。', success: '密码已更新，请重新登录。',
    rate: '请求过于频繁，请稍后重试。', network: '网络连接失败，请稍后重试。', server: '服务暂不可用，请稍后重试。',
  };
  const en = {
    back: 'Back to login', forgotTitle: 'Reset password', forgotHelp: 'Enter your registered email address to receive a verification link.',
    email: 'Email address', send: 'Send reset email', resetTitle: 'Set a new password',
    passwordHelp: 'Use 12 to 1024 characters.', password: 'New password', confirm: 'Confirm new password',
    show: 'Show passwords', save: 'Save new password', applyAgain: 'Request a new link',
    sending: 'Sending…', saving: 'Saving…', sent: 'If this email belongs to an eligible account, we will send a reset message. Check your inbox and spam folder.',
    mismatch: 'The passwords do not match. Please try again.', invalid: 'Use 12 to 1024 characters and at most 4096 bytes.',
    expired: 'This link has expired. Please request a new one.', success: 'Password updated. Please sign in again.',
    rate: 'Too many requests. Please try later.', network: 'Network error. Please try again.', server: 'Service unavailable. Please try later.',
  };
  const language = (localStorage.getItem('i18nextLng') || navigator.language || '').toLowerCase();
  const t = language.startsWith('zh') ? zh : en;
  document.documentElement.lang = t === zh ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t[node.dataset.i18n]; });
  const status = document.querySelector('#status');
  const form = document.querySelector('form');
  const button = form.querySelector('button');
  let token = null;

  if (document.body.dataset.page === 'reset') {
    const params = new URLSearchParams(location.hash.slice(1));
    token = params.get('token');
    history.replaceState(null, '', location.pathname);
    if (!token) { status.textContent = t.expired; form.hidden = true; }
    document.querySelector('#show-password').addEventListener('change', (event) => {
      const type = event.target.checked ? 'text' : 'password';
      document.querySelector('#password').type = type;
      document.querySelector('#confirm').type = type;
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const reset = document.body.dataset.page === 'reset';
    const password = document.querySelector('#password')?.value;
    if (reset && password !== document.querySelector('#confirm').value) { status.textContent = t.mismatch; return; }
    if (reset && (password.length < 12 || password.length > 1024 || new TextEncoder().encode(password).length > 4096)) {
      status.textContent = t.invalid; return;
    }
    button.disabled = true;
    status.textContent = reset ? t.saving : t.sending;
    try {
      const response = await fetch(reset ? '/api/password-reset/confirm' : '/api/password-reset/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify(reset ? { token, password } : { email: document.querySelector('#email').value }),
      });
      const result = await response.json().catch(() => null);
      if (response.status === 429) status.textContent = t.rate;
      else if (reset && response.status === 400) {
        token = null;
        form.hidden = true;
        status.textContent = t.expired;
      } else if (!response.ok || result?.errno !== 0) status.textContent = response.status === 422 ? t.invalid : t.server;
      else if (reset) {
        token = null;
        window.TOKEN = null;
        localStorage.removeItem('TOKEN');
        sessionStorage.removeItem('TOKEN');
        sessionStorage.removeItem('token');
        form.hidden = true;
        status.textContent = t.success;
      } else status.textContent = t.sent;
    } catch { status.textContent = t.network; }
    finally { button.disabled = false; }
  });
})();
