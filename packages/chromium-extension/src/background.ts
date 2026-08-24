import {
  NineRouterClient,
  formatAccount,
  normalizeBaseUrl,
  type RecentRequest,
  type RenderedAccount,
} from '@9router-quota/core';

const STORAGE_KEY = 'nineRouterQuota';
const REFRESH_ALARM = 'refresh';
const REFRESH_INTERVAL_MIN = 5;

interface Stored {
  baseUrl?: string;
  password?: string;
}

/**
 * MV3的service worker空闲约30秒就被回收，模块级变量随之丢失。所以这里的缓存
 * 只是"同一次唤醒内少打几次上游"，不能当持久状态用；跨唤醒要活下来的东西一律进
 * chrome.storage.session（随浏览器会话，不落盘）。
 */
let lastRendered: RenderedAccount[] = [];
let lastLogs: RecentRequest[] = [];
let stopRecentStream: (() => void) | undefined;
let refreshSeq = 0;

async function getStored(): Promise<Stored> {
  const bag = await chrome.storage.local.get(STORAGE_KEY);
  return (bag[STORAGE_KEY] as Stored) ?? {};
}

/** popup可能已经关了（关掉后sendMessage会reject），推送一律吞掉异常。 */
function pushToPopup(message: unknown): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

/**
 * container模式：Cookie / set-cookie在扩展里都是forbidden header，手动设会被静默
 * 丢弃。凭据由浏览器自己收下并在后续请求上带回，core只需发credentials: 'include'。
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
    if (seq !== refreshSeq) return; //已有更新的刷新在跑，丢弃这次过期结果
    lastRendered = accounts.map(formatAccount);
    await chrome.storage.session.set({ accounts: lastRendered, updatedAt: Date.now() });
    pushToPopup({ type: 'quota', accounts: lastRendered, updatedAt: Date.now() });
  } catch (err) {
    if (seq !== refreshSeq) return;
    pushToPopup({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

/** "最近请求"走SSE长连接，只在登录后开一次，不随每次手动刷新重连。 */
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
  //只清密码，服务地址留着，重新登录时不用再填一遍
  const { baseUrl } = await getStored();
  await chrome.storage.local.set({ [STORAGE_KEY]: { baseUrl } });
  await refresh();
}

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
        //popup每次打开都是全新页面，service worker却可能是刚被唤醒的空白状态。
        //先把session里存的上一份数据回灌，用户立刻看到内容，再后台拉新的。
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
  return true; //异步sendResponse，必须同步返回true保住消息通道
});

/**
 * 定时刷新用chrome.alarms而不是setInterval：service worker随时会被回收，
 * setInterval会跟着一起没；alarms由浏览器保管，到点主动把worker唤醒。
 */
chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_INTERVAL_MIN });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) void refresh();
});
chrome.runtime.onStartup.addListener(() => void refresh());
chrome.runtime.onInstalled.addListener(() => void refresh());
