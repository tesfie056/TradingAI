/** Simple in-memory TTL cache (per Node process). */

export type TtlCacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class TtlCache<T> {
  private store = new Map<string, TtlCacheEntry<T>>();

  constructor(private readonly defaultTtlMs: number) {}

  get(key: string, now = Date.now()): T | null {
    const row = this.store.get(key);
    if (!row) return null;
    if (row.expiresAt <= now) {
      this.store.delete(key);
      return null;
    }
    return row.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs, now = Date.now()): void {
    this.store.set(key, { value, expiresAt: now + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}
