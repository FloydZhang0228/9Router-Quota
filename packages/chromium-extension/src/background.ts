import {
  NineRouterClient,
  describeProvider,
  describeQuota,
  normalizeBaseUrl,
  providerLogo,
  quotaPercentUsed,
  type AccountQuota,
  type RecentRequest,
} from '@9router-quota/core';

const STORAGE_KEY = 'nineRouterQuota';
const REFRESH_ALARM = 'refresh';
const REFRESH_INTERVAL_MIN = 5;
const BOUNDS_KEY = 'popupBounds';
const DEFAULT_BOUNDS = { width: 780, height: 580 };

interface Stored {
  baseUrl?: string;
  password?: string;
}

/**
 * MV3 的 service worker 空闲约 30 秒就被回收，模块级变量随之丢失。所以这里的缓存
 * 只是"同一次唤醒内少打几次上游"，不能当持久状态用；跨唤醒要活下来的东西一律进
 * chrome.storage.session（随浏览器会话，不落盘）。
 */
let lastRendered: RenderedAccount[] = [];
let lastLogs: RecentRequest[] = [];
let stopRecentStream: (() => void) | undefined;
let refreshSeq = 0;

function formatAccount({ connection, usage }: AccountQuota) {
  const { service } = describeProvider(connection.provider);
  const account = connection.email || connection.displayName || connection.name || connection.id;
  const quotas = Object.entries(usage.quotas ?? {}).map(([key, quota]) => ({
    name: quota.displayName || quota.name || key,
    description: describeQuota(connection.provider, quota),
    percent: quotaPercentUsed(quota),
    unlimited: quota.unlimited === true,
    resetAt: quota.resetAt,
    used: quota.used,
    total: quota.total,
  }));
  // 与 VSCode 端同一套过滤：Claude 的 plan 服务端写死成 "Claude Code"；其他账号拿不到
  // 真实档位时会回退成跟服务名一样的占位串，展示出来只是把服务名重复一遍。
  const plan =
    connection.provider === 'claude' || !usage.plan || usage.plan.toLowerCase() === service.toLowerCase()
      ? undefined
      : usage.plan;
  return { id: connection.id, service, account, plan, logo: providerLogo(connection.provider), quotas };
}

type RenderedAccount = ReturnType<typeof formatAccount>;

async function getStored(): Promise<Stored> {
  const bag = await chrome.storage.local.get(STORAGE_KEY);
  return (bag[STORAGE_KEY] as Stored) ?? {};
}

/** popup 可能已经关了（关掉后 sendMessage 会 reject），推送一律吞掉异常。 */
function pushToPopup(message: unknown): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

/**
 * container 模式：Cookie / set-cookie 在扩展里都是 forbidden header，手动设会被静默
 * 丢弃。凭据由浏览器自己收下并在后续请求上带回，core 只需发 credentials: 'include'。
 */
function makeClient(baseUrl: string): NineRouterClient {
  return new NineRouterClient(baseUrl, 'container');
}

