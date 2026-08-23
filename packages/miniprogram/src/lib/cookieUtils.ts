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
