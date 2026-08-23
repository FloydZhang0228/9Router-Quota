# 微信/支付宝/字节小程序客户端(uni-app) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `packages/miniprogram`,用 uni-app(Vue3 + TS + vite)开发一套代码,编译出微信/支付宝/字节三端小程序,尽量复用 `packages/core`,视觉风格对齐现有 VSCode/Chrome 两端。

**Architecture:** `core/client.ts` 重构出可注入的请求适配器(默认行为不变,VSCode/Chrome 零改动);小程序端用 `uni.request` 实现该适配器接口。"最近请求"改轮询 `/api/usage/logs`(9Router 现成接口,不改后端)。UI 用 Vue3 SFC 复刻现有登录卡片/环形进度条/list-grid 切换/最近请求两行的视觉结构。

**Tech Stack:** uni-app(vite-ts 模板)、Vue3 `<script setup>`、TypeScript、npm workspaces、Node 内置 `assert`(单测,与仓库现有 `format.test.ts` 风格一致)。

**Spec:** `docs/superpowers/specs/2026-08-23-miniprogram-uniapp-design.md`

## Global Constraints

- 不修改 `/home/floyd/WorkSpace/9router`(9Router 后端)任何代码。
- `core/client.ts` 重构后,不传适配器参数时行为必须与重构前完全一致——每个改动 `client.ts` 的任务后都要跑通 `packages/core`、`packages/chromium-extension`、`packages/vscode-extension` 三个包现有的 build/test,零回归才能提交。
- 小程序端不做 VSCode 扩展独有的状态栏 tooltip / `asciiBar` / `buildTooltip`。
- 密码用 `uni.setStorageSync` 明文本地存储(与 Chrome 扩展 `chrome.storage.local` 同等安全级别,这是刻意决定,不是遗漏)。
- "最近请求"功能通过轮询 `GET /api/usage/logs` 实现,不使用 SSE/WebSocket。
- 非平凡逻辑(解析、适配器、鉴权)必须留一个可运行的 Node 单测,不依赖小程序运行时。

---

## Task 1: 搭建 `packages/miniprogram` 骨架,验证三端可编译

**Files:**
- Create: `packages/miniprogram/`(uni-app vite-ts 模板生成的整套骨架文件)
- Modify: 无(根 `package.json` 的 `workspaces: ["packages/*"]` 已经覆盖新包,不用改)

**Interfaces:**
- Produces: 一个能跑 `npm run dev:mp-weixin` / `npm run build:mp-weixin` / `npm run build:mp-alipay` / `npm run build:mp-toutiao` 的 uni-app 项目,产物在 `packages/miniprogram/dist/build/mp-weixin`、`mp-alipay`、`mp-toutiao`。

- [ ] **Step 1: 用官方 vite-ts 模板拉取骨架**

```bash
cd /home/floyd/WorkSpace/9Router-Quota/packages
npx degit dcloudio/uni-preset-vue#vite-ts miniprogram
cd miniprogram
```

- [ ] **Step 2: 精简 `package.json`,补齐三端构建脚本,包名对齐仓库命名习惯**

编辑 `packages/miniprogram/package.json`,把 `name` 改成 `9router-quota-miniprogram`,`scripts` 补全微信/支付宝/字节三端命令(模板默认可能只带部分平台脚本,以下是完整集合):

```json
{
  "name": "9router-quota-miniprogram",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev:mp-weixin": "uni -p mp-weixin",
    "dev:mp-alipay": "uni -p mp-alipay",
    "dev:mp-toutiao": "uni -p mp-toutiao",
    "build:mp-weixin": "uni build -p mp-weixin",
    "build:mp-alipay": "uni build -p mp-alipay",
    "build:mp-toutiao": "uni build -p mp-toutiao"
  }
}
```

- [ ] **Step 3: 从仓库根安装依赖(走 workspace)**

```bash
cd /home/floyd/WorkSpace/9Router-Quota
npm install
```

- [ ] **Step 4: 验证三端都能编译过(用模板自带的默认页面,先不改业务逻辑)**

```bash
cd /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram
npm run build:mp-weixin
npm run build:mp-alipay
npm run build:mp-toutiao
```

Expected: 三条命令都成功退出(exit code 0),`dist/build/mp-weixin`、`dist/build/mp-alipay`、`dist/build/mp-toutiao` 三个目录都生成了产物。任何一条报错都要先解决模板/依赖问题,不进入下一任务。

- [ ] **Step 5: Commit**

```bash
cd /home/floyd/WorkSpace/9Router-Quota
git add packages/miniprogram package-lock.json
git commit -m "新增 packages/miniprogram uni-app 骨架，验证微信/支付宝/字节三端可编译"
```

---

## Task 2: 重构 `core/client.ts` 支持可注入请求适配器

**Files:**
- Modify: `packages/core/src/client.ts`
- Modify: `packages/core/src/index.ts`(补充导出新类型,如果需要)
- Test: `packages/core/src/client.test.ts`(新建)
- Modify: `packages/core/package.json`(`test` 脚本要跑到这个新测试文件)

**Interfaces:**
- Produces:
  ```ts
  export interface AdapterResponse {
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
    headers: { get(name: string): string | null };
  }
  export type RequestAdapter = (
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string }
  ) => Promise<AdapterResponse>;
  export const fetchAdapter: RequestAdapter;
  // NineRouterClient 构造函数新增第三个可选参数
  export class NineRouterClient {
    constructor(baseUrl: string, authMode?: AuthMode, adapter?: RequestAdapter);
  }
  ```
- Consumes: 无(这是最底层的改动)

- [ ] **Step 1: 写失败测试——验证不传 adapter 时默认走 fetch,行为与重构前一致**

创建 `packages/core/src/client.test.ts`:

```ts
import assert from 'node:assert';
import { NineRouterClient, LoginError } from './client';

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
const client2 = new NineRouterClient('9router.example.com', 'manual', customAdapter);
await client2.fetchConnections();
assert.strictEqual(customCalls, 1);
assert.strictEqual(calls.length, 2); // 全局fetch calls 没有再增加

console.log('client.test.ts passed');
```

- [ ] **Step 2: 跑测试确认失败(此时 client.ts 还没支持第三个参数)**

Run: `cd /home/floyd/WorkSpace/9Router-Quota/packages/core && npx tsc -p . && node dist/client.test.js`
Expected: FAIL(TS 编译错误,`NineRouterClient` 构造函数不接受第三个参数;或者拿不到 `calls[1].init.headers.Cookie`)

