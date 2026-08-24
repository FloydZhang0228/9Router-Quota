import { amountText, levelOf, remainingOf, timeAgo, timeUntil, toolIconSvg } from '@9router-quota/core';

/**
 * 面板前端。渲染逻辑与VSCode端media/app.js同源，两处差异只有三点：
 *   ① 通信：vscode.postMessage / window.onmessage → chrome.runtime.sendMessage / onMessage
 *   ② 偏好存储：vscode.getState/setState → localStorage（popup每次开都是新页面）
 *   ③ 主题：宿主不提供 --vscode-* 变量，改用自己的调色板 + prefers-color-scheme
 * 展示层纯函数（remainingOf / amountText / levelOf / timeUntil / timeAgo）已收进core，
 * 两端共用，不再各抄一份。
 */

interface Quota {
  name: string;
  description: string;
  percent: number | null;
  unlimited: boolean;
  resetAt?: string;
  used?: number;
  total?: number;
}
interface Account {
  id: string;
  service: string;
  account: string;
  plan?: string;
  logo: string | null;
  quotas: Quota[];
}
interface LogRow {
  timestamp: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Chrome原生action popup尺寸硬顶在800x600（没有API能突破，超过这个数值不生效）。
 * 宽度按屏幕宽度的1/5动态算，高度直接顶满这个硬上限——用户想要的"顶到任务栏"在原生
 * popup里达不到，600px已经是能拿到的最大值。必须用绝对像素赋值（不能用vw/vh百分比）：
 * 百分比会让浏览器陷入"视口高度取决于文档高度、文档高度又是视口的百分比"的死循环，
 * 量不出该开多高——上面styles.css里那段780x580也是被这个坑逼出来的写死值，这里改成
 * JS算出来的动态像素，同样必须是绝对值。放在整个脚本最前面，赶在Chrome量popup尺寸之前。
 */
(function sizePopup(): void {
  //420px地板：屏幕宽度 / 5在常见1920px屏幕上只有384px，配额行（模型名pill + 进度条 +
  //百分比）在这个宽度下会被挤到裁切——地板保证至少有一列340px卡片的呼吸空间。
  const width = Math.max(420, Math.min(Math.round(screen.width / 5), 800));
  const height = Math.min(screen.availHeight, 600);
  for (const el of [document.documentElement, document.body]) {
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
  }
})();

const root = document.getElementById('root') as HTMLDivElement;

//版本号来自 manifest.json——CI 打包前把 tag 写进去，本地加载未打包源码时是 package.json 的版本
const VERSION = chrome.runtime.getManifest().version;

let lastAccounts: Account[] | null = null;
let lastUpdatedAt = 0;
let lastLogs: LogRow[] = [];
let logsLoaded = false;
let viewMode = localStorage.getItem('viewMode') || 'list';
let theme = localStorage.getItem('theme') || 'system';

function applyTheme(): void {
  document.body.dataset.theme =
    theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme === 'system') applyTheme();
});

const IMAGES_BASE = chrome.runtime.getURL('images');
function iconFor(logo: string | null, service: string): string {
  if (logo) return `<img src="${IMAGES_BASE}/providers/${encodeURIComponent(logo)}" alt="" />`;
  return `<span class="icon-fallback">${escapeHtml((service || '?')[0].toUpperCase())}</span>`;
}

function send(message: Record<string, unknown>): void {
  //service worker可能正在冷启动，首帧sendMessage偶发reject；吞掉即可，
  //background起来后会主动把数据推过来。
  chrome.runtime.sendMessage(message).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'needLogin') renderLogin(msg.baseUrl || '');
  else if (msg.type === 'loading') renderLoading();
  else if (msg.type === 'quota') {
    lastAccounts = msg.accounts;
    lastUpdatedAt = msg.updatedAt;
    renderQuota();
  } else if (msg.type === 'quotaAccount') {
    if (lastAccounts) {
      const idx = lastAccounts.findIndex((a) => a.id === msg.account.id);
      if (idx >= 0) lastAccounts[idx] = msg.account;
      else lastAccounts.push(msg.account);
      renderQuota();
    }
  } else if (msg.type === 'recentRequests') {
    lastLogs = msg.items || [];
    logsLoaded = true;
    //页脚容器还在就只更新这一小块，不整页重绘，免得打断滚动位置。
    const el = document.getElementById('recent-footer');
    if (el) el.innerHTML = footerRows(lastLogs);
    else if (lastAccounts) renderQuota();
  } else if (msg.type === 'error') renderError(msg.message);
});

