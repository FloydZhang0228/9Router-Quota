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
