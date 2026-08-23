import assert from 'node:assert';
import { parseLogLine, startPolling, type PolledLogRow } from './recentLogsPoller';
import type { RequestAdapter } from '@9router-quota/core';

const row = parseLogLine('14:32:10 | gpt-4 | OPENAI | myaccount | 120 | 340 | ok');
assert.deepStrictEqual(row, {
  displayTime: '14:32:10', model: 'gpt-4', provider: 'OPENAI',
  account: 'myaccount', promptTokens: '120', completionTokens: '340', status: 'ok',
});

// 字段数不对的行（脏数据/格式变了）不崩，返回 null 让调用方过滤掉
assert.strictEqual(parseLogLine('not a valid line'), null);
assert.strictEqual(parseLogLine(''), null);

// startPolling：首拍立即触发、脏行过滤、失败轮询不崩、stop 后不再触发
async function testPolling() {
  const okBody = ['14:32:10 | gpt-4 | OPENAI | myaccount | 120 | 340 | ok', 'garbage line', ''];
  let failNext = false;
  const adapter: RequestAdapter = async () =>
    failNext
      ? { ok: false, status: 500, json: async () => [], headers: { get: () => null } } // 模拟一次失败轮询
      : { ok: true, status: 200, json: async () => okBody, headers: { get: () => null } };
  const updates: PolledLogRow[][] = [];
  const stop = startPolling('http://x', adapter, {}, (rows) => updates.push(rows), 10);
  await new Promise((r) => setTimeout(r, 5)); // 首拍（tick() 立即调用）
  assert.strictEqual(updates.length, 1, 'first tick fires immediately');
  assert.strictEqual(updates[0].length, 1, 'malformed lines filtered out');
  assert.strictEqual(updates[0][0].model, 'gpt-4');
  failNext = true;
  await new Promise((r) => setTimeout(r, 15)); // 第二拍失败，不崩、不回调
  assert.strictEqual(updates.length, 1, 'failed poll does not invoke onUpdate');
  failNext = false;
  stop();
  await new Promise((r) => setTimeout(r, 25)); // 已停，不再触发
  assert.strictEqual(updates.length, 1, 'stop prevents further ticks');
}
testPolling().then(() => console.log('recentLogsPoller.test.ts passed'), (e) => { console.error(e); process.exit(1); });
