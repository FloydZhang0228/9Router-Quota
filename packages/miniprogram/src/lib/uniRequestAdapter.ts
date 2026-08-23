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
