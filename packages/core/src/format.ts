import type { AccountQuota, Quota } from './types';
import { describeProvider, providerLogo } from './providers';

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

  //unlimited只表示“无硬性次数上限”，仍可能带有余额等数值，优先展示数值。
  if (!parts.length) return quota.unlimited === true ? '无限' : '已获取，未返回数值';
  return parts.join('；');
}

/** 用于渲染进度条的已用百分比（0-100），无法计算时返回null（含真正无数据的unlimited）。 */
export function quotaPercentUsed(quota: Quota): number | null {
  if (quota.remainingPercentage != null) return Math.max(0, Math.min(100, 100 - quota.remainingPercentage));
  if (typeof quota.used === 'number' && typeof quota.total === 'number' && quota.total > 0) {
    return Math.max(0, Math.min(100, (quota.used / quota.total) * 100));
  }
  return null;
}

/* ------------------------------------------------------------------------ *
 * 以下是各端渲染都要用的展示层纯函数。原先VSCode的扩展主机（状态栏tooltip）和
 * webview（面板）各抄了一份，加上浏览器扩展会变成第三份——同一个格式改一处漏两处。
 * 统一收在这里：扩展主机与background直接import，webview/popup由构建打进bundle。
 * ------------------------------------------------------------------------ */

/** 渲染用的配额条目：已被各端formatAccount拍平过，不再是原始Quota。 */
export interface RenderedQuota {
  percent: number | null;
  unlimited: boolean;
  used?: number;
  total?: number;
  resetAt?: string;
}

export interface RenderedQuotaItem extends RenderedQuota {
  name: string;
  description: string;
}

/** 一个account格式化后的渲染数据；provider是id（分组键），service是展示名。 */
export interface RenderedAccount {
  id: string;
  provider: string;
  service: string;
  account: string;
  plan?: string;
  logo: string | null;
  quotas: RenderedQuotaItem[];
}

/**
 * AccountQuota -> RenderedAccount。原先浏览器扩展background、VSCode扩展主机、
 * 小程序各抄了一份（同一个格式改一处漏两处），统一收在这里。
 */
export function formatAccount({ connection, usage }: AccountQuota): RenderedAccount {
  const { service } = describeProvider(connection.provider);
  const account = connection.email || connection.displayName || connection.name || connection.id;
  const quotas = Object.entries(usage.quotas ?? {}).map(([key, quota]) => ({
    name: quota.displayName || quota.name || key,
    description: describeQuota(connection.provider, quota),
    percent: quotaPercentUsed(quota),
    unlimited: quota.unlimited === true,
    resetAt: quota.resetAt,
    used: quota.used,
    total: quota.total,
  }));
  //两类假plan都过滤掉：①Claude消费者OAuth通道服务端写死成字符串"Claude Code"；
  //②部分账号拿不到真实订阅档位时，服务端回退成跟服务名一样的占位字符串，原样
  //展示只是把服务名重复一遍，不如不显示。
  const plan =
    connection.provider === 'claude' || !usage.plan || usage.plan.toLowerCase() === service.toLowerCase()
      ? undefined
      : usage.plan;
  return { id: connection.id, provider: connection.provider, service, account, plan, logo: providerLogo(connection.provider), quotas };
}

export interface RenderedProviderGroup {
  provider: string;
  service: string;
  logo: string | null;
  accounts: RenderedAccount[];
}

/**
 * 按provider id把已格式化的账号分组，同provider多账号进同一组；组顺序=各provider
 * 首次出现的顺序。扩展的popup/webview拿到的是host端已formatAccount过的扁平数组，
 * 直接用这个分组；小程序端自己在本地formatAccount，用下面的groupByProvider一步到位。
 */
export function groupFormattedByProvider(accounts: RenderedAccount[]): RenderedProviderGroup[] {
  const groups: RenderedProviderGroup[] = [];
  const byProvider = new Map<string, RenderedProviderGroup>();
  for (const rendered of accounts) {
    let group = byProvider.get(rendered.provider);
    if (!group) {
      group = { provider: rendered.provider, service: rendered.service, logo: rendered.logo, accounts: [] };
      byProvider.set(rendered.provider, group);
      groups.push(group);
    }
    group.accounts.push(rendered);
  }
  return groups;
}

/** AccountQuota原始列表 -> 分组，formatAccount + groupFormattedByProvider的组合。 */
export function groupByProvider(accounts: AccountQuota[]): RenderedProviderGroup[] {
  return groupFormattedByProvider(accounts.map(formatAccount));
}

/** 已用百分比 -> 剩余百分比；无数值时返回null（unlimited但仍带数值的，如余额，照样换算）。 */
export function remainingOf(q: RenderedQuota): number | null {
  if (q.percent == null) return null;
  return Math.max(0, Math.min(100, 100 - q.percent));
}

/** 余额型配额（unlimited但带total）的剩余数字，整数直出、小数保留两位；不适用时null。 */
export function amountText(q: RenderedQuota): string | null {
  if (!q.unlimited || !(typeof q.total === 'number' && q.total > 0)) return null;
  const remain = typeof q.used === 'number' ? Math.max(0, q.total - q.used) : q.total;
  return Number.isInteger(remain) ? String(remain) : remain.toFixed(2);
}

/** 按剩余百分比配色：>=70绿、31-69黄、<=30红。 */
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

/** 相对时间。服务端/客户端时钟差几秒时最新一条会算出负数，夹到0而不是显示空白。 */
export function timeAgo(iso: string): string {
  const raw = (Date.now() - new Date(iso).getTime()) / 1000;
  const diff = Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
