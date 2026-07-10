import { getLatestQuotes } from "@/lib/alpaca/client";
import type { AlpacaQuote } from "@/lib/alpaca/types";
import { TtlCache } from "@/lib/cache/ttl-cache";

const QUOTE_CACHE_TTL_MS = parsePositive(
  process.env.QUOTE_CACHE_TTL_MS,
  25_000,
);

const cache = new TtlCache<AlpacaQuote[]>(QUOTE_CACHE_TTL_MS);

function parsePositive(raw: string | undefined, fallback: number): number {
  const n = raw != null && raw.trim() !== "" ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n < 1000) return fallback;
  return Math.floor(n);
}

function cacheKey(symbols: string[]): string {
  return [...symbols].map((s) => s.toUpperCase()).sort().join(",");
}

/** Brief cache for Alpaca latest quotes (default 25s). */
export async function getCachedLatestQuotes(
  symbols: string[],
): Promise<AlpacaQuote[]> {
  if (symbols.length === 0) return [];
  const key = cacheKey(symbols);
  const hit = cache.get(key);
  if (hit) return hit;
  const quotes = await getLatestQuotes(symbols);
  cache.set(key, quotes);
  return quotes;
}

/** Test helper */
export function clearQuoteCacheForTests(): void {
  cache.clear();
}