renderLoading();
send({ type: 'ready' });
setInterval(() => {
  const el = document.getElementById('recent-footer');
  if (el && lastLogs.length) el.innerHTML = footerRows(lastLogs);
}, 30000);

function renderLogin(baseUrl: string): void {
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
        <p class="login-hint">地址http / https均可。密码保存在浏览器扩展的本地存储中，不会同步到云端。</p>
        <p class="login-version">v${VERSION}</p>
      </div>
    </div>`;
  document.getElementById('login-form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    send({ type: 'login', baseUrl: form.get('baseUrl'), password: form.get('password') });
    renderLoading();
  });
}

function renderLoading(): void {
  root.innerHTML = `<div class="status">加载中…</div>`;
}

function renderError(message: string): void {
  root.innerHTML = `
    <div class="status error">${escapeHtml(message)}</div>
    <div class="actions">
      <button id="retry">重试</button>
      <button id="logout">退出登录</button>
    </div>`;
  document.getElementById('retry')!.addEventListener('click', () => send({ type: 'refresh' }));
  document.getElementById('logout')!.addEventListener('click', () => send({ type: 'logout' }));
}

function setViewMode(mode: string): void {
  viewMode = mode;
  localStorage.setItem('viewMode', mode);
  renderQuota();
}

function cycleTheme(): void {
  theme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
  localStorage.setItem('theme', theme);
  applyTheme();
  renderQuota();
}

function renderQuota(): void {
  if (!lastAccounts) return;
  //整页重绘会销毁 .board滚动容器，位置归零。先存后还。
  const scrollTop = document.querySelector('.board')?.scrollTop ?? 0;
  const time = new Date(lastUpdatedAt).toLocaleTimeString('zh-CN', { hour12: false });
  const body = lastAccounts.length
    ? lastAccounts.map((acc) => renderAccount(acc, viewMode)).join('')
    : `<div class="status">未获取到任何账号配额</div>`;
  root.innerHTML = `
    <div class="toolbar">
      <span>更新于 ${time} · v${VERSION}</span>
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
  document.getElementById('view-list')!.addEventListener('click', () => setViewMode('list'));
  document.getElementById('view-grid')!.addEventListener('click', () => setViewMode('grid'));
  document.getElementById('theme-toggle')!.addEventListener('click', cycleTheme);
  document.getElementById('refresh')!.addEventListener('click', (e) => {
    (e.currentTarget as HTMLElement).classList.add('spin');
    send({ type: 'refresh' });
  });
  document.getElementById('logout')!.addEventListener('click', () => send({ type: 'logout' }));
  root.querySelectorAll<HTMLElement>('.account-refresh').forEach((btn) =>
    btn.addEventListener('click', () => {
      btn.classList.add('spin');
      send({ type: 'refreshAccount', connectionId: btn.dataset.id });
    })
  );
  const board = document.querySelector('.board');
  if (board) board.scrollTop = scrollTop;
}

function footerRows(logs: LogRow[]): string {
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

//容器始终渲染（哪怕暂时没数据），SSE消息才能直接找到它做局部更新。
function renderRecentFooter(): string {
  return `<div class="recent-footer" id="recent-footer">${footerRows(lastLogs)}</div>`;
}

function renderAccount(acc: Account, mode: string): string {
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

function renderQuotaRow(q: Quota): string {
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
  const meta = q.resetAt
    ? `<span class="quota-meta" title="${escapeHtml(q.description)}">${timeUntil(q.resetAt)}</span>`
    : '';
  return `
    <div class="quota-row" data-level="${level}">
      <span class="quota-pill">${escapeHtml(q.name)}</span>
      ${right}
      ${meta}
    </div>`;
}

//SVG描边环：dasharray/dashoffset由JS直接算，不依赖CSS conic-gradient的色标排序。
const RING_RADIUS = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function renderRing(q: Quota): string {
  const remaining = remainingOf(q);
  const amount = amountText(q);
  const level = remaining != null ? levelOf(remaining) : amount != null ? 'green' : 'none';
  const percent = Math.max(0, Math.min(100, remaining ?? (amount != null ? 100 : 0)));
  const text = amount ?? (q.unlimited && remaining == null ? '∞' : remaining != null ? `${remaining.toFixed(0)}%` : '—');
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

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}
