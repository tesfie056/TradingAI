import {
  getMaxDailyPaperTrades,
  getMaxPaperTradeNotional,
  getWatchlist,
  isPaperOrderExecutionEnabled,
  PAPER_TRADING_BASE_URL,
} from "@/lib/config";
import { WIDE_SPREAD_HOLD_PCT } from "@/lib/market/data-quality";

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
  tradingEndpoint: string;
  safetyWarnings: string[];
};

export function getAppSettingsView(): AppSettingsView {
  const execution = isPaperOrderExecutionEnabled();
  const warnings = [
    "PAPER TRADE ONLY — not real money.",
    "Live trading endpoint api.alpaca.markets is blocked.",
    "Orders require manual confirmation — no automatic trading.",
    "Crypto, options, futures, and forex are out of scope.",
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
    tradingEndpoint: process.env.ALPACA_BASE_URL ?? PAPER_TRADING_BASE_URL,
    safetyWarnings: warnings,
  };
}
