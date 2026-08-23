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
