import type { AccountQuota, Connection, RecentRequest, Usage } from './types';

export class LoginError extends Error {}

/**
 * 会话凭据的持有方式，各宿主不同：
 * - 'manual'（Node / VSCode 扩展主机）：自己从 set-cookie 里抠出会话串，逐次手动带上
 *   Cookie 请求头。Node 的 fetch 没有 cookie 罐，只能这样。
 * - 'container'（浏览器扩展 / WebView）：Cookie 与 set-cookie 都是 forbidden header，
 *   手动设了会被静默丢弃；凭据由浏览器自己收下并携带，我们只需 credentials: 'include'。
 */
export type AuthMode = 'manual' | 'container';

/**
 * 补全并归一化服务地址：允许用户只填主机名（默认按 http 处理，自建 9Router 多数没证书），
 * 已显式写 http:// 或 https:// 的原样保留，末尾斜杠去掉。
 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export class NineRouterClient {
  private baseUrl: string;
  private authMode: AuthMode;
  private cookie: string | null = null;

  constructor(baseUrl: string, authMode: AuthMode = 'manual') {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.authMode = authMode;
  }

  async login(password: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      ...this.credentials(),
    });
    if (!res.ok) throw new LoginError('登录失败，请检查地址和密码');
    if (this.authMode === 'container') return; // 凭据已由浏览器收下

    const cookies = (res.headers as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const raw = cookies[0] ?? res.headers.get('set-cookie');
    if (!raw) throw new LoginError('登录失败：服务未返回 Cookie');
    this.cookie = raw.split(';')[0];
  }

  /**
   * container 模式下让宿主自动带上凭据；manual 模式不需要（也无此概念）。
   * 返回值写成字面量类型而不是 DOM 的 RequestCredentials：core 的 lib 只有 ES2022，
   * 为一个类型名把整个 DOM lib 引进来不划算。
   */
  private credentials(): { credentials?: 'include' } {
    return this.authMode === 'container' ? { credentials: 'include' } : {};
  }

  private headers(): Record<string, string> {
    if (this.authMode === 'container') return {};
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
        { headers: this.headers(), ...this.credentials() }
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
        ...this.credentials(),
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
   *
   * 服务端首帧要在这条连接上现算一次全量历史聚合（量大时可能几十秒到一分钟以上），
   * 算失败时又会把异常吞掉、既不报错也不关闭连接，导致这条连接直接挂死、永远收不到
   * 任何字节。这里客户端自己兜底：多久没收到数据就判定这次连接失败，退避后重连；
   * 一旦真收到过数据就把退避重置，避免反复打这个本来就很慢的接口。
   * 返回值调用后彻底停止（包括取消排队中的重连）。
   */
  openRecentRequestsStream(onUpdate: (items: RecentRequest[]) => void): () => void {
    const IDLE_TIMEOUT_MS = 90_000; // 比观察到的正常首帧耗时（一分钟出头）留足余量，避免误杀慢但会成功的请求
    const MIN_RETRY_MS = 5_000;
    const MAX_RETRY_MS = 60_000;

    let stopped = false;
    let retryDelay = MIN_RETRY_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let abortCurrent: (() => void) | undefined;

    const connect = () => {
      if (stopped) return;
      const controller = new AbortController();
      abortCurrent = () => controller.abort();
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const bumpIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
      };

      (async () => {
        bumpIdleTimer();
        try {
          const res = await fetch(`${this.baseUrl}/api/usage/stream`, {
            headers: { ...this.headers(), Accept: 'text/event-stream' },
            signal: controller.signal,
            ...this.credentials(),
          });
          if (!res.ok || !res.body) throw new Error(`stream http ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bumpIdleTimer(); // 只要还在收字节（哪怕是心跳）就说明连接活着，不该被判超时
            buffer += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
              if (!dataLine) continue;
              try {
                const parsed = JSON.parse(dataLine.slice(6));
                if (Array.isArray(parsed.recentRequests)) {
                  onUpdate(parsed.recentRequests);
                  retryDelay = MIN_RETRY_MS;
                }
              } catch {
                // 忽略单帧解析失败，继续读下一帧
              }
            }
          }
        } catch {
          // 超时 abort / 网络错误 / 服务端非 200，统一走下面的重连
        } finally {
          clearTimeout(idleTimer);
        }
        if (!stopped) {
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
        }
      })();
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      abortCurrent?.();
    };
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
