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
// 损坏数据容错：返回 null 而不是抛异常
fakeStore['nineRouterQuota.session'] = '{broken json';
assert.strictEqual(loadSession(), null);
clearSession();
assert.strictEqual(loadSession(), null);

console.log('session.test.ts passed');
