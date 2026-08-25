<script setup lang="ts">
import { computed } from 'vue';
import { levelOf, remainingOf, amountText, timeUntil, type RenderedQuotaItem } from '@9router-quota/core';

const props = defineProps<{ quota: RenderedQuotaItem; theme?: 'dark' | 'light' }>();

const remaining = computed(() => remainingOf(props.quota));
const amount = computed(() => amountText(props.quota));
const level = computed(() => (remaining.value != null ? levelOf(remaining.value) : amount.value != null ? 'green' : 'none'));
const percent = computed(() => Math.max(0, Math.min(100, remaining.value ?? (amount.value != null ? 100 : 0))));
const text = computed(() =>
  amount.value ?? (props.quota.unlimited && remaining.value == null ? '∞' : remaining.value != null ? `${remaining.value.toFixed(0)}%` : '—')
);

// 纯 CSS conic-gradient 环形（双层圆盘+挖洞）：canvas 是原生组件，在 scroll-view 里不跟随滚动会残影悬停。
const discStyle = computed(() => {
  const p = level.value === 'none' ? 0 : percent.value / 100;
  const dark = props.theme !== 'light';
  const color = {
    green: dark ? '#4fd17a' : '#2e8b3d',
    amber: dark ? '#f0d264' : '#d4a72c',
    red: dark ? '#ef5f5f' : '#c0392b',
    none: 'rgba(128,128,140,0.25)',
  }[level.value];
  return { background: `conic-gradient(${color} 0turn ${p}turn, rgba(128,128,140,0.25) ${p}turn 1turn)` };
});
</script>

<template>
  <view class="ring-card">
    <view class="ring">
      <view class="ring-disc" :style="discStyle" />
      <view class="ring-hole" />
      <text class="ring-text">{{ text }}</text>
    </view>
    <text v-if="quota.resetAt" class="ring-meta">{{ timeUntil(quota.resetAt) }}</text>
  </view>
</template>

<style>
.ring-card { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 10px 6px 8px; border-radius: 10px; background: var(--input, #17233d); border: 1px solid var(--border, #24314f); }
.ring { position: relative; width: 52px; height: 52px; }
.ring-disc { position: absolute; inset: 0; border-radius: 50%; }
.ring-hole { position: absolute; inset: 4px; border-radius: 50%; background: var(--input, #0f1a2e); }
.ring-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: var(--fg, #d6dde8); }
.ring-meta { font-size: 9px; text-align: center; color: var(--desc, #8b96ac); opacity: 0.75; }
</style>
