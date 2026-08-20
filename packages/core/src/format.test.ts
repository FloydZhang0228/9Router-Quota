import assert from 'node:assert';
import { describeQuota, quotaPercentUsed } from './format';

assert.strictEqual(describeQuota('claude', { unlimited: true }), '无限');
assert.strictEqual(
  describeQuota('claude', { used: 10, total: 100, resetAt: '2026-01-01' }),
  '已用 10 / 100；剩余约 90%；重置时间 2026-01-01'
);
assert.strictEqual(describeQuota('codex', { remaining: 42 }), '剩余 42%');
assert.strictEqual(describeQuota('claude', {}), '已获取，未返回数值');

assert.strictEqual(quotaPercentUsed({ used: 25, total: 100 }), 25);
assert.strictEqual(quotaPercentUsed({ unlimited: true }), null);
assert.strictEqual(quotaPercentUsed({ remainingPercentage: 30 }), 70);
// unlimited 仅表示无硬性上限，仍带数值时应优先展示数值（如 DeepSeek 余额）
assert.strictEqual(quotaPercentUsed({ unlimited: true, used: 10, total: 100 }), 10);
assert.strictEqual(describeQuota('deepseek', { unlimited: true, used: 10, total: 100 }), '已用 10 / 100；剩余约 90%');

console.log('format.test.ts passed');
