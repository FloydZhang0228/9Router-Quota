import type { AccountQuota, Connection, Usage } from './types';

export class LoginError extends Error {}

export class NineRouterClient {
  private baseUrl: string;
  private cookie: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async login(password: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new LoginError('登录失败，请检查地址和密码');

    const cookies = (res.headers as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const raw = cookies[0] ?? res.headers.get('set-cookie');
    if (!raw) throw new LoginError('登录失败：服务未返回 Cookie');
    this.cookie = raw.split(';')[0];
  }

  private headers(): Record<string, string> {
    if (!this.cookie) throw new LoginError('尚未登录');
    return { Cookie: this.cookie };
  }

  async fetchConnections(): Promise<Connection[]> {
    const connections: Connection[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const res = await fetch(
        `${this.baseUrl}/api/providers/client?page=${page}&pageSize=500&accountStatus=all`,
        { headers: this.headers() }
      );
      const data = (await res.json()) as { connections?: Connection[]; pagination?: { totalPages?: number } };
      connections.push(...(data.connections ?? []));
      totalPages = data.pagination?.totalPages ?? 1;
      page++;
    } while (page <= totalPages);
    return connections;
  }

  async fetchUsage(connectionId: string): Promise<Usage | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/usage/${encodeURIComponent(connectionId)}?force=1`, {
        headers: this.headers(),
      });
      if (!res.ok) return null;
      return (await res.json()) as Usage;
    } catch {
      return null;
    }
  }

  /** 登录后一次拉齐全部账号的配额，跳过拉取失败或无配额数据的账号。 */
  async fetchAllQuotas(): Promise<AccountQuota[]> {
    const connections = await this.fetchConnections();
    const results = await Promise.all(
      connections
        .filter((c) => c.id)
        .map(async (connection): Promise<AccountQuota | null> => {
          const usage = await this.fetchUsage(connection.id);
          if (!usage?.quotas || !Object.keys(usage.quotas).length) return null;
          return { connection, usage };
        })
    );
    return results.filter((r): r is AccountQuota => r !== null);
  }
}
