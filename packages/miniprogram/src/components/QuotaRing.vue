<script setup lang="ts">
import { computed } from 'vue';
import { levelOf, remainingOf, amountText, timeUntil } from '@9router-quota/core';
import type { RenderedQuotaItem } from '../lib/formatAccount';

const props = defineProps<{ quota: RenderedQuotaItem }>();

const RING_RADIUS = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const remaining = computed(() => remainingOf(props.quota));
const amount = computed(() => amountText(props.quota));
const level = computed(() => (remaining.value != null ? levelOf(remaining.value) : amount.value != null ? 'green' : 'none'));
const percent = computed(() => Math.max(0, Math.min(100, remaining.value ?? (amount.value != null ? 100 : 0))));
const text = computed(() =>
  amount.value ?? (props.quota.unlimited && remaining.value == null ? '∞' : remaining.value != null ? `${remaining.value.toFixed(0)}%` : '—')
);
const offset = computed(() => RING_CIRCUMFERENCE * (1 - percent.value / 100));
const strokeColor = computed(() => ({ green: '#4fd17a', amber: '#f0d264', red: '#ef5f5f', none: 'transparent' }[level.value]));
</script>

<template>
  <view class="ring-card">
    <view class="ring">
      <!-- #ifdef MP-WEIXIN || MP-ALIPAY || MP-TOUTIAO -->
      <svg viewBox="0 0 52 52" width="52" height="52" style="transform: rotate(-90deg)">
        <circle cx="26" cy="26" :r="RING_RADIUS" fill="none" stroke="rgba(128,128,140,0.25)" stroke-width="4" />
        <circle
          cx="26" cy="26" :r="RING_RADIUS" fill="none" :stroke="strokeColor" stroke-width="4"
          stroke-linecap="round" :stroke-dasharray="RING_CIRCUMFERENCE" :stroke-dashoffset="offset"
        />
      </svg>
      <!-- #endif -->
      <text class="ring-text">{{ text }}</text>
    </view>
    <text class="ring-label">{{ quota.name }}</text>
    <text v-if="quota.resetAt" class="ring-meta">{{ timeUntil(quota.resetAt) }}</text>
  </view>
</template>

<style>
.ring-card { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 10px 6px 8px; border-radius: 10px; background: rgba(23, 35, 61, 0.55); border: 1px solid rgba(36, 49, 79, 0.7); }
.ring { position: relative; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; }
.ring-text { position: absolute; font-size: 11px; font-weight: 600; color: #d6dde8; }
.ring-label { font-size: 10px; text-align: center; color: #8b96ac; max-width: 72px; overflow: hidden; }
.ring-meta { font-size: 9px; text-align: center; color: #8b96ac; opacity: 0.75; }
</style>
