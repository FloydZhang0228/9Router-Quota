<script setup lang="ts">
import { computed, onMounted, watch, getCurrentInstance } from 'vue';
import { levelOf, remainingOf, amountText, timeUntil } from '@9router-quota/core';
import type { RenderedQuotaItem } from '../lib/formatAccount';

const props = defineProps<{ quota: RenderedQuotaItem; theme?: 'dark' | 'light' }>();

const RING_RADIUS = 22;

const remaining = computed(() => remainingOf(props.quota));
const amount = computed(() => amountText(props.quota));
const level = computed(() => (remaining.value != null ? levelOf(remaining.value) : amount.value != null ? 'green' : 'none'));
const percent = computed(() => Math.max(0, Math.min(100, remaining.value ?? (amount.value != null ? 100 : 0))));
const text = computed(() =>
  amount.value ?? (props.quota.unlimited && remaining.value == null ? '∞' : remaining.value != null ? `${remaining.value.toFixed(0)}%` : '—')
);
const strokeColor = computed(() => {
  const dark = props.theme !== 'light';
  return {
    green: dark ? '#4fd17a' : '#2e8b3d',
    amber: dark ? '#f0d264' : '#d4a72c',
    red: dark ? '#ef5f5f' : '#c0392b',
    none: 'transparent',
  }[level.value];
});

// canvas 2d 渲染层：WXML 不支持 <svg>，改用同口径的 canvas 弧线绘制。
let draw: (() => void) | null = null;

onMounted(() => {
  const instance = getCurrentInstance()?.proxy;
  uni.createSelectorQuery().in(instance).select('#ring-canvas').fields({ node: true, size: true }).exec((res: any) => {
    const canvas = res?.[0]?.node;
    if (!canvas) return; // 理论路径：拿不到节点则静默降级，环心文字仍显示
    const dpr = uni.getWindowInfo?.().pixelRatio ?? 2;
    canvas.width = 52 * dpr;
    canvas.height = 52 * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    draw = () => {
      ctx.clearRect(0, 0, 52, 52);
      const cx = 26, cy = 26, r = RING_RADIUS, sw = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(128,128,140,0.25)';
      ctx.lineWidth = sw;
      ctx.stroke();
      const p = percent.value;
      if (p > 0 && strokeColor.value !== 'transparent') {
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (p / 100));
        ctx.strokeStyle = strokeColor.value;
        ctx.lineWidth = sw;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    };
    draw();
  });
});

watch([percent, strokeColor], () => draw?.());
</script>

<template>
  <view class="ring-card">
    <view class="ring">
      <canvas type="2d" id="ring-canvas" class="ring-canvas" />
      <text class="ring-text">{{ text }}</text>
    </view>
    <text class="ring-label">{{ quota.name }}</text>
    <text v-if="quota.resetAt" class="ring-meta">{{ timeUntil(quota.resetAt) }}</text>
  </view>
</template>

<style>
.ring-card { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 10px 6px 8px; border-radius: 10px; background: var(--input, #17233d); border: 1px solid var(--border, #24314f); }
.ring { position: relative; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; }
.ring-canvas { width: 52px; height: 52px; }
.ring-text { position: absolute; font-size: 11px; font-weight: 600; color: var(--fg, #d6dde8); }
.ring-label { font-size: 10px; text-align: center; color: var(--desc, #8b96ac); max-width: 72px; overflow: hidden; }
.ring-meta { font-size: 9px; text-align: center; color: var(--desc, #8b96ac); opacity: 0.75; }
</style>
