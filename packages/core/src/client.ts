import type { AccountQuota, Connection, RecentRequest, Usage } from './types';

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

  /**
   * 打开 /api/usage/stream 长连接，每次服务端推送就把 recentRequests 喂给 onUpdate。
   * 这是 9Router 网页仪表盘自己获取“最近请求”的唯一途径（没有对应的一次性 REST 接口）。
   * 返回值调用后关闭连接。
   */
  openRecentRequestsStream(onUpdate: (items: RecentRequest[]) => void): () => void {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/api/usage/stream`, {
          headers: { ...this.headers(), Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            try {
              const parsed = JSON.parse(dataLine.slice(6));
              if (Array.isArray(parsed.recentRequests)) onUpdate(parsed.recentRequests);
            } catch {
              // 忽略单帧解析失败，继续读下一帧
            }
          }
        }
      } catch {
        // 连接被 abort 或网络中断，静默结束
      }
    })();
    return () => controller.abort();
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
