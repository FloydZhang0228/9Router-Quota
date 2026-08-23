<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NineRouterClient, type AccountQuota } from '@9router-quota/core';
import { createUniRequestAdapter } from '../../lib/uniRequestAdapter';
import { saveSession, loadSession, clearSession } from '../../lib/session';

const baseUrl = ref('');
const password = ref('');
const status = ref<'loading' | 'login' | 'ready' | 'error'>('loading');
const errorMessage = ref('');
const quotas = ref<AccountQuota[]>([]);
let client: NineRouterClient | null = null;

async function doLogin(url: string, pw: string) {
  client = new NineRouterClient(url, 'manual', createUniRequestAdapter());
  await client.login(pw);
  quotas.value = await client.fetchAllQuotas();
  saveSession({ baseUrl: url, password: pw });
  status.value = 'ready';
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
  clearSession();
  client = null;
  quotas.value = [];
  status.value = 'login';
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
    <view v-else class="ready-screen">
      <text class="status">已登录，{{ quotas.length }} 个账号（配额展示见 Task 8）</text>
      <button class="logout-btn" @tap="onLogout">退出登录</button>
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
.ready-screen { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.logout-btn {
  width: 180px; padding: 9px; border-radius: 8px; font-size: 13px;
  background: #24314f; color: #d6dde8; border: 1px solid #364a70;
}
</style>
