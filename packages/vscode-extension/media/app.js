const vscode = acquireVsCodeApi();
const root = document.getElementById('root');

//工具栏图标：与 core/src/icons.ts 同一份 SVG 路径（webview 静态 JS 没法 import core），
//改图标时两个文件同步。彻底放弃 Unicode 字形——各平台字体墨迹比例/基线不可控，
//逐字号猜值修过两次、transform scale 修过一次都不齐；SVG 几何固定，天然等大且居中。
const TOOL_ICONS = {
  refresh: '<path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  grid: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>',
  'theme-system': '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/>',
  'theme-dark': '<path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/>',
  'theme-light':
    '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/>',
};
const toolIconSvg = (name, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TOOL_ICONS[name] ?? ''}</svg>`;

//账号数据也进webview state：retainContextWhenHidden只是尽力保留，内存紧张时webview
//仍会被销毁重建。重建后若数据不在state里，就要干等一次完整刷新（几秒）才有画面，
//表现为"切走再切回来变加载中"。state恢复首帧旧数据，刷新回来无感替换。
const restored = vscode.getState();
let lastAccounts = restored?.accounts || null;
let lastUpdatedAt = restored?.updatedAt || null;
let lastLogs = restored?.logs || [];
let logsLoaded = restored?.logsLoaded || false;
let viewMode = restored?.viewMode || 'list';
let theme = restored?.theme || 'system';
//下面这几个const必须在文件靠前的位置声明，早于第 ~117行那次顶层同步renderQuota() 调用
//（webview被销毁重建时，state里的缓存账号会触发它立刻跑一次首帧）。const有暂时性死区，
//renderQuota→renderRing这条调用链只要碰到一个还没执行到的const声明就会ReferenceError，
//而且崩溃发生在顶层脚本里，会连带把这行往后的所有声明都晾在那——此后每次刷新都复现同一个
//崩溃，面板永远画不出内容。之前THEME_ICONS、RING_RADIUS/RING_CIRCUMFERENCE都在文件后半段
//踩过这个坑（后者只在viewMode恢复成 'grid' 时才触发，比THEME_ICONS那次更隐蔽）。
//以后新增的顶层const，只要可能被首帧渲染路径用到，都得挪到这一段里。
const RING_RADIUS = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function setState(patch) {
  vscode.setState({ ...vscode.getState(), ...patch });
}

/** VS Code会给webview的body打上vscode-dark/vscode-light class，随主题切换自动更新。 */
function hostIsDark() {
  return document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
}

function applyTheme() {
  document.body.dataset.theme = theme === 'system' ? (hostIsDark() ? 'dark' : 'light') : theme;
}
applyTheme();
new MutationObserver(() => theme === 'system' && applyTheme()).observe(document.body, {
  attributes: true,
  attributeFilter: ['class'],
});

//目录由extension.ts通过data-images注入，文件名随账号数据下发（acc.logo，源头是core的
//PROVIDERS表）——这边不再自己判断哪个provider有图，免得两处清单分头维护漏掉新provider。
const IMAGES_BASE = root.dataset.images || '';
function iconFor(logo, service) {
  if (IMAGES_BASE && logo) {
    return `<img src="${IMAGES_BASE}/providers/${encodeURIComponent(logo)}" alt="" />`;
  }
  return `<span class="icon-fallback">${escapeHtml((service || '?')[0].toUpperCase())}</span>`;
}

/** 已用百分比 -> 剩余百分比；无数值时返回null（unlimited但仍带数值的，如余额，照样换算）。 */
function remainingOf(q) {
  if (q.percent == null) return null;
  return Math.max(0, Math.min(100, 100 - q.percent));
}

/** 按剩余百分比配色：>=70绿、31-69黄、<=30红。 */
function levelOf(remaining) {
  if (remaining == null) return 'none';
  if (remaining <= 30) return 'red';
  if (remaining < 70) return 'amber';
  return 'green';
}

/** 还剩多久重置，比绝对日期直观（"5h0m后" 而不是 "08/21 15:52"）。 */
function timeUntil(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Math.floor((d.getTime() - Date.now()) / 1000);
  if (diff <= 0) return '已重置';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

function timeAgo(iso) {
  const raw = (Date.now() - new Date(iso).getTime()) / 1000;
  //服务端/客户端时钟有几秒误差时，刚推过来的最新一条会算出负数——夹到0而不是显示空白。
  const diff = Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'needLogin') renderLogin(msg.baseUrl || '');
  else if (msg.type === 'loading') renderLoading();
  else if (msg.type === 'quota') {
    lastAccounts = msg.accounts;
    lastUpdatedAt = msg.updatedAt;
    setState({ accounts: lastAccounts, updatedAt: lastUpdatedAt });
    renderQuota();
  } else if (msg.type === 'quotaAccount') {
    if (lastAccounts) {
      const idx = lastAccounts.findIndex((a) => a.id === msg.account.id);
      if (idx >= 0) lastAccounts[idx] = msg.account;
      else lastAccounts.push(msg.account);
      setState({ accounts: lastAccounts });
      renderQuota();
    }
  } else if (msg.type === 'recentRequests') {
    lastLogs = msg.items || [];
    logsLoaded = true;
    setState({ logs: lastLogs, logsLoaded: true });
    //页脚容器还不存在时（比如首次登录）才整页重绘，平时只更新这一小块，不打断滚动位置。
    const el = document.getElementById('recent-footer');
    if (el) el.innerHTML = footerRows(lastLogs);
    else if (lastAccounts) renderQuota();
  } else if (msg.type === 'error') renderError(msg.message);
});
//告诉扩展主机"脚本已经跑起来了，消息监听器就位"——resolveWebviewView里那次refresh()
//如果因为时序问题（webview还没跑完脚本就postMessage）被吞掉，靠这个兜底重新拿一次数据。
vscode.postMessage({ type: 'ready' });
//首帧：state里有旧数据就直接画（webview被销毁重建的场景），只有真正的第一次打开
//才落到"加载中…"。后台刷新回来会走renderQuota无感替换。
if (lastAccounts) renderQuota();
else renderLoading();
setInterval(() => {
  const el = document.getElementById('recent-footer');
  if (el && lastLogs.length) el.innerHTML = footerRows(lastLogs);
}, 30000);

function renderLogin(baseUrl) {
  root.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-logo">9</div>
        <h1 class="login-title">9Router Quota</h1>
        <p class="login-subtitle">连接你的9Router服务，查看各账号的实时配额</p>
        <form id="login-form">
          <label class="login-field">
            <span class="login-label">9Router地址</span>
            <input name="baseUrl" type="text" placeholder="http://9router.example.com" value="${escapeHtml(baseUrl)}" required />
          </label>
          <label class="login-field">
            <span class="login-label">Dashboard密码</span>
            <input name="password" type="password" required />
          </label>
          <button type="submit" class="login-submit">登录</button>
        </form>
        <p class="login-hint">密码仅保存在VSCode本地凭据库，不会同步或明文落盘。</p>
      </div>
    </div>`;
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
  document.getElementById('logout').addEventListener('click', () => {
    setState({ accounts: null, updatedAt: null, logs: [], logsLoaded: false });
    vscode.postMessage({ type: 'logout' });
  });
}

