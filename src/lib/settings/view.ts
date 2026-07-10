import {
  getMaxDailyPaperTrades,
  getMaxPaperTradeNotional,
  getWatchlist,
  isPaperOrderExecutionEnabled,
  PAPER_TRADING_BASE_URL,
} from "@/lib/config";
import { WIDE_SPREAD_HOLD_PCT } from "@/lib/market/data-quality";
import { getNewsProviderName } from "@/lib/news";
import { getAiProviderName } from "@/lib/ai/provider";

export type AppSettingsView = {
  paperOnly: true;
  liveTradingAllowed: false;
  automaticTradingAllowed: false;
  assetClass: "us_equity";
  watchlist: string[];
  watchlistEnv: string;
  maxTradeAmount: number;
  maxDailyPaperTrades: number;
  /** Display default; decisions use engine thresholds. */
  minConfidenceDefault: number;
  maxSpreadAllowed: number;
  orderExecutionEnabled: boolean;
  /** Hostname only — never includes API keys. */
  tradingEndpointHost: string;
  tradingEndpoint: string;
  newsProviderConfigured: "mock" | "finnhub" | "none";
  aiProviderConfigured: "heuristic" | "ollama";
  safetyWarnings: string[];
  /** Explicit: secrets are never returned by this endpoint. */
  secretsExposed: false;
};

function endpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

export function getAppSettingsView(): AppSettingsView {
  const execution = isPaperOrderExecutionEnabled();
  const baseUrl = process.env.ALPACA_BASE_URL ?? PAPER_TRADING_BASE_URL;
  const warnings = [
    "PAPER TRADE ONLY — not real money.",
    "Live trading endpoint api.alpaca.markets is blocked.",
    "Orders require manual confirmation — no automatic trading.",
    "Crypto, options, futures, and forex are out of scope.",
    "API keys are never shown in Settings — edit .env.local on the server only.",
    execution
      ? "Order execution is ON for paper only. Keep keys paper-scoped."
      : "Order execution is OFF by default. Set ENABLE_PAPER_ORDER_EXECUTION=true in .env.local to allow manual paper submits.",
  ];

  return {
    paperOnly: true,
    liveTradingAllowed: false,
    automaticTradingAllowed: false,
    assetClass: "us_equity",
    watchlist: getWatchlist(),
    watchlistEnv: process.env.WATCHLIST ?? "AAPL,MSFT,GOOGL,AMZN,NVDA",
    maxTradeAmount: getMaxPaperTradeNotional(),
    maxDailyPaperTrades: getMaxDailyPaperTrades(),
    minConfidenceDefault: 0.45,
    maxSpreadAllowed: WIDE_SPREAD_HOLD_PCT,
    orderExecutionEnabled: execution,
    tradingEndpoint: baseUrl,
    tradingEndpointHost: endpointHost(baseUrl),
    newsProviderConfigured: getNewsProviderName(),
    aiProviderConfigured: getAiProviderName(),
    safetyWarnings: warnings,
    secretsExposed: false,
  };
}