- [ ] **Step 3: 实现——把 `client.ts` 里所有 `fetch(...)` 调用换成注入的适配器**

编辑 `packages/core/src/client.ts`,在文件顶部(`export type AuthMode`附近)新增类型和默认适配器,并把构造函数、内部所有 `fetch()` 调用点替换:

```ts
export interface AdapterResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers: { get(name: string): string | null; getSetCookie?: () => string[] };
  body?: ReadableStream<Uint8Array> | null;
}

export type RequestAdapter = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<AdapterResponse>;

/** 默认适配器：包一层全局fetch，行为与重构前完全一致，VSCode/Chrome不用改调用代码。 */
export const fetchAdapter: RequestAdapter = (url, init) => fetch(url, init as RequestInit) as unknown as Promise<AdapterResponse>;
```

`NineRouterClient` 类改动:

```ts
export class NineRouterClient {
  private baseUrl: string;
  private authMode: AuthMode;
  private cookie: string | null = null;
  private adapter: RequestAdapter;

  constructor(baseUrl: string, authMode: AuthMode = 'manual', adapter: RequestAdapter = fetchAdapter) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.authMode = authMode;
    this.adapter = adapter;
  }

  async login(password: string): Promise<void> {
    const res = await this.adapter(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      ...this.credentials(),
    });
    if (!res.ok) throw new LoginError('登录失败，请检查地址和密码');
    if (this.authMode === 'container') return;

    const cookies = res.headers.getSetCookie?.() ?? [];
    const raw = cookies[0] ?? res.headers.get('set-cookie');
    if (!raw) throw new LoginError('登录失败：服务未返回Cookie');
    this.cookie = raw.split(';')[0];
  }

  private credentials(): { credentials?: 'include' } {
    return this.authMode === 'container' ? { credentials: 'include' } : {};
  }

  private headers(): Record<string, string> {
    if (this.authMode === 'container') return {};
    if (!this.cookie) throw new LoginError('尚未登录');
    return { Cookie: this.cookie };
  }

  async fetchConnections(): Promise<Connection[]> {
    const connections: Connection[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const res = await this.adapter(
        `${this.baseUrl}/api/providers/client?page=${page}&pageSize=500&accountStatus=all`,
        { headers: this.headers(), ...this.credentials() }
      );
      const data = (await res.json()) as { connections?: Connection[]; pagination?: { totalPages?: number } };
      connections.push(...(data.connections ?? []));
      totalPages = data.pagination?.totalPages ?? 1;
      page++;
    } while (page <= totalPages);
    return connections;
  }

  async fetchUsage(connectionId: string): Promise<Usage | null> {
    try {
      const res = await this.adapter(`${this.baseUrl}/api/usage/${encodeURIComponent(connectionId)}?force=1`, {
        headers: this.headers(),
        ...this.credentials(),
      });
      if (!res.ok) return null;
      return (await res.json()) as Usage;
    } catch {
      return null;
    }
  }

  // openRecentRequestsStream 保持原样，继续用全局 fetch + ReadableStream，不接入 adapter
  // （小程序端不用它，见 Task 6 的独立轮询方案）。

  async fetchAllQuotas(): Promise<AccountQuota[]> {
    const connections = await this.fetchConnections();
    const results = await Promise.all(
      connections
        .filter((c) => c.id)
        .map(async (connection): Promise<AccountQuota | null> => {
          const usage = await this.fetchUsage(connection.id);
          if (!usage?.quotas || !Object.keys(usage.quotas).length) return null;
          return { connection, usage };
        })
    );
    return results.filter((r): r is AccountQuota => r !== null);
  }
}
```

`openRecentRequestsStream` 方法体不改动,原样保留(继续直接用全局 `fetch`)。

- [ ] **Step 4: 补 `package.json` 的 test 脚本,跑测试确认通过**

编辑 `packages/core/package.json`:

```json
{
  "scripts": {
    "build": "tsc -p .",
    "test": "npm run build && node dist/format.test.js && node dist/client.test.js"
  }
}
```

Run: `cd /home/floyd/WorkSpace/9Router-Quota/packages/core && npm run test`
Expected: `format.test.ts passed` 和 `client.test.ts passed` 都打印,退出码 0。

- [ ] **Step 5: 回归验证——确认 VSCode/Chrome 两端零影响**

```bash
cd /home/floyd/WorkSpace/9Router-Quota
npm run build
cd packages/chromium-extension && node check-assets.js
cd ../vscode-extension && node esbuild.js && node check-assets.js && node test-app-render.mjs
```

Expected: 全部命令 exit code 0,没有任何报错。这一步是硬性门槛——不通过不能提交。

- [ ] **Step 6: Commit**

```bash
cd /home/floyd/WorkSpace/9Router-Quota
git add packages/core/src/client.ts packages/core/src/client.test.ts packages/core/package.json
git commit -m "core/client.ts 抽出可注入 RequestAdapter，默认行为不变，为小程序端复用铺路"
```

---

## Task 3: `uniRequestAdapter` + 最小诊断登录页(验证 Set-Cookie 可读性用)

**Files:**
- Create: `packages/miniprogram/src/lib/cookieUtils.ts`(纯函数,不依赖 `uni.*`)
- Create: `packages/miniprogram/src/lib/cookieUtils.test.ts`
- Create: `packages/miniprogram/src/lib/uniRequestAdapter.ts`(依赖 `uni.request`,薄封装)
- Create: `packages/miniprogram/src/pages/index/index.vue`(改造模板默认页,做诊断登录表单)

**Interfaces:**
- Consumes: `RequestAdapter`、`AdapterResponse`(Task 2 产出,来自 `@9router-quota/core`)
- Produces:
  ```ts
  // cookieUtils.ts
  export function extractSetCookie(rawHeader: string | null | undefined): string | null; // 取分号前的 "name=value" 段
  export function buildCookieHeader(existing: Record<string, string>, cookie: string | null): Record<string, string>;
  // uniRequestAdapter.ts
  export function createUniRequestAdapter(): RequestAdapter;
  ```

- [ ] **Step 1: 写 `cookieUtils.ts` 的失败测试**

创建 `packages/miniprogram/src/lib/cookieUtils.test.ts`:

```ts
import assert from 'node:assert';
import { extractSetCookie, buildCookieHeader } from './cookieUtils';

assert.strictEqual(extractSetCookie('session=abc123; Path=/; HttpOnly'), 'session=abc123');
assert.strictEqual(extractSetCookie(null), null);
assert.strictEqual(extractSetCookie(undefined), null);
assert.strictEqual(extractSetCookie(''), null);

assert.deepStrictEqual(buildCookieHeader({ 'Content-Type': 'application/json' }, 'session=abc123'), {
  'Content-Type': 'application/json',
  Cookie: 'session=abc123',
});
assert.deepStrictEqual(buildCookieHeader({}, null), {});

console.log('cookieUtils.test.ts passed');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram && npx tsx src/lib/cookieUtils.test.ts`
Expected: FAIL(找不到模块 `./cookieUtils`,文件还不存在)

- [ ] **Step 3: 实现 `cookieUtils.ts`**

```ts
/** 从一条 Set-Cookie 响应头里摘出 "name=value" 段（丢弃 Path/HttpOnly 等属性）。 */
export function extractSetCookie(rawHeader: string | null | undefined): string | null {
  if (!rawHeader) return null;
  const first = rawHeader.split(',')[0]; // 极少数网关会把多个Set-Cookie逗号拼一行，取第一段
  const nameValue = first.split(';')[0].trim();
  return nameValue || null;
}

/** 把缓存的 Cookie 合并进请求头（没有缓存的 Cookie 时原样返回）。 */
export function buildCookieHeader(existing: Record<string, string>, cookie: string | null): Record<string, string> {
  if (!cookie) return existing;
  return { ...existing, Cookie: cookie };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram && npx tsx src/lib/cookieUtils.test.ts`
Expected: `cookieUtils.test.ts passed`

如果项目里没有 `tsx`,先装成 devDependency:`npm install -D tsx --workspace=9router-quota-miniprogram`(只是跑 `.ts` 测试用,不影响小程序运行时打包)。

- [ ] **Step 5: 实现 `uniRequestAdapter.ts`(薄封装,不接入单测,靠 Task 4 的真机验证)**

```ts
import type { AdapterResponse, RequestAdapter } from '@9router-quota/core';
import { extractSetCookie, buildCookieHeader } from './cookieUtils';

/**
 * uni.request 是回调式 API，这里用 Promise 包一层；
 * Cookie 手动摘、手动带，对齐 core 的 'manual' 鉴权模式。
 * 能不能真的读到 Set-Cookie 是本次改造唯一的不确定项，见 Task 4。
 */
export function createUniRequestAdapter(): RequestAdapter {
  let cookie: string | null = null;

  return (url, init) =>
    new Promise<AdapterResponse>((resolve, reject) => {
      uni.request({
        url,
        method: (init.method as any) ?? 'GET',
        header: buildCookieHeader(init.headers ?? {}, cookie),
        data: init.body,
        success: (res) => {
          // 微信/支付宝/字节三端 header 字段大小写、Set-Cookie可见性可能不一致，
          // 这里都尝试一遍，Task 4 用 console.log 实测确认哪种能拿到。
          const rawSetCookie =
            (res.header?.['Set-Cookie'] as string | undefined) ??
            (res.header?.['set-cookie'] as string | undefined) ??
            null;
          console.log('[uniRequestAdapter] response headers:', JSON.stringify(res.header));
          const extracted = extractSetCookie(rawSetCookie);
          if (extracted) cookie = extracted;
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: async () => res.data,
            headers: { get: (name) => (res.header?.[name] as string | undefined) ?? null },
          });
        },
        fail: (err) => reject(new Error(err.errMsg ?? 'uni.request failed')),
      });
    });
}
```

- [ ] **Step 6: 改造 `src/pages/index/index.vue` 为诊断登录表单**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { NineRouterClient } from '@9router-quota/core';
import { createUniRequestAdapter } from '../../lib/uniRequestAdapter';

const baseUrl = ref('');
const password = ref('');
const status = ref('');

async function diagnosticLogin() {
  status.value = '登录中…';
  const client = new NineRouterClient(baseUrl.value, 'manual', createUniRequestAdapter());
  try {
    await client.login(password.value);
    status.value = '登录成功——看控制台里 [uniRequestAdapter] response headers 那行，确认有没有 Set-Cookie 字段';
  } catch (e) {
    status.value = `登录失败：${(e as Error).message}（同样去看控制台的响应头日志）`;
  }
}
</script>

<template>
  <view class="diag">
    <input v-model="baseUrl" placeholder="9Router 地址，如 http://192.168.x.x:端口" />
    <input v-model="password" password placeholder="Dashboard 密码" />
    <button @tap="diagnosticLogin">诊断登录</button>
    <text>{{ status }}</text>
  </view>
</template>