function setViewMode(mode) {
  viewMode = mode;
  setState({ viewMode });
  renderQuota();
}

function cycleTheme() {
  theme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
  setState({ theme });
  applyTheme();
  renderQuota();
}

function renderQuota() {
  if (!lastAccounts) return;
  //整页重绘会连带销毁 .board那个滚动容器，滚动位置跟着归零——单账号刷新、刷新全部、
  //切视图/主题都走这里，用户翻到下面的账号时随便碰一下就被弹回顶部。先存后还。
  const scrollTop = document.querySelector('.board')?.scrollTop ?? 0;
  const time = new Date(lastUpdatedAt).toLocaleTimeString('zh-CN', { hour12: false });
  const body = lastAccounts.length
    ? lastAccounts.map((acc) => renderAccount(acc, viewMode)).join('')
    : `<div class="status">未获取到任何账号配额</div>`;
  root.innerHTML = `
    <div class="toolbar">
      <span>更新于 ${time}</span>
      <div class="actions">
        <button id="view-list" class="view-toggle" data-active="${viewMode === 'list'}" title="列表视图">${toolIconSvg('list')}</button>
        <button id="view-grid" class="view-toggle" data-active="${viewMode === 'grid'}" title="圆环视图">${toolIconSvg('grid')}</button>
        <button id="theme-toggle" title="主题：跟随系统/深色/浅色">${toolIconSvg(`theme-${theme}`)}</button>
        <button id="refresh" title="刷新全部">${toolIconSvg('refresh')}</button>
        <button id="logout" title="退出登录">${toolIconSvg('power')}</button>
      </div>
    </div>
    <div class="board board-${viewMode}">${body}</div>
    ${renderRecentFooter()}`;
  document.getElementById('view-list').addEventListener('click', () => setViewMode('list'));
  document.getElementById('view-grid').addEventListener('click', () => setViewMode('grid'));
  document.getElementById('theme-toggle').addEventListener('click', cycleTheme);
  //刷新期间不再清空面板（扩展主机那边已改成有数据就不发loading），
  //改成跟单账号刷新一样让按钮转圈；数据回来renderQuota整页重绘，class自然消失。
  document.getElementById('refresh').addEventListener('click', (e) => {
    e.currentTarget.classList.add('spin');
    vscode.postMessage({ type: 'refresh' });
  });
  //退出登录不能只发消息：state里还躺着旧账号数据，webview若被重建会把已注销的配额
  //又画出来。先清掉再交给扩展主机走needLogin流程。
  document.getElementById('logout').addEventListener('click', () => {
    lastAccounts = null;
    lastUpdatedAt = null;
    lastLogs = [];
    logsLoaded = false;
    setState({ accounts: null, updatedAt: null, logs: [], logsLoaded: false });
    vscode.postMessage({ type: 'logout' });
  });
  root.querySelectorAll('.account-refresh').forEach((btn) =>
    btn.addEventListener('click', () => {
      btn.classList.add('spin');
      vscode.postMessage({ type: 'refreshAccount', connectionId: btn.dataset.id });
    })
  );
  const board = document.querySelector('.board');
  if (board) board.scrollTop = scrollTop;
}