async function refresh(reconnectStream = false): Promise<void> {
  const seq = ++refreshSeq;
  const { baseUrl, password } = await getStored();
  if (!baseUrl || !password) {
    pushToPopup({ type: 'needLogin', baseUrl: baseUrl ?? '' });
    return;
  }

  if (!lastRendered.length) pushToPopup({ type: 'loading' });
  try {
    const client = makeClient(baseUrl);
    await client.login(password);
    if (reconnectStream) {
      stopRecentStream?.();
      stopRecentStream = undefined;
    }
    ensureRecentStream(client);
    const accounts = await client.fetchAllQuotas();
    if (seq !== refreshSeq) return; // 已有更新的刷新在跑，丢弃这次过期结果
    lastRendered = accounts.map(formatAccount);
    await chrome.storage.session.set({ accounts: lastRendered, updatedAt: Date.now() });
    pushToPopup({ type: 'quota', accounts: lastRendered, updatedAt: Date.now() });
  } catch (err) {
    if (seq !== refreshSeq) return;
    pushToPopup({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

/** "最近请求"走 SSE 长连接，只在登录后开一次，不随每次手动刷新重连。 */
function ensureRecentStream(client: NineRouterClient): void {
  if (stopRecentStream) return;
  stopRecentStream = client.openRecentRequestsStream((items) => {
    lastLogs = items.slice(0, 2);
    void chrome.storage.session.set({ logs: lastLogs });
    pushToPopup({ type: 'recentRequests', items: lastLogs });
  });
}

async function refreshAccount(connectionId: string): Promise<void> {
  const { baseUrl, password } = await getStored();
  if (!baseUrl || !password) return;
  try {
    const client = makeClient(baseUrl);
    await client.login(password);
    const connection = (await client.fetchConnections()).find((c) => c.id === connectionId);
    const usage = connection && (await client.fetchUsage(connectionId));
    if (!connection || !usage?.quotas || !Object.keys(usage.quotas).length) return;
    const account = formatAccount({ connection, usage });
    const idx = lastRendered.findIndex((a) => a.id === account.id);
    if (idx >= 0) lastRendered[idx] = account;
    else lastRendered.push(account);
    await chrome.storage.session.set({ accounts: lastRendered });
    pushToPopup({ type: 'quotaAccount', account });
  } catch (err) {
    pushToPopup({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

async function logout(): Promise<void> {
  stopRecentStream?.();
  stopRecentStream = undefined;
  lastRendered = [];
  lastLogs = [];
  await chrome.storage.session.remove(['accounts', 'logs', 'updatedAt']);
  // 只清密码，服务地址留着，重新登录时不用再填一遍
  const { baseUrl } = await getStored();
  await chrome.storage.local.set({ [STORAGE_KEY]: { baseUrl } });
  await refresh();
}

/**
 * 原生 action popup（default_popup）在 Chrome 里位置写死在工具栏图标正下方，没有 API 能挪。
 * 改成手动开一个 type:'popup' 的独立浮动窗口，位置/尺寸就完全由 chrome.windows API 掌控——
 * 用户拖到哪儿，onBoundsChanged 就记到哪儿，下次点图标直接复用上次的位置，不用每次都猜。
 */
let popupWindowId: number | undefined;

async function openPopupWindow(): Promise<void> {
  if (popupWindowId != null) {
    try {
      await chrome.windows.update(popupWindowId, { focused: true });
      return;
    } catch {
      popupWindowId = undefined; // 窗口已被用户关掉，falls through 重新创建
    }
  }
  const { [BOUNDS_KEY]: bounds } = await chrome.storage.local.get(BOUNDS_KEY);
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: bounds?.width ?? DEFAULT_BOUNDS.width,
    height: bounds?.height ?? DEFAULT_BOUNDS.height,
    left: bounds?.left,
    top: bounds?.top,
  });
  popupWindowId = win.id;
}

chrome.action.onClicked.addListener(() => void openPopupWindow());

chrome.windows.onBoundsChanged.addListener((win) => {
  if (win.id !== popupWindowId) return;
  void chrome.storage.local.set({
    [BOUNDS_KEY]: { left: win.left, top: win.top, width: win.width, height: win.height },
  });
});

chrome.windows.onRemoved.addListener((id) => {
  if (id === popupWindowId) popupWindowId = undefined;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    switch (message?.type) {
      case 'login':
        await chrome.storage.local.set({
          [STORAGE_KEY]: {
            baseUrl: normalizeBaseUrl(String(message.baseUrl ?? '')),
            password: String(message.password ?? ''),
          },
        });
        await refresh();
        break;
      case 'refresh':
        await refresh(true);
        break;
      case 'refreshAccount':
        if (message.connectionId) await refreshAccount(String(message.connectionId));
        break;
      case 'logout':
        await logout();
        break;
      case 'ready': {
        // popup 每次打开都是全新页面，service worker 却可能是刚被唤醒的空白状态。
        // 先把 session 里存的上一份数据回灌，用户立刻看到内容，再后台拉新的。
        const bag = await chrome.storage.session.get(['accounts', 'logs', 'updatedAt']);
        if (Array.isArray(bag.accounts) && bag.accounts.length) {
          lastRendered = bag.accounts as RenderedAccount[];
          pushToPopup({ type: 'quota', accounts: lastRendered, updatedAt: bag.updatedAt ?? Date.now() });
        }
        if (Array.isArray(bag.logs) && bag.logs.length) {
          lastLogs = bag.logs as RecentRequest[];
          pushToPopup({ type: 'recentRequests', items: lastLogs });
        }
        await refresh();
        break;
      }
    }
    sendResponse({ ok: true });
  })();
  return true; // 异步 sendResponse，必须同步返回 true 保住消息通道
});

/**
 * 定时刷新用 chrome.alarms 而不是 setInterval：service worker 随时会被回收，
 * setInterval 会跟着一起没；alarms 由浏览器保管，到点主动把 worker 唤醒。
 */
chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_INTERVAL_MIN });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) void refresh();
});
chrome.runtime.onStartup.addListener(() => void refresh());
chrome.runtime.onInstalled.addListener(() => void refresh());
