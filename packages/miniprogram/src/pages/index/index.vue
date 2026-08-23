<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import { NineRouterClient, type AccountQuota } from '@9router-quota/core';
import { createUniRequestAdapter } from '../../lib/uniRequestAdapter';
import { saveSession, loadSession, clearSession } from '../../lib/session';
import { formatAccount, type RenderedAccount } from '../../lib/formatAccount';
import { startPolling, type PolledLogRow } from '../../lib/recentLogsPoller';
import QuotaRing from '../../components/QuotaRing.vue';
import QuotaRow from '../../components/QuotaRow.vue';
import RecentFooter from '../../components/RecentFooter.vue';

const REFRESH_INTERVAL_MS = 5 * 60_000; // 对齐 Chrome 端 REFRESH_INTERVAL_MIN = 5
const THEME_KEY = 'nineRouterQuota.theme';
const THEME_ICONS = { system: '◐', dark: '🌙', light: '☀️' } as const;

const baseUrl = ref('');
const password = ref('');
const status = ref<'loading' | 'login' | 'ready' | 'error'>('loading');
const errorMessage = ref('');
const quotas = ref<AccountQuota[]>([]);
const accounts = ref<RenderedAccount[]>([]);
const viewMode = ref<'list' | 'grid'>('list');
const recentRows = ref<PolledLogRow[]>([]);
const recentLoaded = ref(false);
const refreshing = ref(false);
const theme = ref<'system' | 'dark' | 'light'>((uni.getStorageSync(THEME_KEY) as any) || 'system');
const sysTheme = ref<string | undefined>((uni.getSystemInfoSync() as any)?.theme);
const resolvedTheme = computed(() => {
  if (theme.value !== 'system') return theme.value;
  return sysTheme.value === 'light' ? 'light' : 'dark';
});
const themeClass = computed(() => 'theme-' + resolvedTheme.value);
let client: NineRouterClient | null = null;
let stopPolling: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function startBackgroundTasks(url: string) {
  stopPolling = startPolling(url, createUniRequestAdapter(), {}, (rows) => {
    recentRows.value = rows;
    recentLoaded.value = true;
  });
  refreshTimer = setInterval(async () => {
    if (!client) return;
    try {
      quotas.value = await client.fetchAllQuotas();
      accounts.value = quotas.value.map(formatAccount);
    } catch {
      // 后台刷新失败保持旧数据，下个周期再试
    }
  }, REFRESH_INTERVAL_MS);
}

