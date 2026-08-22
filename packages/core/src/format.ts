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

/* ------------------------------------------------------------------------ *
 * 以下是各端渲染都要用的展示层纯函数。原先 VSCode 的扩展主机（状态栏 tooltip）和
 * webview（面板）各抄了一份，加上浏览器扩展会变成第三份——同一个格式改一处漏两处。
 * 统一收在这里：扩展主机与 background 直接 import，webview/popup 由构建打进 bundle。
 * ------------------------------------------------------------------------ */

/** 渲染用的配额条目：已被各端 formatAccount 拍平过，不再是原始 Quota。 */
export interface RenderedQuota {
  percent: number | null;
  unlimited: boolean;
  used?: number;
  total?: number;
  resetAt?: string;
}

/** 已用百分比 -> 剩余百分比；无数值时返回 null（unlimited 但仍带数值的，如余额，照样换算）。 */
export function remainingOf(q: RenderedQuota): number | null {
  if (q.percent == null) return null;
  return Math.max(0, Math.min(100, 100 - q.percent));
}

/** 余额型配额（unlimited 但带 total）的剩余数字，整数直出、小数保留两位；不适用时 null。 */
export function amountText(q: RenderedQuota): string | null {
  if (!q.unlimited || !(typeof q.total === 'number' && q.total > 0)) return null;
  const remain = typeof q.used === 'number' ? Math.max(0, q.total - q.used) : q.total;
  return Number.isInteger(remain) ? String(remain) : remain.toFixed(2);
}

/** 按剩余百分比配色：>=70 绿、31-69 黄、<=30 红。 */
export function levelOf(remaining: number | null): 'green' | 'amber' | 'red' | 'none' {
  if (remaining == null) return 'none';
  if (remaining <= 30) return 'red';
  if (remaining < 70) return 'amber';
  return 'green';
}

/** 还剩多久重置，比绝对日期直观（"5h0m" 而不是 "08/21 15:52"）。 */
export function timeUntil(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Math.floor((d.getTime() - Date.now()) / 1000);
  if (diff <= 0) return '已重置';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

/** 相对时间。服务端/客户端时钟差几秒时最新一条会算出负数，夹到 0 而不是显示空白。 */
export function timeAgo(iso: string): string {
  const raw = (Date.now() - new Date(iso).getTime()) / 1000;
  const diff = Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
