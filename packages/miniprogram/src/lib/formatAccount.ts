import { describeProvider, describeQuota, providerLogo, quotaPercentUsed, type AccountQuota } from '@9router-quota/core';

export interface RenderedQuotaItem {
  name: string; description: string; percent: number | null;
  unlimited: boolean; resetAt?: string; used?: number; total?: number;
}
export interface RenderedAccount {
  id: string; service: string; account: string; plan?: string;
  logo: string | null; quotas: RenderedQuotaItem[];
}

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
  const plan =
    connection.provider === 'claude' || !usage.plan || usage.plan.toLowerCase() === service.toLowerCase()
      ? undefined
      : usage.plan;
  return { id: connection.id, service, account, plan, logo: providerLogo(connection.provider), quotas };
}
