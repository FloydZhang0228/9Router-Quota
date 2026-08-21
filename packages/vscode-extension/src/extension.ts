import * as vscode from 'vscode';
import {
  NineRouterClient,
  describeProvider,
  describeQuota,
  quotaPercentUsed,
  type AccountQuota,
  type RecentRequest,
} from '@9router-quota/core';

const SECRET_KEY = 'nineRouterQuota.password';

function getBaseUrl(): string {
  return vscode.workspace.getConfiguration().get<string>('9routerQuota.baseUrl', '').trim();
}

function formatAccount({ connection, usage }: AccountQuota) {
  const { service, company } = describeProvider(connection.provider);
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
  // Claude 消费者 OAuth 通道的 plan 字段服务端写死成 "Claude Code"，不是真实档位（分不出 Pro/Max），
  // 展示出来纯属误导，直接不显示；9Router 的 usage API 目前也没有暴露真实档位数据。
  const plan = connection.provider === 'claude' ? undefined : usage.plan;
  return { id: connection.id, provider: connection.provider, service, company, account, plan, quotas };
}

type RenderedAccount = ReturnType<typeof formatAccount>;
type RenderedQuota = RenderedAccount['quotas'][number];

// 下面这三个纯函数是 media/app.js 里同名逻辑的翻版：状态栏 tooltip 在扩展主机（Node）里拼，
// 面板本体在 webview（浏览器）里拼，两边运行时不共享代码，只能各写一份，保持逻辑一致即可。
function remainingOf(q: RenderedQuota): number | null {
  if (q.percent == null) return null;
  return Math.max(0, Math.min(100, 100 - q.percent));
}
function amountText(q: RenderedQuota): string | null {
  if (!q.unlimited || !(typeof q.total === 'number' && q.total > 0)) return null;
  const remain = typeof q.used === 'number' ? Math.max(0, q.total - q.used) : q.total;
  return Number.isInteger(remain) ? String(remain) : remain.toFixed(2);
}
function asciiBar(remainingPercent: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((remainingPercent / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
/** 还剩多久重置，跟 media/app.js 里同名函数保持一致的格式（"5h0m 后"）。 */
function timeUntil(iso?: string): string {
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

function escapeMd(text: string): string {
  return text.replace(/[*_`[\]\\]/g, '\\$&');
}

/** 状态栏悬浮卡片：每个账号一段，每条配额一行「进度条 + 百分比/余额」，不带按钮，纯只读。 */
function buildTooltip(accounts: RenderedAccount[]): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportThemeIcons = true;
  if (!accounts.length) {
    md.appendMarkdown('_尚未获取到账号配额_');
    return md;
  }
  accounts.forEach((acc, i) => {
    if (i > 0) md.appendMarkdown('\n\n---\n\n');
    const sub = [acc.account, acc.plan].filter((s): s is string => Boolean(s)).map(escapeMd).join(' · ');
    md.appendMarkdown(`**${escapeMd(acc.service)}**${sub ? `  ${sub}` : ''}\n\n`);
    for (const q of acc.quotas) {
      const remaining = remainingOf(q);
      const amount = amountText(q);
      const label = amount ?? (remaining != null ? `${remaining.toFixed(0)}%` : '—');
      const bar = asciiBar(remaining ?? (amount != null ? 100 : 0));
      const reset = timeUntil(q.resetAt);
      md.appendMarkdown(`${escapeMd(q.name)}  \`[${bar}]\` ${label}${reset ? `  ↻ ${reset}` : ''}\n\n`);
    }
  });
  return md;
}

class QuotaViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private stopRecentStream?: () => void;
  private lastRendered: RenderedAccount[] = [];
  // SSE 连接可能在 webview 还没打开之前就先开了（状态栏 tooltip 那次早刷新），推送的数据不能
  // 只指着 postMessage 单发一次——那次很可能因为 this.view 还是 undefined 直接被丢掉。
  // 缓存住，等真有 webview 了（或者 webview 报 ready）主动补发一次。
  private lastLogs: RecentRequest[] = [];
  private logsLoaded = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly secrets: vscode.SecretStorage,
    private readonly onAccountsChange?: (accounts: RenderedAccount[]) => void
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    webviewView.onDidDispose(() => {
      this.stopRecentStream?.();
      this.stopRecentStream = undefined;
    });
    this.refresh();
  }

  /**
   * 有没有面板都能跑：状态栏 tooltip 不该依赖用户先手动点开侧边栏才有数据，
   * 所以这里不再要求 this.view 存在，只在真有面板时才顺手 postMessage 过去。
   */
  async refresh(): Promise<void> {
    const baseUrl = getBaseUrl();
    const password = await this.secrets.get(SECRET_KEY);
    if (!baseUrl || !password) {
      this.view?.webview.postMessage({ type: 'needLogin', baseUrl });
      return;
    }

    this.view?.webview.postMessage({ type: 'loading' });
    try {
      const client = new NineRouterClient(baseUrl);
      await client.login(password);
      // 越早开越好：配额要挨个请求每个 provider，慢的话能拖好几秒，
      // “最近请求”页脚不该被它拖着一起等。
      this.ensureRecentStream(client);
      const accounts = await client.fetchAllQuotas();
      const rendered = accounts.map(formatAccount);
      this.lastRendered = rendered;
      this.onAccountsChange?.(rendered);
      this.view?.webview.postMessage({ type: 'quota', accounts: rendered, updatedAt: Date.now() });
    } catch (err) {
      this.view?.webview.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** “最近请求”走独立的 SSE 长连接实时推送，只需成功登录后开一次，不随每次手动刷新重连。 */
  private ensureRecentStream(client: NineRouterClient): void {
    if (this.stopRecentStream) return;
    this.stopRecentStream = client.openRecentRequestsStream((items) => {
      this.lastLogs = items.slice(0, 2);
      this.logsLoaded = true;
      this.view?.webview.postMessage({ type: 'recentRequests', items: this.lastLogs });
    });
  }

  /** webview 刚起来时补发一次缓存的最近请求，不用干等下一次 SSE 推送才有数据。 */
  private pushCachedLogs(): void {
    if (this.logsLoaded) {
      this.view?.webview.postMessage({ type: 'recentRequests', items: this.lastLogs });
    }
  }

  async refreshAccount(connectionId: string): Promise<void> {
    if (!this.view) return;
    const baseUrl = getBaseUrl();
    const password = await this.secrets.get(SECRET_KEY);
    if (!baseUrl || !password) return;
    try {
      const client = new NineRouterClient(baseUrl);
      await client.login(password);
      const connection = (await client.fetchConnections()).find((c) => c.id === connectionId);
      const usage = connection && (await client.fetchUsage(connectionId));
      if (!connection || !usage?.quotas || !Object.keys(usage.quotas).length) return;
      const account = formatAccount({ connection, usage });
      const idx = this.lastRendered.findIndex((a) => a.id === account.id);
      if (idx >= 0) this.lastRendered[idx] = account;
      else this.lastRendered.push(account);
      this.onAccountsChange?.(this.lastRendered);
      this.view.webview.postMessage({ type: 'quotaAccount', account });
    } catch (err) {
      this.view.webview.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async logout(): Promise<void> {
    this.stopRecentStream?.();
    this.stopRecentStream = undefined;
    this.lastRendered = [];
    this.onAccountsChange?.(this.lastRendered);
    this.lastLogs = [];
    this.logsLoaded = false;
    await this.secrets.delete(SECRET_KEY);
    await this.refresh();
  }

  private async handleMessage(message: {
    type: string;
    baseUrl?: string;
    password?: string;
    connectionId?: string;
  }): Promise<void> {
    switch (message.type) {
      case 'login':
        await vscode.workspace
          .getConfiguration()
          .update('9routerQuota.baseUrl', message.baseUrl, vscode.ConfigurationTarget.Global);
        await this.secrets.store(SECRET_KEY, message.password ?? '');
        await this.refresh();
        break;
      case 'refresh':
        await this.refresh();
        break;
      case 'refreshAccount':
        if (message.connectionId) await this.refreshAccount(message.connectionId);
        break;
      case 'logout':
        await this.logout();
        break;
      case 'ready':
        // webview 脚本刚跑起来时来报个到：resolveWebviewView 里那次 refresh() 可能因为
        // 时序问题（iframe 还没就绪就 postMessage）被吞掉，这里再兜底发一次，不会白屏。
        this.pushCachedLogs();
        await this.refresh();
        break;
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'app.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'style.css'));
    const mediaUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media'));
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource}; img-src ${webview.cspSource};" />
<link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root" data-media="${mediaUri}"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  // 状态栏常驻图标：本身不承载交互（点一下只是跳到侧边栏），真正的信息在悬浮 tooltip 里，
  // 类似 Copilot 状态栏那张卡片——但公开 API 只给到 MarkdownString，没有按钮/进度条控件，
  // 用等宽代码块拼 █░ 字符充当进度条。
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.name = '9Router Quota';
  statusBarItem.text = '𝟗𝐑'; // 数学粗体字形：比全角更紧凑（正常字宽，不带全角的方块间距），比 ASCII 更粗更显眼
  statusBarItem.command = '9router-quota.open';
  statusBarItem.tooltip = buildTooltip([]);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const provider = new QuotaViewProvider(context.extensionUri, context.secrets, (accounts) => {
    statusBarItem.tooltip = buildTooltip(accounts);
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('9router-quota.view', provider));

  // 状态栏 tooltip 得自己有数据来源，不能靠用户先点开侧边栏才触发；顺手加个定时刷新，
  // 保持"Live"——但周期别太短，配额接口要挨个打每个 provider，没必要天天扰民。
  provider.refresh();
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const refreshTimer = setInterval(() => provider.refresh(), REFRESH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });

  context.subscriptions.push(
    vscode.commands.registerCommand('9router-quota.open', () =>
      vscode.commands.executeCommand('workbench.view.extension.nineRouterQuota')
    ),
    vscode.commands.registerCommand('9router-quota.refresh', () => provider.refresh())
  );
}

export function deactivate(): void {}
