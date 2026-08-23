import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { amountText, describeQuota, levelOf, quotaPercentUsed, remainingOf, timeAgo, timeUntil } from './format';
import { PROVIDERS, describeProvider, providerLogo } from './providers';
import { normalizeBaseUrl } from './client';

//服务地址http / https都要照单全收，只补协议和去尾斜杠，不做别的改写。
assert.strictEqual(normalizeBaseUrl('http://9router.example.com'), 'http://9router.example.com');
assert.strictEqual(normalizeBaseUrl('https://9router.example.com'), 'https://9router.example.com');
assert.strictEqual(normalizeBaseUrl('HTTPS://9router.example.com'), 'HTTPS://9router.example.com');
//只填主机名时按http补全：自建9Router多数没配证书
assert.strictEqual(normalizeBaseUrl('9router.example.com'), 'http://9router.example.com');
assert.strictEqual(normalizeBaseUrl('192.168.1.10:3000'), 'http://192.168.1.10:3000');
//末尾斜杠与前后空白都要清掉，否则拼出 //api/... 打不通
assert.strictEqual(normalizeBaseUrl('https://9router.example.com///'), 'https://9router.example.com');
assert.strictEqual(normalizeBaseUrl('  http://9router.example.com/  '), 'http://9router.example.com');
assert.strictEqual(normalizeBaseUrl(''), '');
assert.strictEqual(normalizeBaseUrl('   '), '');

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
//unlimited仅表示无硬性上限，仍带数值时应优先展示数值（如DeepSeek余额）
assert.strictEqual(quotaPercentUsed({ unlimited: true, used: 10, total: 100 }), 10);
assert.strictEqual(describeQuota('deepseek', { unlimited: true, used: 10, total: 100 }), '已用 10 / 100；剩余约 90%');

//展示层纯函数：三端共用，改坏一处三个客户端一起错
assert.strictEqual(remainingOf({ percent: 30, unlimited: false }), 70);
assert.strictEqual(remainingOf({ percent: null, unlimited: false }), null);
//余额型：unlimited + total才出数字，整数直出、小数两位
assert.strictEqual(amountText({ percent: null, unlimited: true, used: 10, total: 100 }), '90');
assert.strictEqual(amountText({ percent: null, unlimited: true, used: 0.5, total: 100 }), '99.50');
assert.strictEqual(amountText({ percent: null, unlimited: true, total: 100 }), '100');
assert.strictEqual(amountText({ percent: null, unlimited: false, total: 100 }), null);
assert.strictEqual(amountText({ percent: null, unlimited: true }), null);
//配色阈值边界：30红、31-69黄、70绿
assert.strictEqual(levelOf(30), 'red');
assert.strictEqual(levelOf(31), 'amber');
assert.strictEqual(levelOf(69), 'amber');
assert.strictEqual(levelOf(70), 'green');
assert.strictEqual(levelOf(null), 'none');
//时间格式
assert.strictEqual(timeUntil(undefined), '');
assert.strictEqual(timeUntil('not-a-date'), '');
assert.strictEqual(timeUntil(new Date(Date.now() - 1000).toISOString()), '已重置');
assert.strictEqual(timeUntil(new Date(Date.now() + 3 * 3600_000 + 60_000).toISOString()), '3h1m');
assert.strictEqual(timeAgo(new Date(Date.now() - 90_000).toISOString()), '1m ago');
//时钟偏差导致的"未来时间"夹到0，不显示负数
assert.strictEqual(timeAgo(new Date(Date.now() + 5000).toISOString()), '0s ago');

//PROVIDERS表里登记的每个logo都得真有对应文件，否则webview会渲染出裂图
//（比"没图标"更难看，而且只在那个provider的账号出现时才暴露）。
const LOGOS = join(__dirname, '../../vscode-extension/images/providers');
for (const [key, info] of Object.entries(PROVIDERS)) {
  if (info.logo) assert.ok(existsSync(join(LOGOS, info.logo)), `缺少logo素材: ${key} -> ${info.logo}`);
}
//未登记的provider不该抛错，回落成原文 + 无图，webview自己画首字母徽标
assert.deepStrictEqual(describeProvider('brand-new'), { service: 'brand-new', company: '未知' });
assert.strictEqual(providerLogo('brand-new'), null);
assert.strictEqual(providerLogo('claude'), 'claude.png');

console.log('format.test.ts passed');
