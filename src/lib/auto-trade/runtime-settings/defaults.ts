/**
 * Build runtime settings defaults from environment (startup seed only).
 */

import { PAPER_SOAK_DEFAULTS } from "@/lib/config/paper-soak-profile";
import {
  DEFAULT_PAPER_SOAK_WATCHLIST,
  parseConfigurableWatchlist,
} from "@/lib/universe/paper-soak-watchlist";
import type { AutoTradeRuntimeSettings } from "@/lib/auto-trade/runtime-settings/types";

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  const n = raw != null && raw.trim() !== "" ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function parseNonNegInt(raw: string | undefined, fallback: number): number {
  const n = raw != null && raw.trim() !== "" ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function parseWatchlistEnv(): string[] {
  const soak = process.env.PAPER_SOAK_PROFILE === "true";
  if (soak) {
    return parseConfigurableWatchlist(
      process.env.PAPER_SOAK_WATCHLIST ?? process.env.SOAK_WATCHLIST,
      DEFAULT_PAPER_SOAK_WATCHLIST,
    );
  }
  const raw = process.env.WATCHLIST;
  if (!raw?.trim()) {
    return ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"];
  }
  return parseConfigurableWatchlist(raw, [
    "AAPL",
    "MSFT",
    "GOOGL",
    "AMZN",
    "NVDA",
  ]);
}

function soakNum(standard: number, soak: number): number {
  return process.env.PAPER_SOAK_PROFILE === "true" ? soak : standard;
}

/** Env-backed defaults used on first boot or reset. */
export function buildRuntimeSettingsFromEnv(): AutoTradeRuntimeSettings {
  const soak = process.env.PAPER_SOAK_PROFILE === "true";
  const confRaw = process.env.MIN_CONFIDENCE_FOR_AUTO_TRADE;
  let minConfidence = 0.75;
  if (confRaw != null && confRaw.trim() !== "") {
    const n = Number(confRaw);
    if (Number.isFinite(n) && n > 0) minConfidence = n > 1 ? n / 100 : n;
  }

  return {
    configVersion: 1,
    updatedAt: new Date().toISOString(),
    paperOnly: true,
    liveTradingAllowed: false,
    riskEngineRequired: true,
    bracketsRequired: true,

    executionEnabled: process.env.ENABLE_PAPER_ORDER_EXECUTION === "true",
    autoTradingEnabled: process.env.AUTO_PAPER_TRADING_ENABLED === "true",

    maxOpenPositions: parseNonNegInt(
      process.env.RISK_MAX_OPEN_POSITIONS,
      soakNum(3, PAPER_SOAK_DEFAULTS.maxOpenPositions),
    ),
    maxTradesPerDay: parseNonNegInt(
      process.env.MAX_DAILY_PAPER_TRADES,
      soakNum(3, PAPER_SOAK_DEFAULTS.maxDailyPaperTrades),
    ),
    maxRiskPerTradePct: parsePositiveNumber(
      process.env.RISK_MAX_RISK_PER_TRADE_PCT,
      soakNum(0.5, PAPER_SOAK_DEFAULTS.maxRiskPerTradePct),
    ),
    maxPositionAllocationPct: parsePositiveNumber(
      process.env.RISK_MAX_POSITION_ALLOCATION_PCT,
      soakNum(10, PAPER_SOAK_DEFAULTS.maxPositionAllocationPct),
    ),
    maxDailyLossPct: parsePositiveNumber(
      process.env.RISK_MAX_DAILY_LOSS_PCT,
      soakNum(2, PAPER_SOAK_DEFAULTS.maxDailyLossPct),
    ),
    consecutiveLossPause: parseNonNegInt(
      process.env.RISK_CONSECUTIVE_LOSS_PAUSE,
      3,
    ),
    longOnly:
      process.env.RISK_LONG_ONLY !== "false" &&
      (soak ? PAPER_SOAK_DEFAULTS.longOnly : true),
    regularHoursOnly:
      process.env.RISK_REGULAR_HOURS_ONLY !== "false" &&
      (soak ? PAPER_SOAK_DEFAULTS.regularHoursOnly : true),
    openEntryDelayMinutes: parseNonNegInt(
      process.env.RISK_OPEN_ENTRY_DELAY_MINUTES,
      soakNum(0, PAPER_SOAK_DEFAULTS.openEntryDelayMinutes),
    ),
    eodEntryCutoffMinutes: parseNonNegInt(
      process.env.RISK_EOD_ENTRY_CUTOFF_MINUTES,
      soakNum(30, PAPER_SOAK_DEFAULTS.eodEntryCutoffMinutes),
    ),

    scanIntervalOpenMs: (() => {
      const n = parseNonNegInt(process.env.MONITOR_INTERVAL_OPEN_MS, 90_000);
      return n < 60_000 ? 90_000 : n;
    })(),
    scanIntervalClosedMs: (() => {
      const n = parseNonNegInt(process.env.MONITOR_INTERVAL_CLOSED_MS, 900_000);
      return n < 60_000 ? 900_000 : n;
    })(),

    paperSoakProfile: soak,
    watchlist: parseWatchlistEnv(),

    minPrice: parsePositiveNumber(process.env.UNIVERSE_MIN_PRICE, 5),
    maxPrice: parsePositiveNumber(process.env.UNIVERSE_MAX_PRICE, 50),
    minAvgDailyVolume: parseNonNegInt(
      process.env.UNIVERSE_MIN_AVG_DAILY_VOLUME,
      1_000_000,
    ),
    maxSpreadPercent: parsePositiveNumber(
      process.env.UNIVERSE_MAX_SPREAD_PERCENT,
      0.5,
    ),
    excludeLeveragedInverseEtfs:
      process.env.UNIVERSE_EXCLUDE_LEVERAGED_ETFS !== "false",
    minEligibleSymbols: parseNonNegInt(process.env.UNIVERSE_MIN_ELIGIBLE, 5),

    defaultStopLossPct: parsePositiveNumber(
      process.env.RISK_DEFAULT_STOP_LOSS_PCT,
      1.5,
    ),
    defaultTakeProfitPct: parsePositiveNumber(
      process.env.RISK_DEFAULT_TAKE_PROFIT_PCT,
      3,
    ),
    allowSellAuto: process.env.ALLOW_SELL_AUTO === "true",
    minConfidence,
    cooldownMinutes: parseNonNegInt(process.env.AUTO_TRADE_COOLDOWN_MINUTES, 30),
  };
}

export const SETTINGS_META: {
  key: string;
  label: string;
  group: "risk" | "schedule" | "universe" | "strategy" | "controls" | "locked";
  applyMode: "immediate" | "restart_required" | "locked";
  help: string;
}[] = [
  {
    key: "executionEnabled",
    label: "Paper execution",
    group: "controls",
    applyMode: "immediate",
    help: "When OFF, no paper orders can be submitted (manual or auto).",
  },
  {
    key: "autoTradingEnabled",
    label: "Auto trading",
    group: "controls",
    applyMode: "immediate",
    help: "When OFF, scanning may continue but automatic entries are blocked.",
  },
  {
    key: "maxOpenPositions",
    label: "Max open positions",
    group: "risk",
    applyMode: "immediate",
    help: "Hard cap on concurrent open positions.",
  },
  {
    key: "maxTradesPerDay",
    label: "Max trades per day",
    group: "risk",
    applyMode: "immediate",
    help: "Maximum new paper trades per Eastern market day.",
  },
  {
    key: "maxRiskPerTradePct",
    label: "Risk per trade (%)",
    group: "risk",
    applyMode: "immediate",
    help: "Max equity risked to stop-loss on a single trade.",
  },
  {
    key: "maxPositionAllocationPct",
    label: "Max position allocation (%)",
    group: "risk",
    applyMode: "immediate",
    help: "Max notional as a percent of equity.",
  },
  {
    key: "maxDailyLossPct",
    label: "Daily loss limit (%)",
    group: "risk",
    applyMode: "immediate",
    help: "Stop new entries when realized+unrealized loss hits this % of equity.",
  },
  {
    key: "consecutiveLossPause",
    label: "Consecutive-loss pause",
    group: "risk",
    applyMode: "immediate",
    help: "Pause new entries after this many consecutive losing trades.",
  },
  {
    key: "longOnly",
    label: "Long only",
    group: "strategy",
    applyMode: "immediate",
    help: "When ON, short entries are rejected.",
  },
  {
    key: "regularHoursOnly",
    label: "Regular market hours only",
    group: "schedule",
    applyMode: "immediate",
    help: "Block new entries outside the regular US equity session.",
  },
  {
    key: "openEntryDelayMinutes",
    label: "Delay after open (min)",
    group: "schedule",
    applyMode: "immediate",
    help: "No new entries during the first N minutes after the open.",
  },
  {
    key: "eodEntryCutoffMinutes",
    label: "Stop before close (min)",
    group: "schedule",
    applyMode: "immediate",
    help: "No new entries during the last N minutes before the close.",
  },
  {
    key: "scanIntervalOpenMs",
    label: "Open-market scan interval (seconds)",
    group: "schedule",
    applyMode: "immediate",
    help: "How often to scan while the market is open. Minimum 60 seconds.",
  },
  {
    key: "scanIntervalClosedMs",
    label: "Closed-market scan interval (seconds)",
    group: "schedule",
    applyMode: "immediate",
    help: "How often to scan while the market is closed. Minimum 60 seconds.",
  },
  {
    key: "paperSoakProfile",
    label: "Paper soak profile",
    group: "strategy",
    applyMode: "immediate",
    help: "Conservative soak defaults hint; individual fields remain editable.",
  },
  {
    key: "watchlist",
    label: "Watchlist",
    group: "universe",
    applyMode: "immediate",
    help: "Comma-separated US equity symbols. Deduplicated and re-filtered each scan.",
  },
  {
    key: "minPrice",
    label: "Min stock price",
    group: "universe",
    applyMode: "immediate",
    help: "Universe hard floor.",
  },
  {
    key: "maxPrice",
    label: "Max stock price",
    group: "universe",
    applyMode: "immediate",
    help: "Universe hard ceiling.",
  },
  {
    key: "minAvgDailyVolume",
    label: "Min average daily volume",
    group: "universe",
    applyMode: "immediate",
    help: "Liquidity floor (shares).",
  },
  {
    key: "maxSpreadPercent",
    label: "Max spread (%)",
    group: "universe",
    applyMode: "immediate",
    help: "Maximum bid/ask spread as percent of mid.",
  },
  {
    key: "excludeLeveragedInverseEtfs",
    label: "Exclude leveraged/inverse ETFs",
    group: "universe",
    applyMode: "immediate",
    help: "Reject known leveraged and inverse ETF tickers.",
  },
  {
    key: "minEligibleSymbols",
    label: "Min eligible symbols warning",
    group: "universe",
    applyMode: "immediate",
    help: "Warn when fewer than this many symbols pass universe filters.",
  },
  {
    key: "liveTradingAllowed",
    label: "Live trading",
    group: "locked",
    applyMode: "locked",
    help: "Always blocked. Cannot be enabled from the UI.",
  },
  {
    key: "riskEngineRequired",
    label: "Risk engine",
    group: "locked",
    applyMode: "locked",
    help: "Always required. Cannot be disabled.",
  },
  {
    key: "bracketsRequired",
    label: "Bracket protection",
    group: "locked",
    applyMode: "locked",
    help: "Stop-loss and take-profit required on every new entry.",
  },
];
