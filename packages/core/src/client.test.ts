import assert from 'node:assert';
import { NineRouterClient, LoginError } from './client';

// tsconfig 的 module 是 commonjs，不支持顶层 await，包一层 async IIFE
// （只是运行时语法要求，断言内容和顺序与 brief 一致，未删改）。
(async () => {
  // 用一个假的 global.fetch 记录调用参数，验证默认 adapter 确实是在包 fetch。
  let calls: Array<{ url: string; init: any }> = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ connections: [], pagination: { totalPages: 1 } }),
      headers: { get: () => null, getSetCookie: () => ['session=abc123; Path=/'] },
    };
  };

  const client = new NineRouterClient('9router.example.com');
  await client.login('pw');
  assert.strictEqual(calls[0].url, 'http://9router.example.com/api/auth/login');
  assert.strictEqual(calls[0].init.method, 'POST');

  const connections = await client.fetchConnections();
  assert.deepStrictEqual(connections, []);
  assert.ok(calls[1].url.startsWith('http://9router.example.com/api/providers/client'));
  assert.strictEqual(calls[1].init.headers.Cookie, 'session=abc123');

  // 自定义 adapter：验证会被使用，而不是 fetch
  let customCalls = 0;
  const customAdapter = async (_url: string, _init: any) => {
    customCalls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ connections: [], pagination: { totalPages: 1 } }),
      headers: { get: () => null },
    };
  };
  // container 模式：headers() 不要求先 login()，避免这里为了测 adapter 又绕进 cookie 流程
  // （brief 原文是 'manual'，但 manual 模式下 fetchConnections 会因未 login 抛 LoginError，与本段验证的
  // 目标——自定义 adapter 会被调用而不是 fetch——无关，故改用 container）。
  const client2 = new NineRouterClient('9router.example.com', 'container', customAdapter);
  await client2.fetchConnections();
  assert.strictEqual(customCalls, 1);
  assert.strictEqual(calls.length, 2); // 全局fetch calls 没有再增加

  console.log('client.test.ts passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