function stopBackgroundTasks() {
  stopPolling?.();
  stopPolling = null;
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

async function doLogin(url: string, pw: string) {
  client = new NineRouterClient(url, 'manual', createUniRequestAdapter());
  await client.login(pw);
  quotas.value = await client.fetchAllQuotas();
  accounts.value = quotas.value.map(formatAccount);
  saveSession({ baseUrl: url, password: pw });
  status.value = 'ready';
  startBackgroundTasks(url);
}

async function onSubmit() {
  status.value = 'loading';
  errorMessage.value = '';
  try {
    await doLogin(baseUrl.value, password.value);
  } catch (e) {
    status.value = 'error';
    errorMessage.value = (e as Error).message;
  }
}

function onLogout() {
  stopBackgroundTasks();
  clearSession();
  client = null;
  quotas.value = [];
  accounts.value = [];
  recentRows.value = [];
  recentLoaded.value = false;
  status.value = 'login';
}

function toggleView() {
  viewMode.value = 'list';
}

function toggleViewGrid() {
  viewMode.value = 'grid';
}

const refreshingIds = ref<Set<string>>(new Set());

async function onRefreshAccount(id: string) {
  if (!client || refreshingIds.value.has(id)) return;
  refreshingIds.value = new Set(refreshingIds.value).add(id);
  try {
    const target = quotas.value.find((q) => q.connection.id === id);
    if (target) {
      const usage = await client.fetchUsage(id);
      if (usage?.quotas && Object.keys(usage.quotas).length) {
        const next = quotas.value.map((q) => (q.connection.id === id ? { connection: q.connection, usage } : q));
        quotas.value = next;
        accounts.value = next.map(formatAccount);
      }
    }
  } catch {
    // 失败保持旧数据
  }
  const s = new Set(refreshingIds.value);
  s.delete(id);
  refreshingIds.value = s;
}

async function onRefreshAll() {
  if (!client || refreshing.value) return;
  refreshing.value = true;
  try {
    quotas.value = await client.fetchAllQuotas();
    accounts.value = quotas.value.map(formatAccount);
  } catch {
    // 刷新失败保持旧数据
  }
  refreshing.value = false;
}

function applyNavbar() {
  const light = resolvedTheme.value === 'light';
  uni.setNavigationBarColor({
    frontColor: light ? '#000000' : '#ffffff', // 微信只接受这两个值
    backgroundColor: light ? '#f0f0f2' : '#0f1a2e',
    fail: () => {}, // 失败静默——导航栏保持原色是可接受降级
  });
}

function cycleTheme() {
  theme.value = theme.value === 'system' ? 'dark' : theme.value === 'dark' ? 'light' : 'system';
  uni.setStorageSync(THEME_KEY, theme.value);
  applyNavbar();
}

// system 档实时跟随系统切换（微信支持 onThemeChange）；手动档不响应
const onSysThemeChange = (res: { theme: string }) => {
  sysTheme.value = res.theme;
  if (theme.value === 'system') applyNavbar();
};
uni.onThemeChange(onSysThemeChange as any);

onMounted(async () => {
  applyNavbar(); // 重启后若存储是 light，导航栏也跟着变浅
  const saved = loadSession();
  if (!saved) {
    status.value = 'login';
    return;
  }
  baseUrl.value = saved.baseUrl;
  password.value = saved.password;
  try {
    await doLogin(saved.baseUrl, saved.password);
  } catch (e) {
    status.value = 'error';
    errorMessage.value = (e as Error).message;
  }
});

// 切到后台停轮询/停定时刷新，切回前台且已登录时恢复——避免小程序在后台空耗流量，
// 也避免重复调用 startBackgroundTasks 导致定时器叠加（用 refreshTimer 是否已存在把关）。
onHide(() => stopBackgroundTasks());
onShow(() => {
  if (status.value === 'ready' && client && !refreshTimer) startBackgroundTasks(baseUrl.value);
});
onUnmounted(() => {
  stopBackgroundTasks();
  uni.offThemeChange?.(onSysThemeChange as any);
});
</script>

<template>
  <view :class="['app-shell', themeClass]">
    <view v-if="status === 'loading'" class="status">加载中…</view>
    <view v-else-if="status === 'login' || status === 'error'" class="login-screen">
      <view class="login-card">
        <view class="login-logo">9</view>
        <text class="login-title">9Router Quota</text>
        <text class="login-subtitle">连接你的9Router服务，查看各账号的实时配额</text>
        <view class="login-field">
          <text class="login-label">9Router地址</text>
          <input v-model="baseUrl" placeholder="http://9router.example.com" />
        </view>
        <view class="login-field">
          <text class="login-label">Dashboard密码</text>
          <input v-model="password" password />
        </view>
        <button class="login-submit" @tap="onSubmit">登录</button>
        <text v-if="status === 'error'" class="login-error">{{ errorMessage }}</text>
        <text class="login-hint">密码保存在小程序本地存储中，不会同步到云端。</text>
      </view>
    </view>
    <view v-else class="ready">
      <view class="toolbar">
        <text class="toolbar-count">{{ accounts.length }} 个账号</text>
        <view class="actions">
          <view class="tool-btn" :class="{ spinning: refreshing }" @tap="onRefreshAll">⟳</view>
          <view class="tool-btn" :class="{ active: viewMode === 'list' }" @tap="toggleView">☰</view>
          <view class="tool-btn" :class="{ active: viewMode === 'grid' }" @tap="toggleViewGrid">◎</view>
          <view class="tool-btn" @tap="cycleTheme">{{ THEME_ICONS[theme] }}</view>
          <view class="tool-btn tool-btn-exit" @tap="onLogout">⏻</view>
        </view>
      </view>
      <scroll-view scroll-y class="board">
        <view v-for="acc in accounts" :key="acc.id" class="account">
          <view class="account-header">
            <image v-if="acc.logo" class="account-logo" :src="'/static/providers/' + acc.logo" mode="aspectFit" />
            <text class="account-title">{{ acc.service }}</text>
            <text v-if="acc.plan" class="account-tier">{{ acc.plan }}</text>
            <view
              class="account-refresh"
              :class="{ spinning: refreshingIds.has(acc.id) }"
              @tap.stop="onRefreshAccount(acc.id)"
            >⟳</view>
            <text class="account-sub">{{ acc.account }}</text>
          </view>
          <view :class="viewMode === 'grid' ? 'ring-row' : ''">
            <template v-if="viewMode === 'grid'">
              <QuotaRing v-for="(q, i) in acc.quotas" :key="i" :quota="q" :theme="resolvedTheme" />
            </template>
            <template v-else>
              <QuotaRow v-for="(q, i) in acc.quotas" :key="i" :quota="q" :theme="resolvedTheme" />
            </template>
          </view>
        </view>
      </scroll-view>
      <RecentFooter :rows="recentRows" :loaded="recentLoaded" />
    </view>
  </view>
</template>

<style>
page { height: 100%; overflow: hidden; background: #0f1a2e; }
.app-shell.theme-dark { --fg: #d6dde8; --bg: #0f1a2e; --desc: #8b96ac; --input: #17233d; --border: #24314f; --btn: #2f6fd6; --green: #4fd17a; --amber: #f0d264; --red: #ef5f5f; --badge-bg: #2f6fd6; --badge-fg: #ffffff; }
.app-shell.theme-light { --fg: #3b3b3b; --bg: #f0f0f2; --desc: #717171; --input: #ffffff; --border: #d8d8d8; --btn: #007acc; --green: #2e8b3d; --amber: #d4a72c; --red: #c0392b; --badge-bg: #e4e4e8; --badge-fg: #3b3b3b; }
.app-shell { display: flex; flex-direction: column; height: 100%; background: var(--bg, #0f1a2e); }
.status { padding: 24px; color: var(--desc, #8b96ac); text-align: center; }
.login-screen { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.login-card {
  width: 100%; max-width: 320px; padding: 28px 24px; border-radius: 16px;
  background: var(--input, #17233d); border: 1px solid var(--border, #24314f); box-sizing: border-box;
}
.login-logo {
  width: 44px; height: 44px; margin: 0 auto 14px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #f97815, #c2590a); color: #fff; font-size: 22px; font-weight: 700;
}
.login-title { display: block; font-size: 17px; font-weight: 700; text-align: center; color: var(--fg, #d6dde8); }
.login-subtitle { display: block; margin: 6px 0 22px; font-size: 12px; text-align: center; color: var(--desc, #8b96ac); }
.login-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.login-label { font-size: 12px; color: var(--desc, #8b96ac); }
.login-field input {
  background: var(--input, #17233d); color: var(--fg, #d6dde8); border: 1px solid var(--border, #24314f); border-radius: 8px;
  padding: 9px 12px; font-size: 13px; box-sizing: border-box;
}
.login-submit {
  width: 100%; margin-top: 4px; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600;
  background: var(--btn, #2f6fd6); color: #fff; border: none;
}
.login-error { display: block; margin-top: 10px; font-size: 12px; color: #f48771; text-align: center; }
.login-hint { display: block; margin: 16px 0 0; font-size: 11px; line-height: 1.5; text-align: center; color: var(--desc, #8b96ac); }
.ready { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.toolbar { display: flex; justify-content: space-between; align-items: center; padding: 8px 8px 6px; }
.toolbar-count { font-size: 11px; color: var(--desc, #8b96ac); }
.actions { display: flex; gap: 2px; align-items: center; }
.tool-btn {
  width: 22px; height: 22px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; color: var(--fg, #d6dde8);
}
.tool-btn.active { background: var(--input, #17233d); }
.tool-btn-exit { font-size: 16px; }
.tool-btn.spinning { animation: tool-spin 0.8s linear infinite; }
@keyframes tool-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.account-refresh {
  width: 18px; height: 18px; border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: var(--desc, #8b96ac);
}
.account-refresh.spinning { animation: tool-spin 0.8s linear infinite; }
.board { flex: 1; min-height: 0; }
.account { padding: 8px 4px 10px; border-bottom: 1px solid var(--border, #24314f); }
.account-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.account-logo { width: 16px; height: 16px; margin-right: 2px; border-radius: 3px; }
.account-title { font-size: 12px; font-weight: 600; color: var(--fg, #d6dde8); }
.account-tier {
  flex: none; background: var(--badge-bg, #2f6fd6); color: var(--badge-fg, #ffffff);
  border-radius: 8px; padding: 0 6px; font-size: 10px; line-height: 15px; font-weight: 600;
}
.account-sub { font-size: 10px; color: var(--desc, #8b96ac); margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
.ring-row { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
