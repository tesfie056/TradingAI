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

import { filterUsStockSymbols } from "@/lib/stocks/universe";

/** Parse a comma-separated U.S. stock watchlist (crypto/non-equity rejected). */
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

  const stocksOnly = filterUsStockSymbols(symbols);

  return stocksOnly.length > 0
    ? stocksOnly
    : ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"];
}

export function getWatchlist(): string[] {
  return parseWatchlist(process.env.WATCHLIST);
}

export function isPaperOrderExecutionEnabled(): boolean {
  return process.env.ENABLE_PAPER_ORDER_EXECUTION === "true";
}

/**
 * When false (default), the AI Assistant stays trading-dashboard focused
 * and declines unrelated general chat.
 */
export function isGeneralAiModeEnabled(): boolean {
  return process.env.GENERAL_AI_MODE === "true";
}

/** Max estimated USD notional per manual paper trade (default $500). */
export function getMaxPaperTradeNotional(): number {
  const raw = process.env.MAX_PAPER_TRADE_NOTIONAL;
  const n = raw != null && raw.trim() !== "" ? Number(raw) : 500;
  if (!Number.isFinite(n) || n <= 0) return 500;
  return n;
}

/** Max manual paper trades per UTC day (default 5). */
export function getMaxDailyPaperTrades(): number {
  const raw = process.env.MAX_DAILY_PAPER_TRADES;
  const n = raw != null && raw.trim() !== "" ? Number(raw) : 5;
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.floor(n);
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
