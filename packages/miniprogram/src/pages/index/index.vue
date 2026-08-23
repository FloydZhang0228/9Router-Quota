<script setup lang="ts">
import { ref } from 'vue';
import { NineRouterClient } from '@9router-quota/core';
import { createUniRequestAdapter } from '../../lib/uniRequestAdapter';

const baseUrl = ref('');
const password = ref('');
const status = ref('');

async function diagnosticLogin() {
  status.value = '登录中…';
  const client = new NineRouterClient(baseUrl.value, 'manual', createUniRequestAdapter());
  try {
    await client.login(password.value);
    status.value = '登录成功——看控制台里 [uniRequestAdapter] response headers 那行，确认有没有 Set-Cookie 字段';
  } catch (e) {
    status.value = `登录失败：${(e as Error).message}（同样去看控制台的响应头日志）`;
  }
}
</script>

<template>
  <view class="diag">
    <input v-model="baseUrl" placeholder="9Router 地址，如 http://192.168.x.x:端口" />
    <input v-model="password" password placeholder="Dashboard 密码" />
    <button @tap="diagnosticLogin">诊断登录</button>
    <text>{{ status }}</text>
  </view>
</template>

<style>
.diag { display: flex; flex-direction: column; gap: 12px; padding: 24px; }
</style>
