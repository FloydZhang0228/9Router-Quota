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
