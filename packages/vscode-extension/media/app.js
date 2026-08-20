const vscode = acquireVsCodeApi();
const root = document.getElementById('root');

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'needLogin') renderLogin(msg.baseUrl || '');
  else if (msg.type === 'loading') renderLoading();
  else if (msg.type === 'quota') renderQuota(msg.accounts, msg.updatedAt);
  else if (msg.type === 'error') renderError(msg.message);
});

function renderLogin(baseUrl) {
  root.innerHTML = `
    <form id="login-form" class="login">
      <label>9Router 地址</label>
      <input name="baseUrl" type="text" placeholder="http://9router.example.com" value="${escapeHtml(baseUrl)}" required />
      <label>Dashboard 密码</label>
      <input name="password" type="password" required />
      <button type="submit">登录</button>
      <p class="hint">密码仅保存在 VSCode 本地凭据库，不会同步或明文落盘。</p>
    </form>`;
  document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    vscode.postMessage({ type: 'login', baseUrl: form.get('baseUrl'), password: form.get('password') });
  });
}

function renderLoading() {
  root.innerHTML = `<div class="status">加载中…</div>`;
}

function renderError(message) {
  root.innerHTML = `
    <div class="status error">${escapeHtml(message)}</div>
    <div class="actions">
      <button id="retry">重试</button>
      <button id="logout">退出登录</button>
    </div>`;
  document.getElementById('retry').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  document.getElementById('logout').addEventListener('click', () => vscode.postMessage({ type: 'logout' }));
}

function renderQuota(accounts, updatedAt) {
  const time = new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false });
  const body = accounts.length
    ? accounts.map(renderAccount).join('')
    : `<div class="status">未获取到任何账号配额</div>`;
  root.innerHTML = `
    <div class="toolbar">
      <span>更新于 ${time}</span>
      <div class="actions">
        <button id="refresh" title="刷新">⟳</button>
        <button id="logout" title="退出登录">⎋</button>
      </div>
    </div>
    ${body}`;
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  document.getElementById('logout').addEventListener('click', () => vscode.postMessage({ type: 'logout' }));
}

function renderAccount(acc) {
  const quotaRows = acc.quotas.map(renderQuotaRow).join('');
  const sub = [acc.account, acc.plan].filter(Boolean).map(escapeHtml).join(' · ');
  return `
    <div class="account">
      <div class="account-header">
        <span class="account-title">${escapeHtml(acc.service)}</span>
        <span class="account-sub">${sub}</span>
      </div>
      ${quotaRows}
    </div>`;
}

function renderQuotaRow(q) {
  const barStyle = typeof q.percent === 'number' ? `width:${q.percent.toFixed(0)}%` : 'display:none';
  return `
    <div class="quota-row">
      <div class="bar" style="${barStyle}"></div>
      <span class="quota-name">${escapeHtml(q.name)}</span>
      <span class="quota-desc">${escapeHtml(q.description)}</span>
    </div>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
