import * as vscode from 'vscode';
import {
  NineRouterClient,
  amountText,
  describeProvider,
  describeQuota,
  providerLogo,
  quotaPercentUsed,
  remainingOf,
  timeUntil,
  type AccountQuota,
  type RecentRequest,
} from '@9router-quota/core';

const SECRET_KEY = 'nineRouterQuota.password';

function getBaseUrl(): string {
  return vscode.workspace.getConfiguration().get<string>('9routerQuota.baseUrl', '').trim();
}

function formatAccount({ connection, usage }: AccountQuota) {
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
  // 两类假 plan 都过滤掉：① Claude 消费者 OAuth 通道服务端写死成字符串 "Claude Code"；
  // ② Antigravity 等账号在拿不到真实订阅档位时，服务端回退成跟服务名一样的占位字符串
  // （比如 plan 就是 "Antigravity"），不是没取到 Plus/Pro，是上游确实没有这个数据、
  // 给了个没有信息量的兜底值——原样展示只是把服务名重复一遍，不如不显示。
  const plan =
    connection.provider === 'claude' || !usage.plan || usage.plan.toLowerCase() === service.toLowerCase()
      ? undefined
      : usage.plan;
  // logo 文件名在这边按 PROVIDERS 表算好一起下发，webview 就不用再维护一份
  // "哪些 provider 有图"的清单（那份手抄的 Set 跟 PROVIDERS 表两处都得改，漏一处就掉图）。
  return { id: connection.id, service, account, plan, logo: providerLogo(connection.provider), quotas };
}

type RenderedAccount = ReturnType<typeof formatAccount>;

