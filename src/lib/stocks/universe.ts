/**
 * U.S. stocks only — crypto, options, futures, and forex are out of scope.
 */

/** Common crypto / non-equity tickers that must never enter the watchlist. */
const BLOCKED_NON_STOCK_SYMBOLS = new Set([
  "BTC",
  "BTCUSD",
  "ETH",
  "ETHUSD",
  "SOL",
  "SOLUSD",
  "DOGE",
  "DOGEUSD",
  "XRP",
  "ADA",
  "AVAX",
  "DOT",
  "LINK",
  "MATIC",
  "UNI",
  "SHIB",
  "LTC",
  "BCH",
  "USDT",
  "USDC",
]);

const CRYPTO_SUFFIX = /(USD|USDT|USDC|BTC|ETH)$/i;

export function isBlockedNonStockSymbol(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  if (!s) return true;
  if (BLOCKED_NON_STOCK_SYMBOLS.has(s)) return true;
  // Alpaca crypto pairs often look like BTC/USD — reject slash forms.
  if (s.includes("/")) return true;
  if (CRYPTO_SUFFIX.test(s) && s.length > 5) return true;
  return false;
}

/** Keep only plausible U.S. equity tickers (unique, uppercase, order preserved). */
export function filterUsStockSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of symbols) {
    const symbol = s.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) continue;
    if (isBlockedNonStockSymbol(symbol)) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

export const MARKET_BENCHMARK_SYMBOLS = ["SPY", "QQQ"] as const;
