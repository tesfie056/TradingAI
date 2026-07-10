import { TtlCache } from "@/lib/cache/ttl-cache";
import {
  fetchWatchlistNews,
  type WatchlistNewsResult,
} from "@/lib/news";

const NEWS_CACHE_TTL_MS = parsePositive(
  process.env.NEWS_CACHE_TTL_MS,
  5 * 60_000,
);

const cache = new TtlCache<WatchlistNewsResult>(NEWS_CACHE_TTL_MS);

function parsePositive(raw: string | undefined, fallback: number): number {
  const n = raw != null && raw.trim() !== "" ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n < 10_000) return fallback;
  return Math.floor(n);
}

function cacheKey(symbols: string[]): string {
  return [...symbols].map((s) => s.toUpperCase()).sort().join(",");
}

/** Cache Finnhub/mock watchlist news (default 5 min). */
export async function getCachedWatchlistNews(
  symbols: string[],
): Promise<WatchlistNewsResult> {
  if (symbols.length === 0) {
    return fetchWatchlistNews(symbols);
  }
  const key = cacheKey(symbols);
  const hit = cache.get(key);
  if (hit) return hit;
  const result = await fetchWatchlistNews(symbols);
  cache.set(key, result);
  return result;
}

/** Test helper */
export function clearNewsCacheForTests(): void {
  cache.clear();
}
