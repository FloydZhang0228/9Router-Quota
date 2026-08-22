// 跑法：node test-app-render.mjs
// 回归防守：app.js 顶层脚本执行时，如果 vscode.getState() 里已经有缓存账号数据（webview
// 被销毁重建——切到别的扩展面板再切回来就会触发——都会立刻同步调用 renderQuota()）。这时
// 但凡渲染路径用到的顶层 const 声明在这次调用之后，就会撞进暂时性死区直接 ReferenceError，
// 而且此后每次刷新都复现同一个崩溃，面板永远空白。list/grid 两种视图分别覆盖一次：
// list 踩过 THEME_ICONS，grid 踩过只在 renderRing 里用到的 RING_RADIUS/RING_CIRCUMFERENCE。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const code = readFileSync(new URL('./media/app.js', import.meta.url), 'utf8');
const stubButton = () => ({ addEventListener: () => {}, classList: { add: () => {} } });

function renderWithRestoredState(viewMode) {
  let html = '';
  const root = {
    dataset: { images: '' },
    set innerHTML(v) { html = v; },
    get innerHTML() { return html; },
    querySelectorAll: () => [],
  };
  const sandbox = {
    document: {
      getElementById: (id) => (id === 'root' ? root : stubButton()),
      body: { classList: { contains: () => false }, dataset: {} },
      querySelectorAll: () => [],
      querySelector: () => null,
    },
    MutationObserver: class { observe() {} },
    acquireVsCodeApi: () => ({
      getState: () => ({
        viewMode,
        accounts: [{ id: '1', service: 'x', account: 'a', logo: null, quotas: [{ name: 'q', percent: 40 }] }],
        updatedAt: 0,
      }),
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
  return html;
}

for (const viewMode of ['list', 'grid']) {
  const html = renderWithRestoredState(viewMode);
  assert.ok(html.includes('toolbar'), `${viewMode} 视图下 renderQuota 应该已经把工具栏画进 #root.innerHTML`);
}
console.log('ok: 有缓存账号数据时 webview 首帧渲染（list/grid 两种视图）都不崩');
