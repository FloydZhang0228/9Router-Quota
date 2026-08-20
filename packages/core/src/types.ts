export interface Connection {
  id: string;
  provider: string;
  email?: string;
  displayName?: string;
  name?: string;
}

export interface Quota {
  displayName?: string;
  name?: string;
  unlimited?: boolean;
  unit?: string;
  used?: number;
  total?: number;
  remainingPercentage?: number;
  remaining?: number;
  resetAt?: string;
  recurring?: boolean;
}

export interface Usage {
  plan?: string;
  quotas?: Record<string, Quota>;
}

export interface AccountQuota {
  connection: Connection;
  usage: Usage;
}

/** /api/usage/stream 推送的一条最近请求，timestamp 是真实 ISO 时间（可靠地算相对时间）。 */
export interface RecentRequest {
  timestamp: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  status: string;
}
