<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import {
  NineRouterClient,
  formatAccount,
  groupFormattedByProvider,
  type AccountQuota,
  type RenderedAccount,
  type RequestAdapter,
} from '@9router-quota/core';
import { createUniRequestAdapter } from '../../lib/uniRequestAdapter';
import { saveSession, loadSession, clearSession } from '../../lib/session';
import { startPolling, type PolledLogRow } from '../../lib/recentLogsPoller';
import QuotaRing from '../../components/QuotaRing.vue';
import QuotaRow from '../../components/QuotaRow.vue';
import RecentFooter from '../../components/RecentFooter.vue';
import { APP_VERSION } from '../../version';

const REFRESH_INTERVAL_MS = 5 * 60_000; // 对齐 Chrome 端 REFRESH_INTERVAL_MIN = 5
const THEME_KEY = 'nineRouterQuota.theme';

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
const providerGroups = computed(() => groupFormattedByProvider(accounts.value));
let client: NineRouterClient | null = null;
let activeAdapter: RequestAdapter | null = null;
let stopPolling: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function startBackgroundTasks(url: string) {
  // 必须复用 doLogin 里的 adapter：它的闭包存着登录后的 cookie，
  // 字节端 tt.request 不自动带 cookie，新 adapter 会永远拿不到鉴权。
  stopPolling = startPolling(url, activeAdapter!, (rows) => {
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
  activeAdapter = createUniRequestAdapter();
  client = new NineRouterClient(url, 'manual', activeAdapter);
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
  activeAdapter = null;
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
uni.onThemeChange?.(onSysThemeChange as any);

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
          <input v-model="baseUrl" placeholder="http://9router.example.com" placeholder-class="login-ph" />
        </view>
        <view class="login-field">
          <text class="login-label">Dashboard密码</text>
          <input v-model="password" password />
        </view>
        <button class="login-submit" @tap="onSubmit">登录</button>
        <text v-if="status === 'error'" class="login-error">{{ errorMessage }}</text>
        <text class="login-hint">密码保存在小程序本地存储中，不会同步到云端。</text>
        <text class="login-version">v{{ APP_VERSION }}</text>
      </view>
    </view>
    <view v-else class="ready">
      <view class="toolbar">
        <text class="toolbar-count">{{ accounts.length }} 个账号</text>
        <view class="actions">
          <view class="tool-btn" :class="{ spinning: refreshing }" @tap="onRefreshAll"><view class="ti ti-refresh" /></view>
          <view class="tool-btn" :class="{ active: viewMode === 'list' }" @tap="toggleView"><view class="ti ti-list" /></view>
          <view class="tool-btn" :class="{ active: viewMode === 'grid' }" @tap="toggleViewGrid"><view class="ti ti-grid" /></view>
          <view class="tool-btn" @tap="cycleTheme"><view class="ti" :class="'ti-theme-' + theme" /></view>
          <view class="tool-btn" @tap="onLogout"><view class="ti ti-power" /></view>
        </view>
      </view>
      <scroll-view scroll-y class="board">
        <view v-for="group in providerGroups" :key="group.provider" class="account">
          <view class="account-header">
            <image v-if="group.logo" class="account-logo" :src="'/static/providers/' + group.logo" mode="aspectFit" />
            <text class="account-title">{{ group.service }}</text>
          </view>
          <!--
            一个provider下多个账号：每个账号自己一块，名字在上、圆环/进度条在下
            （跟单账号一张卡片时的位置一致）。圆环视图下account-groups是flex-wrap，
            一行放不放得下下一个账号看它整组圆环能不能塞进剩余宽度——放得下同行，
            放不下整体换到下一行，不会把一个账号的圆环拆到两行。
          -->
          <view class="account-groups" :class="{ 'ring-groups': viewMode === 'grid' }">
            <view v-for="acc in group.accounts" :key="acc.id" class="account-group">
              <view class="account-sub-header">
                <text class="account-name">{{ acc.account }}</text>
                <text v-if="acc.plan" class="account-tier">{{ acc.plan }}</text>
                <view
                  class="account-refresh"
                  :class="{ spinning: refreshingIds.has(acc.id) }"
                  @tap.stop="onRefreshAccount(acc.id)"
                ><view class="ti ti-refresh" /></view>
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
  width: 100%; padding: 28px 20px; border-radius: 16px;
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
  background: var(--bg, #0f1a2e); color: var(--fg, #d6dde8); border: 1px solid var(--border, #24314f); border-radius: 8px;
  /* 微信原生 input 不由字号撑高，必须显式给 height，否则内容区塌成 0 只剩 padding */
  height: 44px; line-height: 22px; padding: 0 12px; font-size: 14px; box-sizing: border-box; width: 100%;
}
.login-ph { color: var(--desc, #8b96ac); font-size: 14px; }
.login-submit {
  width: 100%; margin-top: 4px; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600;
  background: var(--btn, #2f6fd6); color: #fff; border: none;
}
.login-error { display: block; margin-top: 10px; font-size: 12px; color: #f48771; text-align: center; }
.login-hint { display: block; margin: 16px 0 0; font-size: 11px; line-height: 1.5; text-align: center; color: var(--desc, #8b96ac); }
.login-version { display: block; margin: 4px 0 0; font-size: 10px; text-align: center; color: var(--desc, #8b96ac); opacity: 0.7; }
.ready { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.toolbar { display: flex; justify-content: space-between; align-items: center; padding: 8px 8px 6px; }
.toolbar-count { font-size: 11px; color: var(--desc, #8b96ac); }
.actions { display: flex; gap: 2px; align-items: center; }
/* 工具栏图标彻底放弃 Unicode 字形（各平台字体墨迹比例/基线不可控，修了三次都不齐），
   改 SVG mask：路径与 core/src/icons.ts 同源（feather 风格，viewBox 0 0 24 24），
   wxml 不支持内联 svg，用 -webkit-mask 数据 URI 的 alpha 遮罩上色——
   颜色由 background-color 提供，跟随主题变量；改图标时两处同步。 */
.tool-btn {
  width: 22px; height: 22px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  color: var(--fg, #d6dde8);
}
.tool-btn.active { background: var(--input, #17233d); }
.ti {
  width: 14px; height: 14px;
  background-color: currentColor; /* mask 遮罩上色，颜色走按钮的 color */
  -webkit-mask-size: 100% 100%; -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;
}
.ti-refresh { -webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M23%204v6h-6%22%2F%3E%3Cpath%20d%3D%22M20.49%2015a9%209%200%201%201-2.12-9.36L23%2010%22%2F%3E%3C%2Fsvg%3E"); }
.ti-list { -webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M8%206h13%22%2F%3E%3Cpath%20d%3D%22M8%2012h13%22%2F%3E%3Cpath%20d%3D%22M8%2018h13%22%2F%3E%3Cpath%20d%3D%22M3%206h.01%22%2F%3E%3Cpath%20d%3D%22M3%2012h.01%22%2F%3E%3Cpath%20d%3D%22M3%2018h.01%22%2F%3E%3C%2Fsvg%3E"); }
.ti-grid { -webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%2212%22%20r%3D%229%22%2F%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%2212%22%20r%3D%222.5%22%20fill%3D%22black%22%20stroke%3D%22none%22%2F%3E%3C%2Fsvg%3E"); }
.ti-theme-system { -webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%2212%22%20r%3D%229%22%2F%3E%3Cpath%20d%3D%22M12%203a9%209%200%200%201%200%2018Z%22%20fill%3D%22black%22%20stroke%3D%22none%22%2F%3E%3C%2Fsvg%3E"); }
.ti-theme-dark { -webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M21%2012.79A9%209%200%201%201%2011.21%203a7%207%200%200%200%209.79%209.79z%22%2F%3E%3C%2Fsvg%3E"); }
.ti-theme-light { -webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%2212%22%20r%3D%225%22%2F%3E%3Cline%20x1%3D%2212%22%20y1%3D%221%22%20x2%3D%2212%22%20y2%3D%223%22%2F%3E%3Cline%20x1%3D%2212%22%20y1%3D%2221%22%20x2%3D%2212%22%20y2%3D%2223%22%2F%3E%3Cline%20x1%3D%224.22%22%20y1%3D%224.22%22%20x2%3D%225.64%22%20y2%3D%225.64%22%2F%3E%3Cline%20x1%3D%2218.36%22%20y1%3D%2218.36%22%20x2%3D%2219.78%22%20y2%3D%2219.78%22%2F%3E%3Cline%20x1%3D%221%22%20y1%3D%2212%22%20x2%3D%223%22%20y2%3D%2212%22%2F%3E%3Cline%20x1%3D%2221%22%20y1%3D%2212%22%20x2%3D%2223%22%20y2%3D%2212%22%2F%3E%3Cline%20x1%3D%224.22%22%20y1%3D%2219.78%22%20x2%3D%225.64%22%20y2%3D%2218.36%22%2F%3E%3Cline%20x1%3D%2218.36%22%20y1%3D%225.64%22%20x2%3D%2219.78%22%20y2%3D%224.22%22%2F%3E%3C%2Fsvg%3E"); }
.ti-power { -webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M18.36%206.64a9%209%200%201%201-12.73%200%22%2F%3E%3Cpath%20d%3D%22M12%202v10%22%2F%3E%3C%2Fsvg%3E"); }
.tool-btn.spinning { animation: tool-spin 0.8s linear infinite; }
@keyframes tool-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.account-refresh {
  width: 18px; height: 18px; border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  color: var(--desc, #8b96ac);
}
.account-refresh .ti { width: 11px; height: 11px; }
.account-refresh.spinning { animation: tool-spin 0.8s linear infinite; }
.board { flex: 1; min-height: 0; }
.account { padding: 8px 4px 10px; border-bottom: 1px solid var(--border, #24314f); }
.account-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.account-logo { width: 16px; height: 16px; margin-right: 2px; border-radius: 3px; }
.account-title { font-size: 12px; font-weight: 600; color: var(--fg, #d6dde8); }
.account-tier {
  flex: none; background: var(--badge-bg, #2f6fd6); color: var(--badge-fg, #ffffff);
  border-radius: 8px; padding: 0 6px; font-size: 10px; line-height: 15px; font-weight: 600;
}
/*
 * 一个provider卡片下多个账号：每个账号自己一块（名字在上、圆环/进度条在下）。
 * 列表视图纵向堆叠，账号间留白隔开；圆环视图(.ring-groups)用flex-wrap平铺——
 * 一行能放下整个下一个账号的圆环就放同一行，放不下就换行，不会把一个账号的
 * 圆环拆到两行。
 */
.account-group + .account-group { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border, #24314f); }
.ring-groups { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px 14px; }
.ring-groups .account-group { flex: none; max-width: 100%; margin-top: 0 !important; padding-top: 0 !important; border-top: none !important; }
.account-sub-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.account-name { font-size: 11px; font-weight: 600; color: var(--fg, #d6dde8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px; }
/* 圆环视图：同一账号的圆环排成一行，放不下的换到自己这块内部的下一行 */
.ring-row { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
