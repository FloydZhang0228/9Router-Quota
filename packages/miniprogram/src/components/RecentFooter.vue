<script setup lang="ts">
import type { PolledLogRow } from '../lib/recentLogsPoller';
import { APP_VERSION } from '../version';

defineProps<{ rows: PolledLogRow[]; loaded: boolean }>();
</script>

<template>
  <view class="recent-footer">
    <view v-if="!loaded" class="recent-row recent-loading">加载中…</view>
    <view v-for="(row, i) in rows" :key="i" class="recent-row">
      <text class="recent-model">{{ row.model }}</text>
      <text class="recent-tokens">{{ row.promptTokens }}↑ {{ row.completionTokens }}↓</text>
      <text class="recent-time">{{ row.displayTime }}</text>
    </view>
    <view class="footer-version">v{{ APP_VERSION }}</view>
  </view>
</template>

<style>
/* 底部内边距吃掉 iPhone home indicator 安全区，否则最后一行请求被横条压住看不见；
   左右 4px 对齐 .account 的内边距 */
.recent-footer {
  border-top: 1px solid var(--border, #24314f); margin-top: 6px; flex: none;
  padding: 6px 4px calc(env(safe-area-inset-bottom) + 6px);
}
.footer-version { margin-top: 4px; font-size: 10px; text-align: center; color: var(--desc, #8b96ac); opacity: 0.7; }
.recent-row { display: flex; justify-content: space-between; font-size: 10px; color: var(--desc, #8b96ac); padding: 2px 0; }
.recent-loading { text-align: center; }
</style>
