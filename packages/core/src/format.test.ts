import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describeQuota, quotaPercentUsed } from './format';
import { PROVIDERS, describeProvider, providerLogo } from './providers';

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

// PROVIDERS 表里登记的每个 logo 都得真有对应文件，否则 webview 会渲染出裂图
// （比"没图标"更难看，而且只在那个 provider 的账号出现时才暴露）。
const MEDIA = join(__dirname, '../../vscode-extension/media/providers');
for (const [key, info] of Object.entries(PROVIDERS)) {
  if (info.logo) assert.ok(existsSync(join(MEDIA, info.logo)), `缺少 logo 素材: ${key} -> ${info.logo}`);
}
// 未登记的 provider 不该抛错，回落成原文 + 无图，webview 自己画首字母徽标
assert.deepStrictEqual(describeProvider('brand-new'), { service: 'brand-new', company: '未知' });
assert.strictEqual(providerLogo('brand-new'), null);
assert.strictEqual(providerLogo('claude'), 'claude.png');

console.log('format.test.ts passed');
