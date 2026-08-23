<script setup lang="ts">
import type { PolledLogRow } from '../lib/recentLogsPoller';

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
  </view>
</template>

<style>
.recent-footer { border-top: 1px solid var(--border, #24314f); padding-top: 6px; margin-top: 6px; flex: none; }
.recent-row { display: flex; justify-content: space-between; font-size: 10px; color: var(--desc, #8b96ac); padding: 2px 0; }
.recent-loading { text-align: center; }
</style>
