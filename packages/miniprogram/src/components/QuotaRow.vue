<script setup lang="ts">
import { computed } from 'vue';
import { levelOf, remainingOf, amountText, timeUntil, type RenderedQuotaItem } from '@9router-quota/core';

const props = defineProps<{ quota: RenderedQuotaItem; theme?: 'dark' | 'light' }>();

const remaining = computed(() => remainingOf(props.quota));
const amount = computed(() => amountText(props.quota));
const level = computed(() => (remaining.value != null ? levelOf(remaining.value) : amount.value != null ? 'green' : 'none'));
const label = computed(() => amount.value ?? (remaining.value != null ? `${remaining.value.toFixed(0)}%` : null));
const percent = computed(() => Math.max(0, Math.min(100, remaining.value ?? (amount.value != null ? 100 : 0))));
const color = computed(() => {
  const dark = props.theme !== 'light';
  return {
    red: dark ? '#ef5f5f' : '#c0392b',
    amber: dark ? '#f0d264' : '#d4a72c',
    green: dark ? '#4fd17a' : '#2e8b3d',
    none: dark ? '#4fd17a' : '#2e8b3d',
  }[level.value];
});
</script>

<template>
  <view class="quota-row">
    <text class="quota-pill">{{ quota.name }}</text>
    <text v-if="quota.unlimited && label == null" class="quota-percent">无限</text>
    <template v-else>
      <view class="quota-track">
        <view class="quota-track-fill" :style="{ width: percent + '%', background: color }" />
      </view>
      <text class="quota-percent">{{ label ?? '—' }}</text>
    </template>
    <text v-if="quota.resetAt" class="quota-meta">{{ timeUntil(quota.resetAt) }}</text>
  </view>
</template>

<style>
.quota-row { display: flex; align-items: center; gap: 8px; padding: 6px 4px; }
.quota-pill {
  flex: none; background: var(--badge-bg, #2f6fd6); color: var(--badge-fg, #ffffff);
  border-radius: 10px; padding: 1px 6px; font-size: 10px; white-space: nowrap;
  min-width: 0; max-width: 55%; overflow: hidden; text-overflow: ellipsis;
}
.quota-track { flex: 1; height: 6px; border-radius: 3px; background: rgba(128, 128, 140, 0.25); overflow: hidden; }
.quota-track-fill { height: 100%; }
.quota-percent { font-size: 11px; color: var(--fg, #d6dde8); min-width: 36px; text-align: right; }
.quota-meta { font-size: 9px; color: var(--desc, #8b96ac); }
</style>
