import assert from 'node:assert';
import { createUniRequestAdapter } from './uniRequestAdapter';

// uni 是全局注入的，Node 下自己造一个只记录入参的假实现
let lastArgs: any = null;
(globalThis as any).uni = {
  request: (opts: any) => {
    lastArgs = opts;
    opts.success({ statusCode: 200, data: ['line'], header: { 'Set-Cookie': 'sid=1; Path=/' } });
  },
};

async function run() {
  const adapter = createUniRequestAdapter();

  // 省略 init 的调用（recentLogsPoller 就是这么调的）不能抛 TypeError，
  // 否则 poller 里的 catch 会把它静默吞掉，footer 永远停在“加载中…”
  const res = await adapter('http://a.com/api/usage/logs');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(lastArgs.method, 'GET');
  assert.deepStrictEqual(lastArgs.header, {});

  // 第二次请求要带上首次响应里摘到的 Cookie
  await adapter('http://a.com/api/usage/logs');
  assert.strictEqual(lastArgs.header.Cookie, 'sid=1');

  // headers.get 大小写不敏感
  assert.strictEqual(res.headers.get('set-cookie'), 'sid=1; Path=/');

  console.log('uniRequestAdapter.test.ts passed');
}

run();
