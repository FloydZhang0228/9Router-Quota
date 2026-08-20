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
