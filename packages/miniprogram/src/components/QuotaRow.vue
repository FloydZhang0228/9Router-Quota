<script setup lang="ts">
import { computed } from 'vue';
import { levelOf, remainingOf, amountText, timeUntil } from '@9router-quota/core';
import type { RenderedQuotaItem } from '../lib/formatAccount';

const props = defineProps<{ quota: RenderedQuotaItem }>();

const remaining = computed(() => remainingOf(props.quota));
const amount = computed(() => amountText(props.quota));
const level = computed(() => (remaining.value != null ? levelOf(remaining.value) : amount.value != null ? 'green' : 'none'));
const label = computed(() => amount.value ?? (remaining.value != null ? `${remaining.value.toFixed(0)}%` : null));
const percent = computed(() => Math.max(0, Math.min(100, remaining.value ?? (amount.value != null ? 100 : 0))));
const color = computed(() => ({ red: '#ef5f5f', amber: '#f0d264', green: '#4fd17a', none: '#4fd17a' }[level.value]));
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
.quota-pill { font-size: 11px; color: #d6dde8; min-width: 60px; }
.quota-track { flex: 1; height: 6px; border-radius: 3px; background: rgba(128, 128, 140, 0.25); overflow: hidden; }
.quota-track-fill { height: 100%; }
.quota-percent { font-size: 11px; color: #d6dde8; min-width: 36px; text-align: right; }
.quota-meta { font-size: 9px; color: #8b96ac; }
</style>