/** 状态栏 tooltip 专用：Markdown 里画不了进度条，用方块字符凑一个。 */
function asciiBar(remainingPercent: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((remainingPercent / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
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
  private lastUpdatedAt = 0;
  // SSE 连接可能在 webview 还没打开之前就先开了（状态栏 tooltip 那次早刷新），推送的数据不能
  // 只指着 postMessage 单发一次——那次很可能因为 this.view 还是 undefined 直接被丢掉。
  // 缓存住，等真有 webview 了（或者 webview 报 ready）主动补发一次。
  private lastLogs: RecentRequest[] = [];
  private logsLoaded = false;
  // 启动时 activate / resolveWebviewView / webview ready 三处几乎同时调 refresh()，
  // 并发打上游配额接口容易被限流，慢的那次拿到的残缺列表（部分账号拉取失败被过滤）
  // 可能后到并覆盖完整列表——表现为“只显示几个账号，手动刷新才恢复”。
  // refreshSeq 保证只有最新一次发起的响应才有资格渲染。
  private refreshSeq = 0;
  private refreshDebounce?: ReturnType<typeof setTimeout>;

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
    // webview 被销毁重建（retainContextWhenHidden 只是尽力保留，不是保证）时这里重跑。
    // 已有数据先补发一帧，侧栏立即有画面；webview 侧的 state 恢复是第二重保险，
    // 两边谁先到都不闪"加载中…"。
    if (this.lastRendered.length) {
      webviewView.webview.postMessage({ type: 'quota', accounts: this.lastRendered, updatedAt: this.lastUpdatedAt ?? 0 });
    }
    this.pushCachedLogs();
    this.requestRefresh();
  }

  /**
   * 插件启动时 activate() / resolveWebviewView() / webview「ready」三处会在几百毫秒内
   * 各触发一次刷新意图——不去抖的话就是三个并发 refresh() 同时打上游，互相抢限流，
   * 谁最后跑完就用谁的（可能是被限流出来的残缺列表）覆盖显示，正是“账号显示不全，
   * 手动刷新才恢复”的成因。这里把这类隐式触发合并成一次；用户主动点刷新/提交登录
   * 不走这条路径，仍然立即执行。
   */
  requestRefresh(): void {
    clearTimeout(this.refreshDebounce);
    this.refreshDebounce = setTimeout(() => this.refresh(), 300);
  }

  /**
   * 有没有面板都能跑：状态栏 tooltip 不该依赖用户先手动点开侧边栏才有数据，
   * 所以这里不再要求 this.view 存在，只在真有面板时才顺手 postMessage 过去。
   */
  async refresh(reconnectStream = false): Promise<void> {
    const seq = ++this.refreshSeq;
    const baseUrl = getBaseUrl();
    const password = await this.secrets.get(SECRET_KEY);
    if (!baseUrl || !password) {
      this.view?.webview.postMessage({ type: 'needLogin', baseUrl });
      return;
    }

    // 只有首屏（还没任何数据）才整页显示"加载中"。已有数据时刷新沿用单账号刷新的做法：
    // 保留当前画面，靠工具栏按钮转圈表示正在刷新，数据回来再整体替换——否则每 5 分钟的
    // 定时刷新和手动刷新都会把面板清空好几秒。
    if (!this.lastRendered.length) this.view?.webview.postMessage({ type: 'loading' });
    try {
      const client = new NineRouterClient(baseUrl);
      await client.login(password);
      // 越早开越好：配额要挨个请求每个 provider，慢的话能拖好几秒，
      // “最近请求”页脚不该被它拖着一起等。
      // 用户主动点"刷新全部"时连底部"最近请求"一起刷：那条 SSE 只在首次登录时开一次，
      // 万一它挂死或正卡在重连退避里，页脚就会一直停在旧数据上——手动刷新就是用户在说
      // "给我最新的"，这时候重开一条。首帧可能慢，期间页脚保留旧内容而不是清空。
      if (reconnectStream) {
        this.stopRecentStream?.();
        this.stopRecentStream = undefined;
      }
      this.ensureRecentStream(client);
      const accounts = await client.fetchAllQuotas();
      if (seq !== this.refreshSeq) return; // 已有更新的刷新在跑，丢弃这次过期结果
      const rendered = accounts.map(formatAccount);
      this.lastRendered = rendered;
      this.lastUpdatedAt = Date.now();
      this.onAccountsChange?.(rendered);
      this.view?.webview.postMessage({ type: 'quota', accounts: rendered, updatedAt: Date.now() });
    } catch (err) {
      if (seq !== this.refreshSeq) return;
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
    this.lastUpdatedAt = 0;
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
        await this.refresh(true);
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
        this.requestRefresh();
        break;
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    // Webview 会长期缓存同一路径的 JS/CSS，retainContextWhenHidden 又让旧 iframe 常驻；开发中修改
    // 文件后经常出现“新 CSS + 旧 JS”混用（变量名对不上，进度条 width 回退 auto 撑满整条）。
    // 扩展每次激活生成一次缓存戳，强制当前进程加载同一版本的两份资源。
    const cacheBust = Date.now().toString();
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'app.js'))
      .with({ query: `v=${cacheBust}` });
    const styleUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'style.css'))
      .with({ query: `v=${cacheBust}` });
    // 全工程图片只有 images/ 这一处（含 providers logo、扩展图标、README 截图）。
    const imagesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'images'));
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<!-- style-src 必须带 'unsafe-inline'：进度条长度/颜色是逐条算出来的内联 style 属性，
     没有它整条 CSP 会静默丢弃，进度条只剩空轨道。style 属性无法用 nonce 放行。
     default-src/img-src 仍锁死在 cspSource，CSS 里 url() 之类的外发依然进不去。 -->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; img-src ${webview.cspSource};" />
<link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root" data-images="${imagesUri}"></div>
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
  provider.requestRefresh();
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const refreshTimer = setInterval(() => provider.refresh(), REFRESH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });

  context.subscriptions.push(
    vscode.commands.registerCommand('9router-quota.open', () =>
      vscode.commands.executeCommand('workbench.view.extension.nineRouterQuota')
    ),
    vscode.commands.registerCommand('9router-quota.refresh', () => provider.refresh(true))
  );
}

export function deactivate(): void {}