<style>
.diag { display: flex; flex-direction: column; gap: 12px; padding: 24px; }
</style>
```

- [ ] **Step 7: 三端编译确认无报错**

```bash
cd /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram
npm run build:mp-weixin
npm run build:mp-alipay
npm run build:mp-toutiao
```

Expected: 三条命令 exit code 0。

- [ ] **Step 8: Commit**

```bash
cd /home/floyd/WorkSpace/9Router-Quota
git add packages/miniprogram/src/lib packages/miniprogram/src/pages/index/index.vue packages/miniprogram/package.json
git commit -m "小程序端新增 uniRequestAdapter 与诊断登录页，用于验证 Set-Cookie 可读性"
```

---

## Task 4: 【人工验证检查点】三端真机/开发者工具确认 Set-Cookie 可读性

**这个任务不能由自动化 agent 独立完成,需要你(用户)在电脑上操作真实的开发者工具。**

**Files:** 无代码改动,纯验证。

- [ ] **Step 1: 微信开发者工具**

打开微信开发者工具,导入 `packages/miniprogram/dist/build/mp-weixin`(先执行一次 `npm run dev:mp-weixin` 让它保持监听/生成最新产物)。在模拟器里输入你的 9Router 地址和密码,点"诊断登录",打开调试器 Console,找 `[uniRequestAdapter] response headers:` 这行,确认 JSON 里有没有 `Set-Cookie` 或 `set-cookie` 字段。记录结果(有/没有,字段名大小写)。

- [ ] **Step 2: 支付宝小程序开发者工具**

同样方式,`npm run dev:mp-alipay`,导入支付宝开发者工具,重复登录 + 看 Console 的步骤,记录结果。

- [ ] **Step 3: 字节跳动小程序开发者工具**

同样方式,`npm run dev:mp-toutiao`,导入字节小程序开发者工具(抖音开放平台工具),重复登录 + 看 Console 的步骤,记录结果。

- [ ] **Step 4: 汇总结论,决定是否继续**

- 三端都能读到 Cookie → 继续 Task 5,`manual` 鉴权方案成立。
- 有任意一端读不到 → **停下来**,不要继续 Task 5 以后的任务。这种情况下需要回到设计阶段重新讨论(比如该端是否有其他鉴权手段、或者是否接受该端功能降级/暂不支持),不在本计划范围内预先假设解法。

---

## Task 5: 完整走通登录 + 拉配额 + 本地持久化 + 退出登录

**前置条件:Task 4 三端全部确认 Cookie 可读,否则本任务不开始。**

**Files:**
- Create: `packages/miniprogram/src/lib/session.ts`(登录态管理:持久化、恢复、登出)
- Create: `packages/miniprogram/src/lib/session.test.ts`
- Modify: `packages/miniprogram/src/pages/index/index.vue`(接入 session,替换掉 Task 3 的诊断版)

**Interfaces:**
- Consumes: `NineRouterClient`(core)、`createUniRequestAdapter`(Task 3)
- Produces:
  ```ts
  export interface StoredSession { baseUrl: string; password: string }
  export function saveSession(s: StoredSession): void;
  export function loadSession(): StoredSession | null;
  export function clearSession(): void;
  ```

- [ ] **Step 1: 写 `session.ts` 失败测试(用假的 storage 实现注入,不依赖真实 `uni.*`)**

```ts
import assert from 'node:assert';
import { saveSession, loadSession, clearSession, __setStorageForTest } from './session';

const fakeStore: Record<string, string> = {};
__setStorageForTest({
  setStorageSync: (k: string, v: string) => { fakeStore[k] = v; },
  getStorageSync: (k: string) => fakeStore[k] ?? '',
  removeStorageSync: (k: string) => { delete fakeStore[k]; },
});

assert.strictEqual(loadSession(), null);
saveSession({ baseUrl: 'http://a.com', password: 'pw' });
assert.deepStrictEqual(loadSession(), { baseUrl: 'http://a.com', password: 'pw' });
clearSession();
assert.strictEqual(loadSession(), null);

console.log('session.test.ts passed');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram && npx tsx src/lib/session.test.ts`
Expected: FAIL(`session.ts` 不存在)

- [ ] **Step 3: 实现 `session.ts`(存储层可注入,方便测试;运行时默认用真实 `uni.*`)**

```ts
export interface StoredSession { baseUrl: string; password: string }

interface StorageLike {
  setStorageSync(key: string, value: string): void;
  getStorageSync(key: string): string;
  removeStorageSync(key: string): void;
}

const STORAGE_KEY = 'nineRouterQuota.session';
let storage: StorageLike = {
  setStorageSync: (k, v) => uni.setStorageSync(k, v),
  getStorageSync: (k) => uni.getStorageSync(k) as string,
  removeStorageSync: (k) => uni.removeStorageSync(k),
};

/** 仅测试用：注入假的storage实现，绕开小程序运行时依赖。 */
export function __setStorageForTest(fake: StorageLike): void {
  storage = fake;
}

export function saveSession(s: StoredSession): void {
  storage.setStorageSync(STORAGE_KEY, JSON.stringify(s));
}

