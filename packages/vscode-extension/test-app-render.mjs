// 跑法：node test-app-render.mjs
// 回归防守：app.js 顶层脚本执行时，如果 vscode.getState() 里已经有缓存账号数据（webview
// 被销毁重建 / 侧栏重新打开都会走这条路），会立刻同步调用 renderQuota()。之前 THEME_ICONS
// 声明在文件后半段，renderQuota 引用它时 TDZ 还没过，直接 ReferenceError，此后每次刷新都
// 复现同一个崩溃——面板永远空白。这个脚本模拟"重开时已有缓存数据"这条路径，跑一次就够。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const code = readFileSync(new URL('./media/app.js', import.meta.url), 'utf8');

let html = '';
const root = {
  dataset: { images: '' },
  set innerHTML(v) { html = v; },
  get innerHTML() { return html; },
  querySelectorAll: () => [],
};

const stubButton = () => ({ addEventListener: () => {}, classList: { add: () => {} } });
const sandbox = {
  document: {
    getElementById: (id) => (id === 'root' ? root : stubButton()),
    body: { classList: { contains: () => false }, dataset: {} },
    querySelectorAll: () => [],
    querySelector: () => null,
  },
  MutationObserver: class { observe() {} },
  acquireVsCodeApi: () => ({
    getState: () => ({ accounts: [{ id: '1', service: 'x', account: 'a', logo: null, quotas: [] }], updatedAt: 0 }),
    setState: () => {},
    postMessage: () => {},
  }),
  setInterval: () => 0,
  console,
};
sandbox.window = sandbox;
sandbox.addEventListener = () => {};

vm.createContext(sandbox);
vm.runInContext(code, sandbox); // 有缓存数据时若顶层执行抛异常，这里直接 throw 出来

assert.ok(html.includes('toolbar'), 'renderQuota 应该已经把工具栏画进 #root.innerHTML');
console.log('ok: 有缓存账号数据时 webview 首帧渲染不崩');
