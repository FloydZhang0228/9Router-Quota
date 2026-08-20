import type { Quota } from './types';

export function describeQuota(provider: string, quota: Quota): string {
  const unit = quota.unit ? ` ${quota.unit}` : '';
  const { used, total } = quota;
  const parts: string[] = [];

  if (used != null && total != null) parts.push(`已用 ${used} / ${total}${unit}`);
  else if (used != null) parts.push(`已用 ${used}${unit}`);
  else if (total != null) parts.push(`总量 ${total}${unit}`);

  if (quota.remainingPercentage != null) {
    parts.push(`剩余 ${quota.remainingPercentage}%`);
  } else if (quota.remaining != null) {
    const suffix = provider === 'codex' && !unit ? '%' : unit;
    parts.push(`剩余 ${quota.remaining}${suffix}`);
  } else if (typeof used === 'number' && typeof total === 'number' && total > 0) {
    const remainingPct = Math.max(0, Math.min(100, ((total - used) / total) * 100));
    parts.push(`剩余约 ${remainingPct.toFixed(0)}%`);
  }

  if (quota.resetAt) {
    const label = quota.recurring === false ? '到期时间' : '重置时间';
    parts.push(`${label} ${quota.resetAt}`);
  }

  // unlimited 只表示“无硬性次数上限”，仍可能带有余额等数值，优先展示数值。
  if (!parts.length) return quota.unlimited === true ? '无限' : '已获取，未返回数值';
  return parts.join('；');
}

/** 用于渲染进度条的已用百分比（0-100），无法计算时返回 null（含真正无数据的 unlimited）。 */
export function quotaPercentUsed(quota: Quota): number | null {
  if (quota.remainingPercentage != null) return Math.max(0, Math.min(100, 100 - quota.remainingPercentage));
  if (typeof quota.used === 'number' && typeof quota.total === 'number' && quota.total > 0) {
    return Math.max(0, Math.min(100, (quota.used / quota.total) * 100));
  }
  return null;
}
