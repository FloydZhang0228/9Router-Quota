import type { RequestAdapter } from '@9router-quota/core';

export interface PolledLogRow {
  displayTime: string;
  model: string;
  provider: string;
  account: string;
  promptTokens: string;
  completionTokens: string;
  status: string;
}

/** 解析 /api/usage/logs 返回的一行："HH:mm:ss | model | PROVIDER | account | prompt | completion | status" */
export function parseLogLine(line: string): PolledLogRow | null {
  const parts = line.split(' | ');
  if (parts.length !== 7) return null;
  const [displayTime, model, provider, account, promptTokens, completionTokens, status] = parts;
  return { displayTime, model, provider, account, promptTokens, completionTokens, status };
}

/**
 * 轮询 /api/usage/logs，只取前2条对齐现有两端 footerRows 的展示数量。
 * 返回一个停止函数；调用方在页面 onHide 时调用它暂停轮询。
 */
export function startPolling(
  baseUrl: string,
  adapter: RequestAdapter,
  onUpdate: (rows: PolledLogRow[]) => void,
  intervalMs = 12_000
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const res = await adapter(`${baseUrl}/api/usage/logs`);
      if (res.ok) {
        const lines = (await res.json()) as string[];
        const rows = lines.map(parseLogLine).filter((r): r is PolledLogRow => r !== null).slice(0, 2);
        onUpdate(rows);
      }
    } catch {
      // 单次轮询失败不影响下一轮，跟现有 fetchUsage 的静默失败处理保持同一风格
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
