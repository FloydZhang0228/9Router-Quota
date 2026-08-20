import * as vscode from 'vscode';
import {
  NineRouterClient,
  describeProvider,
  describeQuota,
  quotaPercentUsed,
  type AccountQuota,
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

class QuotaViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private stopRecentStream?: () => void;

  constructor(private readonly extensionUri: vscode.Uri, private readonly secrets: vscode.SecretStorage) {}

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

  async refresh(): Promise<void> {
    if (!this.view) return;
    const baseUrl = getBaseUrl();
    const password = await this.secrets.get(SECRET_KEY);
    if (!baseUrl || !password) {
      this.view.webview.postMessage({ type: 'needLogin', baseUrl });
      return;
    }

    this.view.webview.postMessage({ type: 'loading' });
    try {
      const client = new NineRouterClient(baseUrl);
      await client.login(password);
      // 越早开越好：配额要挨个请求每个 provider，慢的话能拖好几秒，
      // “最近请求”页脚不该被它拖着一起等。
      this.ensureRecentStream(client);
      const accounts = await client.fetchAllQuotas();
      const rendered = accounts.map(formatAccount);
      this.view.webview.postMessage({ type: 'quota', accounts: rendered, updatedAt: Date.now() });
    } catch (err) {
      this.view.webview.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** “最近请求”走独立的 SSE 长连接实时推送，只需成功登录后开一次，不随每次手动刷新重连。 */
  private ensureRecentStream(client: NineRouterClient): void {
    if (this.stopRecentStream) return;
    this.stopRecentStream = client.openRecentRequestsStream((items) => {
      this.view?.webview.postMessage({ type: 'recentRequests', items: items.slice(0, 2) });
    });
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
      this.view.webview.postMessage({ type: 'quotaAccount', account: formatAccount({ connection, usage }) });
    } catch (err) {
      this.view.webview.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async logout(): Promise<void> {
    this.stopRecentStream?.();
    this.stopRecentStream = undefined;
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
  const provider = new QuotaViewProvider(context.extensionUri, context.secrets);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('9router-quota.view', provider));

  context.subscriptions.push(
    vscode.commands.registerCommand('9router-quota.open', () =>
      vscode.commands.executeCommand('workbench.view.extension.nineRouterQuota')
    ),
    vscode.commands.registerCommand('9router-quota.refresh', () => provider.refresh())
  );
}

export function deactivate(): void {}
