/**
 * App configuration. Trading is paper-only — see safety guard.
 */

export const PAPER_TRADING_BASE_URL = "https://paper-api.alpaca.markets";
export const MARKET_DATA_BASE_URL = "https://data.alpaca.markets";

/** Hosts that must never be used for trading requests. */
export const BLOCKED_TRADING_HOSTS = [
  "api.alpaca.markets",
  "api.alpaca.markets/",
] as const;

/** Parse a comma-separated watchlist string into uppercase symbols. */
export function parseWatchlist(raw: string | undefined | null): string[] {
  if (!raw || !raw.trim()) {
    return ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"];
  }

  const seen = new Set<string>();
  const symbols: string[] = [];

  for (const part of raw.split(",")) {
    const symbol = part.trim().toUpperCase();
    if (!symbol) continue;
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
  }

  return symbols.length > 0
    ? symbols
    : ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"];
}

export function getWatchlist(): string[] {
  return parseWatchlist(process.env.WATCHLIST);
}

export function isPaperOrderExecutionEnabled(): boolean {
  return process.env.ENABLE_PAPER_ORDER_EXECUTION === "true";
}

export function getAlpacaCredentials() {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  const baseUrl = process.env.ALPACA_BASE_URL ?? PAPER_TRADING_BASE_URL;

  if (!apiKey || !secretKey) {
    throw new Error(
      "Missing ALPACA_API_KEY or ALPACA_SECRET_KEY. Copy .env.example to .env.local and add paper keys.",
    );
  }

  return { apiKey, secretKey, baseUrl };
}
