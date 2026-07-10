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
import { getEffectiveRuntimeSettings } from "@/lib/auto-trade/runtime-settings/service";
import { getPaperSoakWatchlist } from "@/lib/universe/paper-soak-watchlist";

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

/**
 * Watchlist used for monitor / auto-trade scans.
 * Runtime settings take precedence; paper-soak overrides mega-cap defaults.
 */
export function getWatchlist(): string[] {
  const s = getEffectiveRuntimeSettings();
  if (s.paperSoakProfile) {
    const mega = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"];
    const isMega =
      s.watchlist.length === 0 ||
      (s.watchlist.length <= 5 &&
        s.watchlist.every((x) => mega.includes(x.toUpperCase())));
    if (isMega) {
      return getPaperSoakWatchlist();
    }
  }
  const list = s.watchlist;
  return list.length > 0 ? list : parseWatchlist(process.env.WATCHLIST);
}

/** Raw WATCHLIST env (ignores runtime override) — for locked/env display. */
export function getConfiguredWatchlistEnv(): string[] {
  return parseWatchlist(process.env.WATCHLIST);
}

export function isPaperOrderExecutionEnabled(): boolean {
  return getEffectiveRuntimeSettings().executionEnabled;
}

/**
 * When false (default), the AI Assistant stays trading-dashboard focused
 * and declines unrelated general chat.
 */
export function isGeneralAiModeEnabled(): boolean {
  return process.env.GENERAL_AI_MODE === "true";
}

export type OrderMode = "quantity" | "notional";

export type SmallAccountConfig = {
  enabled: boolean;
  defaultOrderMode: OrderMode;
  defaultNotionalAmount: number;
  maxNotionalPerTrade: number;
  minStockPrice: number;
  maxStockPrice: number;
  minAvgDailyVolume: number;
  maxSpreadPercent: number;
  avoidOtc: boolean;
  warnings: string[];
};

function parsePositiveNumber(
  raw: string | undefined,
  fallback: number,
): number {
  const n = raw != null && raw.trim() !== "" ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function isSmallAccountMode(): boolean {
  return process.env.SMALL_ACCOUNT_MODE === "true";
}

export function getDefaultOrderMode(): OrderMode {
  const raw = (process.env.DEFAULT_ORDER_MODE ?? "").toLowerCase();
  if (raw === "quantity" || raw === "notional") return raw;
  return "notional";
}

export function getDefaultNotionalAmount(): number {
  const n = parsePositiveNumber(process.env.DEFAULT_NOTIONAL_AMOUNT, 10);
  return Math.min(n, getMaxNotionalPerTrade());
}

/** Max USD per trade — tighter cap when small account mode is on. */
export function getMaxNotionalPerTrade(): number {
  if (isSmallAccountMode()) {
    return parsePositiveNumber(process.env.MAX_NOTIONAL_PER_TRADE, 25);
  }
  return getMaxPaperTradeNotional();
}

/** Max estimated USD notional per manual paper trade (default $500). */
export function getMaxPaperTradeNotional(): number {
  const raw = process.env.MAX_PAPER_TRADE_NOTIONAL;
  const n = raw != null && raw.trim() !== "" ? Number(raw) : 500;
  if (!Number.isFinite(n) || n <= 0) return 500;
  return n;
}

export function getMinStockPrice(): number {
  return parsePositiveNumber(process.env.MIN_STOCK_PRICE, 2);
}

export function getMaxStockPrice(): number {
  return parsePositiveNumber(process.env.MAX_STOCK_PRICE, 50);
}

export function getMinAvgDailyVolume(): number {
  const raw = process.env.MIN_AVG_DAILY_VOLUME;
  const n = raw != null && raw.trim() !== "" ? Number(raw) : 1_000_000;
  if (!Number.isFinite(n) || n < 0) return 1_000_000;
  return Math.floor(n);
}

/** Max spread as percent points (0.5 = 0.5%). */
export function getSmallAccountMaxSpreadPercent(): number {
  const raw = process.env.MAX_SPREAD_PERCENT;
  const n = raw != null && raw.trim() !== "" ? Number(raw) : 0.5;
  if (!Number.isFinite(n) || n <= 0) return 0.5;
  return n;
}

export function shouldAvoidOtc(): boolean {
  return process.env.AVOID_OTC !== "false";
}

export function getSmallAccountConfig(): SmallAccountConfig {
  const warnings = [
    "Low-priced stocks can be more volatile.",
    "Cheap does not mean safer.",
    "Fractional shares may be safer than chasing penny stocks.",
    "Paper trading only — not real money.",
    "Live trading remains blocked.",
  ];
  return {
    enabled: isSmallAccountMode(),
    defaultOrderMode: getDefaultOrderMode(),
    defaultNotionalAmount: getDefaultNotionalAmount(),
    maxNotionalPerTrade: getMaxNotionalPerTrade(),
    minStockPrice: getMinStockPrice(),
    maxStockPrice: getMaxStockPrice(),
    minAvgDailyVolume: getMinAvgDailyVolume(),
    maxSpreadPercent: getSmallAccountMaxSpreadPercent(),
    avoidOtc: shouldAvoidOtc(),
    warnings,
  };
}

/** Max auto/manual paper trades per Eastern market day. */
export function getMaxDailyPaperTrades(): number {
  return getEffectiveRuntimeSettings().maxTradesPerDay;
}

/** Phase 8 — automatic paper trading. Runtime-togglable; env seeds default. */
export function isAutoPaperTradingEnabled(): boolean {
  return getEffectiveRuntimeSettings().autoTradingEnabled;
}

/** Minimum AI confidence for auto trades (accepts 75 or 0.75). */
export function getMinConfidenceForAutoTrade(): number {
  return getEffectiveRuntimeSettings().minConfidence;
}

export function getAutoTradeCooldownMinutes(): number {
  return getEffectiveRuntimeSettings().cooldownMinutes;
}

/** Max estimated daily paper loss (USD) before auto trading pauses for the day. */
export function getMaxDailyPaperLoss(): number {
  const raw = process.env.MAX_DAILY_PAPER_LOSS;
  const n = raw != null && raw.trim() !== "" ? Number(raw) : 10;
  if (!Number.isFinite(n) || n <= 0) return 10;
  return n;
}

/** When false (default), auto SELL is disabled — BUY only until allowSellAuto. */
export function isAllowSellAuto(): boolean {
  return getEffectiveRuntimeSettings().allowSellAuto;
}

/** Default notional for auto paper orders (capped by max). */
export function getAutoDefaultNotionalAmount(): number {
  const n = parsePositiveNumber(process.env.DEFAULT_NOTIONAL_AMOUNT, 5);
  return Math.min(n, getAutoMaxNotionalPerTrade());
}

/** Max USD notional per auto paper trade. */
export function getAutoMaxNotionalPerTrade(): number {
  return parsePositiveNumber(process.env.MAX_NOTIONAL_PER_TRADE, 10);
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
