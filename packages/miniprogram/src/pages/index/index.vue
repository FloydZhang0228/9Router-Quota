<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
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

const baseUrl = ref('');
const password = ref('');
const status = ref<'loading' | 'login' | 'ready' | 'error'>('loading');
const errorMessage = ref('');
const quotas = ref<AccountQuota[]>([]);
const accounts = ref<RenderedAccount[]>([]);
const viewMode = ref<'list' | 'grid'>('list');
const recentRows = ref<PolledLogRow[]>([]);
const recentLoaded = ref(false);
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
  viewMode.value = viewMode.value === 'list' ? 'grid' : 'list';
}

onMounted(async () => {
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
onUnmounted(() => stopBackgroundTasks());
</script>

<template>
  <view class="app-shell">
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
          <button class="action-btn" @tap="toggleView">{{ viewMode === 'list' ? '☰ 列表' : '◎ 网格' }}</button>
          <button class="action-btn" @tap="onLogout">⏻ 退出</button>
        </view>
      </view>
      <scroll-view scroll-y class="board">
        <view v-for="acc in accounts" :key="acc.id" class="account">
          <view class="account-header">
            <image v-if="acc.logo" class="account-logo" :src="'/static/providers/' + acc.logo" mode="aspectFit" />
            <text class="account-title">{{ acc.service }}</text>
            <text v-if="acc.plan" class="account-tier">{{ acc.plan }}</text>
            <text class="account-sub">{{ acc.account }}</text>
          </view>
          <view :class="viewMode === 'grid' ? 'ring-row' : ''">
            <template v-if="viewMode === 'grid'">
              <QuotaRing v-for="(q, i) in acc.quotas" :key="i" :quota="q" />
            </template>
            <template v-else>
              <QuotaRow v-for="(q, i) in acc.quotas" :key="i" :quota="q" />
            </template>
          </view>
        </view>
      </scroll-view>
      <RecentFooter :rows="recentRows" :loaded="recentLoaded" />
    </view>
  </view>
</template>

<style>
.app-shell { display: flex; flex-direction: column; height: 100%; background: #0f1a2e; }
.status { padding: 24px; color: #8b96ac; text-align: center; }
.login-screen { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.login-card {
  width: 100%; max-width: 320px; padding: 28px 24px; border-radius: 16px;
  background: rgba(23, 35, 61, 0.55); border: 1px solid rgba(36, 49, 79, 0.7); box-sizing: border-box;
}
.login-logo {
  width: 44px; height: 44px; margin: 0 auto 14px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #f97815, #c2590a); color: #fff; font-size: 22px; font-weight: 700;
}
.login-title { display: block; font-size: 17px; font-weight: 700; text-align: center; color: #d6dde8; }
.login-subtitle { display: block; margin: 6px 0 22px; font-size: 12px; text-align: center; color: #8b96ac; }
.login-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.login-label { font-size: 12px; color: #8b96ac; }
.login-field input {
  background: #17233d; color: #d6dde8; border: 1px solid #24314f; border-radius: 8px;
  padding: 9px 12px; font-size: 13px; box-sizing: border-box;
}
.login-submit {
  width: 100%; margin-top: 4px; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600;
  background: #2f6fd6; color: #fff; border: none;
}
.login-error { display: block; margin-top: 10px; font-size: 12px; color: #f48771; text-align: center; }
.login-hint { display: block; margin: 16px 0 0; font-size: 11px; line-height: 1.5; text-align: center; color: #8b96ac; }
.ready { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.toolbar { display: flex; justify-content: space-between; align-items: center; padding: 8px 8px 6px; }
.toolbar-count { font-size: 11px; color: #8b96ac; }
.actions { display: flex; gap: 6px; }
.action-btn {
  margin: 0; padding: 4px 10px; border-radius: 6px; font-size: 11px; line-height: 1.6;
  background: #24314f; color: #d6dde8; border: 1px solid #364a70;
}
.action-btn::after { border: none; }
.board { flex: 1; min-height: 0; }
.account { padding: 8px 4px 10px; border-bottom: 1px solid rgba(36, 49, 79, 0.4); }
.account-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.account-logo { width: 16px; height: 16px; margin-right: 2px; border-radius: 3px; }
.account-title { font-size: 12px; font-weight: 600; color: #d6dde8; }
.account-tier { font-size: 10px; color: #8b96ac; }
.account-sub { font-size: 10px; color: #8b96ac; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
.ring-row { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