export function loadSession(): StoredSession | null {
  const raw = storage.getStorageSync(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  storage.removeStorageSync(STORAGE_KEY);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram && npx tsx src/lib/session.test.ts`
Expected: `session.test.ts passed`

- [ ] **Step 5: 接入 `index.vue`——启动时自动登录、登录成功后拉配额、支持登出**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NineRouterClient, type AccountQuota } from '@9router-quota/core';
import { createUniRequestAdapter } from '../../lib/uniRequestAdapter';
import { saveSession, loadSession, clearSession } from '../../lib/session';

const baseUrl = ref('');
const password = ref('');
const status = ref<'loading' | 'login' | 'ready' | 'error'>('loading');
const errorMessage = ref('');
const quotas = ref<AccountQuota[]>([]);
let client: NineRouterClient | null = null;

async function doLogin(url: string, pw: string) {
  client = new NineRouterClient(url, 'manual', createUniRequestAdapter());
  await client.login(pw);
  quotas.value = await client.fetchAllQuotas();
  saveSession({ baseUrl: url, password: pw });
  status.value = 'ready';
}

async function onSubmit() {
  status.value = 'loading';
  errorMessage.value = '';
  try {
    await doLogin(baseUrl.value, password.value);
  } catch (e) {
    status.value = 'error';
    errorMessage.value = (e as Error).message;
  }
}

function onLogout() {
  clearSession();
  client = null;
  quotas.value = [];
  status.value = 'login';
}

onMounted(async () => {
  const saved = loadSession();
  if (!saved) {
    status.value = 'login';
    return;
  }
  baseUrl.value = saved.baseUrl;
  password.value = saved.password;
  try {
    await doLogin(saved.baseUrl, saved.password);
  } catch (e) {
    status.value = 'error';
    errorMessage.value = (e as Error).message;
  }
});
</script>

<template>
  <view class="app-shell">
    <view v-if="status === 'loading'" class="status">加载中…</view>
    <view v-else-if="status === 'login' || status === 'error'" class="login-screen">
      <view class="login-card">
        <view class="login-logo">9</view>
        <text class="login-title">9Router Quota</text>
        <text class="login-subtitle">连接你的9Router服务，查看各账号的实时配额</text>
        <view class="login-field">
          <text class="login-label">9Router地址</text>
          <input v-model="baseUrl" placeholder="http://9router.example.com" />
        </view>
        <view class="login-field">
          <text class="login-label">Dashboard密码</text>
          <input v-model="password" password />
        </view>
        <button class="login-submit" @tap="onSubmit">登录</button>
        <text v-if="status === 'error'" class="login-error">{{ errorMessage }}</text>
        <text class="login-hint">密码保存在小程序本地存储中，不会同步到云端。</text>
      </view>
    </view>
    <view v-else class="status">已登录，{{ quotas.length }} 个账号（配额展示见 Task 8）</view>
  </view>
</template>

<style>
.app-shell { display: flex; flex-direction: column; height: 100%; background: #0f1a2e; }
.status { padding: 24px; color: #8b96ac; text-align: center; }
.login-screen { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.login-card {
  width: 100%; max-width: 320px; padding: 28px 24px; border-radius: 16px;
  background: rgba(23, 35, 61, 0.55); border: 1px solid rgba(36, 49, 79, 0.7); box-sizing: border-box;
}
.login-logo {
  width: 44px; height: 44px; margin: 0 auto 14px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #f97815, #c2590a); color: #fff; font-size: 22px; font-weight: 700;
}
.login-title { display: block; font-size: 17px; font-weight: 700; text-align: center; color: #d6dde8; }
.login-subtitle { display: block; margin: 6px 0 22px; font-size: 12px; text-align: center; color: #8b96ac; }
.login-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.login-label { font-size: 12px; color: #8b96ac; }
.login-field input {
  background: #17233d; color: #d6dde8; border: 1px solid #24314f; border-radius: 8px;
  padding: 9px 12px; font-size: 13px; box-sizing: border-box;
}
.login-submit {
  width: 100%; margin-top: 4px; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600;
  background: #2f6fd6; color: #fff; border: none;
}
.login-error { display: block; margin-top: 10px; font-size: 12px; color: #f48771; text-align: center; }
.login-hint { display: block; margin: 16px 0 0; font-size: 11px; line-height: 1.5; text-align: center; color: #8b96ac; }
</style>
```

`ponytail:` 这一步先只用暗色调色板(对齐 `styles.css` 的 `:root` 默认值),不做 system/dark/light 主题切换,主题切换如果还有余量可以在 Task 8 一起加,不是本任务的阻塞项。

- [ ] **Step 6: 三端编译确认无报错**

```bash
cd /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram
npm run build:mp-weixin && npm run build:mp-alipay && npm run build:mp-toutiao
```

- [ ] **Step 7: Commit**

```bash
cd /home/floyd/WorkSpace/9Router-Quota
git add packages/miniprogram/src/lib/session.ts packages/miniprogram/src/lib/session.test.ts packages/miniprogram/src/pages/index/index.vue
git commit -m "小程序端接入登录态持久化，自动登录+拉配额+登出闭环"
```

---

## Task 6: `recentLogsPoller`——轮询 `/api/usage/logs`,解析成结构化数据

**Files:**
- Create: `packages/miniprogram/src/lib/recentLogsPoller.ts`
- Create: `packages/miniprogram/src/lib/recentLogsPoller.test.ts`

**Interfaces:**
- Consumes: `RequestAdapter`(via `createUniRequestAdapter`)、`session.ts` 的 `loadSession`(拿 baseUrl)
- Produces:
  ```ts
  export interface PolledLogRow {
    displayTime: string; model: string; provider: string;
    account: string; promptTokens: string; completionTokens: string; status: string;
  }
  export function parseLogLine(line: string): PolledLogRow | null;
  export function startPolling(baseUrl: string, cookie: string, onUpdate: (rows: PolledLogRow[]) => void, intervalMs?: number): () => void;
  ```

- [ ] **Step 1: 写 `parseLogLine` 失败测试**

```ts
import assert from 'node:assert';
import { parseLogLine } from './recentLogsPoller';

const row = parseLogLine('14:32:10 | gpt-4 | OPENAI | myaccount | 120 | 340 | ok');
assert.deepStrictEqual(row, {
  displayTime: '14:32:10', model: 'gpt-4', provider: 'OPENAI',
  account: 'myaccount', promptTokens: '120', completionTokens: '340', status: 'ok',
});

// 字段数不对的行（脏数据/格式变了）不崩，返回 null 让调用方过滤掉
assert.strictEqual(parseLogLine('not a valid line'), null);
assert.strictEqual(parseLogLine(''), null);

console.log('recentLogsPoller.test.ts passed');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram && npx tsx src/lib/recentLogsPoller.test.ts`
Expected: FAIL(文件不存在)

- [ ] **Step 3: 实现**

```ts
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
  cookieHeader: Record<string, string>,
  onUpdate: (rows: PolledLogRow[]) => void,
  intervalMs = 12_000
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const res = await adapter(`${baseUrl}/api/usage/logs`, { headers: cookieHeader });
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram && npx tsx src/lib/recentLogsPoller.test.ts`
Expected: `recentLogsPoller.test.ts passed`

- [ ] **Step 5: Commit**

```bash
cd /home/floyd/WorkSpace/9Router-Quota
git add packages/miniprogram/src/lib/recentLogsPoller.ts packages/miniprogram/src/lib/recentLogsPoller.test.ts
git commit -m "小程序端新增最近请求轮询模块，解析 /api/usage/logs 而不依赖 SSE"
```

---

## Task 7: `formatAccount` + provider 图标静态资源

**Files:**
- Create: `packages/miniprogram/src/lib/formatAccount.ts`(镜像 `background.ts`/`extension.ts` 里重复的同一段逻辑)
- Create: `packages/miniprogram/src/lib/formatAccount.test.ts`
- Create: `packages/miniprogram/src/static/providers/`(拷贝图标)

**Interfaces:**
- Consumes: `describeProvider`、`providerLogo`、`describeQuota`、`quotaPercentUsed`(均来自 `@9router-quota/core`)
- Produces:
  ```ts
  export function formatAccount(aq: AccountQuota): RenderedAccount;
  export interface RenderedAccount { id: string; service: string; account: string; plan?: string; logo: string | null; quotas: RenderedQuotaItem[] }
  ```

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert';
import { formatAccount } from './formatAccount';

const result = formatAccount({
  connection: { id: 'c1', provider: 'claude', email: 'a@b.com' },
  usage: { plan: 'Claude Code', quotas: { session: { displayName: '会话', used: 10, total: 100 } } },
});
assert.strictEqual(result.id, 'c1');
assert.strictEqual(result.service, 'Claude');
assert.strictEqual(result.account, 'a@b.com');
assert.strictEqual(result.plan, undefined); // claude provider 的 plan 恒被过滤
assert.strictEqual(result.quotas.length, 1);
assert.strictEqual(result.quotas[0].name, '会话');

console.log('formatAccount.test.ts passed');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram && npx tsx src/lib/formatAccount.test.ts`
Expected: FAIL(文件不存在)

- [ ] **Step 3: 实现(逻辑照搬 `packages/chromium-extension/src/background.ts` 的 `formatAccount`,只是落在小程序包里)**

```ts
import { describeProvider, describeQuota, providerLogo, quotaPercentUsed, type AccountQuota } from '@9router-quota/core';

export interface RenderedQuotaItem {
  name: string; description: string; percent: number | null;
  unlimited: boolean; resetAt?: string; used?: number; total?: number;
}
export interface RenderedAccount {
  id: string; service: string; account: string; plan?: string;
  logo: string | null; quotas: RenderedQuotaItem[];
}

export function formatAccount({ connection, usage }: AccountQuota): RenderedAccount {
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
  const plan =
    connection.provider === 'claude' || !usage.plan || usage.plan.toLowerCase() === service.toLowerCase()
      ? undefined
      : usage.plan;
  return { id: connection.id, service, account, plan, logo: providerLogo(connection.provider), quotas };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram && npx tsx src/lib/formatAccount.test.ts`
Expected: `formatAccount.test.ts passed`

- [ ] **Step 5: 拷贝 provider 图标到小程序静态资源目录**

```bash
mkdir -p /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram/src/static/providers
cp /home/floyd/WorkSpace/9Router-Quota/packages/vscode-extension/images/providers/*.png \
   /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram/src/static/providers/
```

小程序端引用图标用相对路径 `/static/providers/${logo}`(uni-app 约定,`src/static/` 下的文件会被三端构建自动收进产物,不需要额外配置)。

- [ ] **Step 6: Commit**

```bash
cd /home/floyd/WorkSpace/9Router-Quota
git add packages/miniprogram/src/lib/formatAccount.ts packages/miniprogram/src/lib/formatAccount.test.ts packages/miniprogram/src/static
git commit -m "小程序端新增 formatAccount 账号数据整形，拷贝 provider 图标静态资源"
```

---

## Task 8: 配额展示 UI——环形图组件、list/grid 切换、最近请求 footer

**Files:**
- Create: `packages/miniprogram/src/components/QuotaRing.vue`
- Create: `packages/miniprogram/src/components/QuotaRow.vue`
- Create: `packages/miniprogram/src/components/RecentFooter.vue`
- Modify: `packages/miniprogram/src/pages/index/index.vue`(接入以上组件,补全工具栏、list/grid 切换、退出登录)

**Interfaces:**
- Consumes: `RenderedAccount`(Task 7)、`PolledLogRow`(Task 6)、`levelOf`/`remainingOf`/`amountText`/`timeUntil`(core `format.ts`)
- Produces: 完整可用的配额展示页面

- [ ] **Step 1: `QuotaRing.vue`——环形进度条,SVG 算法照搬现有两端的 `RING_RADIUS`/`RING_CIRCUMFERENCE`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { levelOf, remainingOf, amountText, timeUntil, type RenderedQuotaItem } from '@9router-quota/core';

const props = defineProps<{ quota: RenderedQuotaItem }>();

const RING_RADIUS = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const remaining = computed(() => remainingOf(props.quota));
const amount = computed(() => amountText(props.quota));
const level = computed(() => (remaining.value != null ? levelOf(remaining.value) : amount.value != null ? 'green' : 'none'));
const percent = computed(() => Math.max(0, Math.min(100, remaining.value ?? (amount.value != null ? 100 : 0))));
const text = computed(() =>
  amount.value ?? (props.quota.unlimited && remaining.value == null ? '∞' : remaining.value != null ? `${remaining.value.toFixed(0)}%` : '—')
);
const offset = computed(() => RING_CIRCUMFERENCE * (1 - percent.value / 100));
const strokeColor = computed(() => ({ green: '#4fd17a', amber: '#f0d264', red: '#ef5f5f', none: 'transparent' }[level.value]));
</script>

<template>
  <view class="ring-card">
    <view class="ring">
      <!-- #ifdef MP-WEIXIN || MP-ALIPAY || MP-TOUTIAO -->
      <svg viewBox="0 0 52 52" width="52" height="52" style="transform: rotate(-90deg)">
        <circle cx="26" cy="26" :r="RING_RADIUS" fill="none" stroke="rgba(128,128,140,0.25)" stroke-width="4" />
        <circle
          cx="26" cy="26" :r="RING_RADIUS" fill="none" :stroke="strokeColor" stroke-width="4"
          stroke-linecap="round" :stroke-dasharray="RING_CIRCUMFERENCE" :stroke-dashoffset="offset"
        />
      </svg>
      <!-- #endif -->
      <text class="ring-text">{{ text }}</text>
    </view>
    <text class="ring-label">{{ quota.name }}</text>
    <text v-if="quota.resetAt" class="ring-meta">{{ timeUntil(quota.resetAt) }}</text>
  </view>
</template>

<style>
.ring-card { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 10px 6px 8px; border-radius: 10px; background: rgba(23, 35, 61, 0.55); border: 1px solid rgba(36, 49, 79, 0.7); }
.ring { position: relative; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; }
.ring-text { position: relative; font-size: 11px; font-weight: 600; }
.ring-label { font-size: 10px; text-align: center; color: #8b96ac; max-width: 72px; overflow: hidden; }
.ring-meta { font-size: 9px; text-align: center; color: #8b96ac; opacity: 0.75; }
</style>
```

`ponytail:` 小程序 WXSS 引擎对内联 `<svg>` 的支持因平台而异(微信小程序基础库较新版本支持原生 `<svg>` 标签渲染,支付宝/字节需要在 Task 4 之外额外验证)。用 `#ifdef` 条件编译占位是为了三端都能过编译;如果某端渲染不出圆环,退路是把 SVG 换成 `<canvas>` 手绘,这是一个已知的、留到人工验收阶段(Task 9)才能实锤的风险点,不阻塞开发。

- [ ] **Step 2: `QuotaRow.vue`——list 视图的横条**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { levelOf, remainingOf, amountText, timeUntil, type RenderedQuotaItem } from '@9router-quota/core';

const props = defineProps<{ quota: RenderedQuotaItem }>();

const remaining = computed(() => remainingOf(props.quota));
const amount = computed(() => amountText(props.quota));
const level = computed(() => (remaining.value != null ? levelOf(remaining.value) : amount.value != null ? 'green' : 'none'));
const label = computed(() => amount.value ?? (remaining.value != null ? `${remaining.value.toFixed(0)}%` : null));
const percent = computed(() => Math.max(0, Math.min(100, remaining.value ?? (amount.value != null ? 100 : 0))));
const color = computed(() => ({ red: '#ef5f5f', amber: '#f0d264', green: '#4fd17a', none: '#4fd17a' }[level.value]));
</script>

<template>
  <view class="quota-row">
    <text class="quota-pill">{{ quota.name }}</text>
    <text v-if="quota.unlimited && label == null" class="quota-percent">无限</text>
    <template v-else>
      <view class="quota-track">
        <view class="quota-track-fill" :style="{ width: percent + '%', background: color }" />
      </view>
      <text class="quota-percent">{{ label ?? '—' }}</text>
    </template>
    <text v-if="quota.resetAt" class="quota-meta">{{ timeUntil(quota.resetAt) }}</text>
  </view>
</template>

<style>
.quota-row { display: flex; align-items: center; gap: 8px; padding: 6px 4px; }
.quota-pill { font-size: 11px; color: #d6dde8; min-width: 60px; }
.quota-track { flex: 1; height: 6px; border-radius: 3px; background: rgba(128, 128, 140, 0.25); overflow: hidden; }
.quota-track-fill { height: 100%; }
.quota-percent { font-size: 11px; color: #d6dde8; min-width: 36px; text-align: right; }
.quota-meta { font-size: 9px; color: #8b96ac; }
</style>
```

- [ ] **Step 3: `RecentFooter.vue`**

```vue
<script setup lang="ts">
import type { PolledLogRow } from '../lib/recentLogsPoller';

defineProps<{ rows: PolledLogRow[]; loaded: boolean }>();
</script>

<template>
  <view class="recent-footer">
    <view v-if="!loaded" class="recent-row recent-loading">加载中…</view>
    <view v-for="(row, i) in rows" :key="i" class="recent-row">
      <text class="recent-model">{{ row.model }}</text>
      <text class="recent-tokens">{{ row.promptTokens }}↑ {{ row.completionTokens }}↓</text>
      <text class="recent-time">{{ row.displayTime }}</text>
    </view>
  </view>
</template>

<style>
.recent-footer { border-top: 1px solid #24314f; padding-top: 6px; margin-top: 6px; flex: none; }
.recent-row { display: flex; justify-content: space-between; font-size: 10px; color: #8b96ac; padding: 2px 0; }
.recent-loading { text-align: center; }
</style>
```

- [ ] **Step 4: 把 `index.vue` 展开成完整配额页(完整替换 `<script setup>` 与 `<template>`,以下是最终版本,不是增量补丁)**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import { NineRouterClient, type AccountQuota } from '@9router-quota/core';
import { createUniRequestAdapter } from '../../lib/uniRequestAdapter';
import { saveSession, loadSession, clearSession } from '../../lib/session';
import { formatAccount, type RenderedAccount } from '../../lib/formatAccount';
import { startPolling, type PolledLogRow } from '../../lib/recentLogsPoller';
import QuotaRing from '../../components/QuotaRing.vue';
import QuotaRow from '../../components/QuotaRow.vue';
import RecentFooter from '../../components/RecentFooter.vue';

const REFRESH_INTERVAL_MS = 5 * 60_000; // 对齐 Chrome 端 REFRESH_INTERVAL_MIN = 5

const baseUrl = ref('');
const password = ref('');
const status = ref<'loading' | 'login' | 'ready' | 'error'>('loading');
const errorMessage = ref('');
const quotas = ref<AccountQuota[]>([]);
const accounts = ref<RenderedAccount[]>([]);
const viewMode = ref<'list' | 'grid'>('list');
const recentRows = ref<PolledLogRow[]>([]);
const recentLoaded = ref(false);
let client: NineRouterClient | null = null;
let stopPolling: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function startBackgroundTasks(url: string) {
  stopPolling = startPolling(url, createUniRequestAdapter(), {}, (rows) => {
    recentRows.value = rows;
    recentLoaded.value = true;
  });
  refreshTimer = setInterval(async () => {
    if (!client) return;
    quotas.value = await client.fetchAllQuotas();
    accounts.value = quotas.value.map(formatAccount);
  }, REFRESH_INTERVAL_MS);
}

function stopBackgroundTasks() {
  stopPolling?.();
  stopPolling = null;
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

async function doLogin(url: string, pw: string) {
  client = new NineRouterClient(url, 'manual', createUniRequestAdapter());
  await client.login(pw);
  quotas.value = await client.fetchAllQuotas();
  accounts.value = quotas.value.map(formatAccount);
  saveSession({ baseUrl: url, password: pw });
  status.value = 'ready';
  startBackgroundTasks(url);
}

async function onSubmit() {
  status.value = 'loading';
  errorMessage.value = '';
  try {
    await doLogin(baseUrl.value, password.value);
  } catch (e) {
    status.value = 'error';
    errorMessage.value = (e as Error).message;
  }
}

function onLogout() {
  stopBackgroundTasks();
  clearSession();
  client = null;
  quotas.value = [];
  accounts.value = [];
  recentRows.value = [];
  recentLoaded.value = false;
  status.value = 'login';
}

function toggleView() {
  viewMode.value = viewMode.value === 'list' ? 'grid' : 'list';
}

onMounted(async () => {
  const saved = loadSession();
  if (!saved) {
    status.value = 'login';
    return;
  }
  baseUrl.value = saved.baseUrl;
  password.value = saved.password;
  try {
    await doLogin(saved.baseUrl, saved.password);
  } catch (e) {
    status.value = 'error';
    errorMessage.value = (e as Error).message;
  }
});

// 切到后台停轮询/停定时刷新，切回前台且已登录时恢复——避免小程序在后台空耗流量，
// 也避免重复调用 startBackgroundTasks 导致定时器叠加（用 refreshTimer 是否已存在把关）。
onHide(() => stopBackgroundTasks());
onShow(() => {
  if (status.value === 'ready' && client && !refreshTimer) startBackgroundTasks(baseUrl.value);
});
onUnmounted(() => stopBackgroundTasks());
</script>

<template>
  <view v-if="status === 'loading'" class="status">加载中…</view>
  <view v-else-if="status === 'login' || status === 'error'" class="login-screen">
    <view class="login-card">
      <view class="login-logo">9</view>
      <text class="login-title">9Router Quota</text>
      <text class="login-subtitle">连接你的9Router服务，查看各账号的实时配额</text>
      <view class="login-field">
        <text class="login-label">9Router地址</text>
        <input v-model="baseUrl" placeholder="http://9router.example.com" />
      </view>
      <view class="login-field">
        <text class="login-label">Dashboard密码</text>
        <input v-model="password" password />
      </view>
      <button class="login-submit" @tap="onSubmit">登录</button>
      <text v-if="status === 'error'" class="login-error">{{ errorMessage }}</text>
      <text class="login-hint">密码保存在小程序本地存储中，不会同步到云端。</text>
    </view>
  </view>
  <view v-else class="app-shell">
    <view class="toolbar">
      <text>{{ accounts.length }} 个账号</text>
      <view class="actions">
        <button size="mini" @tap="toggleView">{{ viewMode === 'list' ? '☰' : '◎' }}</button>
        <button size="mini" @tap="onLogout">⏻</button>
      </view>
    </view>
    <scroll-view scroll-y class="board">
      <view v-for="acc in accounts" :key="acc.id" class="account">
        <view class="account-header">
          <text class="account-title">{{ acc.service }}</text>
          <text v-if="acc.plan" class="account-tier">{{ acc.plan }}</text>
          <text class="account-sub">{{ acc.account }}</text>
        </view>
        <view :class="viewMode === 'grid' ? 'ring-row' : ''">
          <template v-if="viewMode === 'grid'">
            <QuotaRing v-for="(q, i) in acc.quotas" :key="i" :quota="q" />
          </template>
          <template v-else>
            <QuotaRow v-for="(q, i) in acc.quotas" :key="i" :quota="q" />
          </template>
        </view>
      </view>
    </scroll-view>
    <RecentFooter :rows="recentRows" :loaded="recentLoaded" />
  </view>
</template>

<style>
.status { padding: 24px; color: #8b96ac; text-align: center; }
.login-screen { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.login-card {
  width: 100%; max-width: 320px; padding: 28px 24px; border-radius: 16px;
  background: rgba(23, 35, 61, 0.55); border: 1px solid rgba(36, 49, 79, 0.7); box-sizing: border-box;
}
.login-logo {
  width: 44px; height: 44px; margin: 0 auto 14px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #f97815, #c2590a); color: #fff; font-size: 22px; font-weight: 700;
}
.login-title { display: block; font-size: 17px; font-weight: 700; text-align: center; color: #d6dde8; }
.login-subtitle { display: block; margin: 6px 0 22px; font-size: 12px; text-align: center; color: #8b96ac; }
.login-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.login-label { font-size: 12px; color: #8b96ac; }
.login-field input {
  background: #17233d; color: #d6dde8; border: 1px solid #24314f; border-radius: 8px;
  padding: 9px 12px; font-size: 13px; box-sizing: border-box;
}
.login-submit {
  width: 100%; margin-top: 4px; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600;
  background: #2f6fd6; color: #fff; border: none;
}
.login-error { display: block; margin-top: 10px; font-size: 12px; color: #f48771; text-align: center; }
.login-hint { display: block; margin: 16px 0 0; font-size: 11px; line-height: 1.5; text-align: center; color: #8b96ac; }
.app-shell { display: flex; flex-direction: column; height: 100%; background: #0f1a2e; }
.toolbar { display: flex; justify-content: space-between; align-items: center; padding: 8px 4px; color: #8b96ac; font-size: 11px; }
.actions { display: flex; gap: 4px; }
.board { flex: 1; overflow-y: auto; }
.account { padding: 8px 4px; border-bottom: 1px solid rgba(36, 49, 79, 0.4); }
.account-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.account-title { font-size: 12px; font-weight: 600; color: #d6dde8; }
.account-tier { font-size: 10px; color: #8b96ac; }
.account-sub { font-size: 10px; color: #8b96ac; margin-left: auto; }
.ring-row { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
```

这一步把 Task 5 的登录态逻辑、Task 6 的轮询、Task 7 的账号整形、本任务前三步的展示组件,一次性拼装成最终版 `index.vue`(完整替换该文件,不是在旧版基础上打补丁),包含完整的定时刷新与 `onHide`/`onShow` 生命周期联动——不再留后续任务补全的断层。

- [ ] **Step 5: 三端编译确认无报错**

```bash
cd /home/floyd/WorkSpace/9Router-Quota/packages/miniprogram
npm run build:mp-weixin && npm run build:mp-alipay && npm run build:mp-toutiao
```

- [ ] **Step 6: Commit**

```bash
cd /home/floyd/WorkSpace/9Router-Quota
git add packages/miniprogram/src/components packages/miniprogram/src/pages/index/index.vue
git commit -m "小程序端补全配额展示 UI：环形图/列表切换/最近请求 footer/定时刷新与生命周期联动"
```

---

## Task 9: 全量验证与三端人工走查

**Files:** 无代码改动。

- [ ] **Step 1: 跑一遍全仓库回归**

```bash
cd /home/floyd/WorkSpace/9Router-Quota
npm run build
cd packages/core && npm run test
cd ../chromium-extension && node check-assets.js
cd ../vscode-extension && node esbuild.js && node check-assets.js && node test-app-render.mjs
cd ../miniprogram
npx tsx src/lib/cookieUtils.test.ts
npx tsx src/lib/session.test.ts
npx tsx src/lib/recentLogsPoller.test.ts
npx tsx src/lib/formatAccount.test.ts
npm run build:mp-weixin && npm run build:mp-alipay && npm run build:mp-toutiao
```

Expected: 全部命令 exit code 0。

- [ ] **Step 2: 三端开发者工具人工走查(需要你操作)**

在微信/支付宝/字节三端开发者工具里各过一遍:登录 → 配额展示(list 和 grid 都点一下)→ 最近请求两行有没有数据、大概 12 秒后有没有刷新 → 切到后台再切回来确认不会重复叠加定时器(没有报错、数字没有翻倍跳动)→ 退出登录 → 重新打开小程序确认自动登录生效。

记录每一端有没有视觉/功能差异(尤其是 Task 8 里标注过的 SVG 环形图渲染风险点)。

- [ ] **Step 3: 视觉走查发现的具体问题,单独开小任务修,不在这一步直接改代码**

如果三端走查发现具体的样式/交互问题,记录清单,视问题大小决定是当场小改还是另开一个任务处理——不在验证步骤里顺手改动未经确认的范围。