function footerRows(logs) {
  if (!logsLoaded) return `<div class="recent-row recent-loading">加载中…</div>`;
  return logs
    .slice(0, 2)
    .map(
      (l) => `
      <div class="recent-row">
        <span class="recent-model">${escapeHtml(l.model)}</span>
        <span class="recent-tokens">${l.promptTokens}<b>↑</b> ${l.completionTokens}<b>↓</b></span>
        <span class="recent-time">${timeAgo(l.timestamp)}</span>
      </div>`
    )
    .join('');
}

//容器本身始终渲染（哪怕暂时没数据），SSE消息才能直接找到它做局部更新；
//也保证页脚位置从一开始就固定，不会等数据来了才“空降”。
function renderRecentFooter() {
  return `<div class="recent-footer" id="recent-footer">${footerRows(lastLogs)}</div>`;
}

function renderAccount(acc, mode) {
  //Antigravity/Gemini等订阅型账号的plan（如Plus/Pro）有真实档位意义，跟账号名一起挤在
  //右侧小字里容易看不见，升级为服务名旁的小徽标；Claude那种假plan已在扩展主机过滤掉。
  const tier = acc.plan ? `<span class="account-tier">${escapeHtml(acc.plan)}</span>` : '';
  const sub = acc.account ? escapeHtml(acc.account) : '';
  const body = mode === 'grid' ? acc.quotas.map(renderRing).join('') : acc.quotas.map(renderQuotaRow).join('');
  return `
    <div class="account">
      <div class="account-header">
        <span class="account-icon">${iconFor(acc.logo, acc.service)}</span>
        <span class="account-title">${escapeHtml(acc.service)}</span>${tier}
        <button class="account-refresh" data-id="${escapeHtml(acc.id)}" title="刷新该账号">${toolIconSvg("refresh", 12)}</button>
        <span class="account-sub">${sub}</span>
      </div>
      <div class="${mode === 'grid' ? 'ring-row' : ''}">${body}</div>
    </div>`;
}

