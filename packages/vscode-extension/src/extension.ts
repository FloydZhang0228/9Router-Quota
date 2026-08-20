import * as vscode from 'vscode';
import { NineRouterClient, describeProvider, describeQuota, quotaPercentUsed } from '@9router-quota/core';

const SECRET_KEY = 'nineRouterQuota.password';

function getBaseUrl(): string {
  return vscode.workspace.getConfiguration().get<string>('9routerQuota.baseUrl', '').trim();
}

class QuotaViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri, private readonly secrets: vscode.SecretStorage) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
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
      const accounts = await client.fetchAllQuotas();
      const rendered = accounts.map(({ connection, usage }) => {
        const { service, company } = describeProvider(connection.provider);
        const account = connection.email || connection.displayName || connection.name || connection.id;
        const quotas = Object.entries(usage.quotas ?? {}).map(([key, quota]) => ({
          name: quota.displayName || quota.name || key,
          description: describeQuota(connection.provider, quota),
          percent: quotaPercentUsed(quota),
        }));
        return { service, company, account, plan: usage.plan, quotas };
      });
      this.view.webview.postMessage({ type: 'quota', accounts: rendered, updatedAt: Date.now() });
    } catch (err) {
      this.view.webview.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async logout(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
    await this.refresh();
  }

  private async handleMessage(message: { type: string; baseUrl?: string; password?: string }): Promise<void> {
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
      case 'logout':
        await this.logout();
        break;
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'app.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'style.css'));
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};" />
<link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new QuotaViewProvider(context.extensionUri, context.secrets);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('9router-quota.view', provider));

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(pulse) 9Router';
  statusBarItem.tooltip = '打开 9Router 配额面板';
  statusBarItem.command = '9router-quota.open';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('9router-quota.open', () =>
      vscode.commands.executeCommand('workbench.view.extension.nineRouterQuota')
    ),
    vscode.commands.registerCommand('9router-quota.refresh', () => provider.refresh())
  );
}

export function deactivate(): void {}