/**
 * “无硬性上限”但仍带真实余额（如DeepSeek信用池：unlimited + total=真实余额，
 * used/total只是0/满 的占位比例，看百分比毫无意义）时，直接显示金额本身。
 * total===0的排除掉是因为部分供应商（如Vercel的“已用”行）把total固定写死为0
 * 当占位符，那种不是真余额。
 */
function amountText(q) {
  if (!q.unlimited || !(q.total > 0)) return null;
  const remain = typeof q.used === 'number' ? Math.max(0, q.total - q.used) : q.total;
  return Number.isInteger(remain) ? String(remain) : remain.toFixed(2);
}

function renderQuotaRow(q) {
  const remaining = remainingOf(q);
  const amount = amountText(q);
  const level = remaining != null ? levelOf(remaining) : amount != null ? 'green' : 'none';
  const label = amount ?? (remaining != null ? remaining.toFixed(0) + '%' : null);
  const percent = Math.max(0, Math.min(100, remaining ?? (amount != null ? 100 : 0)));
  const color = level === 'red' ? 'var(--vscode-charts-red)' : level === 'amber' ? 'var(--vscode-charts-yellow)' : 'var(--vscode-charts-green)';
  const track = `linear-gradient(to right, ${color} 0%, ${color} ${percent}%, rgba(128,128,140,.25) ${percent}%, rgba(128,128,140,.25) 100%)`;
  const right =
    q.unlimited && label == null
      ? '<span class="quota-percent">无限</span>'
      : `<div class="quota-track" style="background:${track}"></div>
         <span class="quota-percent">${label ?? '—'}</span>`;
  const meta = q.resetAt ? `<span class="quota-meta" title="${escapeHtml(q.description)}">${timeUntil(q.resetAt)}</span>` : '';
  return `
    <div class="quota-row" data-level="${level}">
      <span class="quota-pill">${escapeHtml(q.name)}</span>
      ${right}
      ${meta}
    </div>`;
}

//SVG描边环：数值由JS直接算好dasharray/dashoffset，不依赖CSS conic-gradient色标
//的隐式排序规则（那条路线试了两版都在这个环境里渲染出问题），精确且没有歧义。
function renderRing(q) {
  const remaining = remainingOf(q);
  const amount = amountText(q);
  const level = remaining != null ? levelOf(remaining) : amount != null ? 'green' : 'none';
  const percent = Math.max(0, Math.min(100, remaining ?? (amount != null ? 100 : 0)));
  const text = amount ?? (q.unlimited && remaining == null ? '∞' : remaining != null ? `${remaining.toFixed(0)}%` : '—');
  //彩色弧长 = 剩余比例；半透明轨道 = 已用。颜色也按剩余额度取档。
  const offset = RING_CIRCUMFERENCE * (1 - percent / 100);
  return `
    <div class="ring-card">
      <div class="ring">
        <svg viewBox="0 0 52 52" width="52" height="52">
          <circle class="ring-track" cx="26" cy="26" r="${RING_RADIUS}" />
          <circle class="ring-fill" data-level="${level}" cx="26" cy="26" r="${RING_RADIUS}"
            stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${offset}" />
        </svg>
        <span class="ring-text">${text}</span>
      </div>
      <span class="ring-label">${escapeHtml(q.name)}</span>
      ${q.resetAt ? `<span class="ring-meta">${timeUntil(q.resetAt)}</span>` : ''}
    </div>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
