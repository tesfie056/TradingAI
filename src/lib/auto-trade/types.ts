/**
 * Phase 8 — automatic paper trading types.
 * Auto trading is paper-only and disabled by default.
 */

import type { OrderMode } from "@/lib/config";
import type { AutoTradeBlockSummary } from "@/lib/auto-trade/block-summary";
import type { AutoTradeAnalytics } from "@/lib/performance/auto-trade-analytics";
import type { LastScanSnapshot } from "@/lib/monitor/scan-snapshot";
import type { MonitorOpportunity } from "@/lib/monitor/types";
import type { RankedCandidate } from "@/lib/trading/candidates";
import type { OrphanPosition } from "@/lib/trading/reconcile";
import type { PaperTestResultsSnapshot } from "@/lib/trading/session-report";
import type {
  AutoTradeRuntimeSettings,
  EngineControlSnapshot,
} from "@/lib/auto-trade/runtime-settings/types";

export type TraderDashboardSnapshot = {
  mode: "paper";
  /** True when the latest Alpaca paper account/positions fetch succeeded. */
  alpacaConnected: boolean;
  marketOpen: boolean | null;
  symbolsScanned: number;
  qualifiedSymbols: number;
  topCandidates: RankedCandidate[];
  openPositions: {
    symbol: string;
    qty: number;
    marketValue: number | null;
    unrealizedPl: number | null;
  }[];
  pendingOrders: {
    id: string;
    symbol: string;
    side: string;
    status: string;
    qty: string | null;
  }[];
  buyingPower: number | null;
  equity: number | null;
  dailyPnL: number;
  dailyLossLimitUsagePct: number | null;
  consecutiveWins: number;
  consecutiveLosses: number;
  engineAction: string;
  lastScanAt: string | null;
  nextScanAt: string | null;
  reconciliationComplete: boolean;
  orphanedPositions: OrphanPosition[];
  openPositionsPreservedNote: string | null;
  universe: {
    watchlistSize: number;
    staticPassed: number;
    rejectedByPrice: number;
    rejectedByLiquidity: number;
    rejectedBySpread: number;
    eligibleCount: number;
    ineligibleCount: number;
    eligibleSymbols: string[];
    ineligibleSymbols: string[];
    configuredSymbols: string[];
    symbols: {
      symbol: string;
      name: string | null;
      status: "eligible" | "ineligible";
      price: number | null;
      userReason: string | null;
    }[];
    warnings: string[];
    evaluatedAt: string | null;
    dataFreshness: string | null;
    marketOpen: boolean | null;
    filterConfig: {
      minPrice: number;
      maxPrice: number;
      minAvgDailyVolume: number;
      maxSpreadPercent: number;
    } | null;
  } | null;
};

export type AutoTradeSkipCode =
  | "auto_trading_disabled"
  | "execution_disabled"
  | "kill_switch_active"
  | "panic_stop_active"
  | "runtime_disabled"
  | "live_endpoint"
  | "market_closed"
  | "market_status_unavailable"
  | "stale_quote"
  | "wide_spread"
  | "high_risk"
  | "hold_action"
  | "watch_action"
  | "low_confidence"
  | "not_ready"
  | "sell_auto_disabled"
  | "duplicate_opportunity"
  | "duplicate_symbol"
  | "symbol_cooldown"
  | "max_daily_trades"
  | "max_daily_loss"
  | "insufficient_buying_power"
  | "no_position_to_sell"
  | "average_down_blocked"
  | "revenge_trade_blocked"
  | "missing_data"
  | "max_notional"
  | "missing_price"
  | "order_rejected";

export type AutoTradeBlocker = {
  code: AutoTradeSkipCode;
  message: string;
};

export type AutoTradeEligibility = {
  eligible: boolean;
  blockers: AutoTradeBlocker[];
  warnings: string[];
};

export type AutoTradeDecisionStatus =
  | "pending"
  | "submitted"
  | "filled"
  | "rejected"
  | "skipped";

export type AutoTradeDecision = {
  id: string;
  opportunityId: string;
  symbol: string;
  action: "BUY" | "SELL";
  orderMode: OrderMode;
  notional: number;
  confidence: number;
  reason: string;
  status: AutoTradeDecisionStatus;
  blockers: AutoTradeBlocker[];
  createdAt: string;
  submittedAt: string | null;
  orderId: string | null;
  orderStatus: string | null;
  filledAvgPrice: string | null;
  estimatedPnL: number | null;
  paperOnly: true;
};

export type AutoTradeLogEvent =
  | "opportunity_detected"
  | "eligibility_passed"
  | "eligibility_failed"
  | "decision_saved"
  | "order_submitted"
  | "order_filled"
  | "order_rejected"
  | "skipped"
  | "kill_switch_activated"
  | "panic_stop_activated"
  | "auto_trading_stopped"
  | "auto_trading_resumed"
  | "daily_limit_reached"
  | "daily_loss_limit_reached"
  | "symbol_scanned";

export type AutoTradeLogLevel = "info" | "warn" | "error";

export type AutoTradeLogEntry = {
  id: string;
  event: AutoTradeLogEvent;
  level: AutoTradeLogLevel;
  message: string;
  timestamp: string;
  paperOnly: true;
  symbol?: string;
  opportunityId?: string;
  skipCode?: AutoTradeSkipCode;
  meta?: Record<string, string | number | boolean | null>;
};

export type AutoTradeRuntimeState = {
  killSwitch: boolean;
  panicStop: boolean;
  runtimeDisabled: boolean;
  killSwitchAt: string | null;
  panicStopAt: string | null;
  lastAutoTradeAt: string | null;
  lastAutoTradeSymbol: string | null;
  dailyEstimatedPnL: number;
  dailyPnLDate: string;
};

export type AutoTradeStatus = {
  paperOnly: true;
  liveTradingAllowed: false;
  envEnabled: boolean;
  executionEnabled: boolean;
  effectivelyEnabled: boolean;
  killSwitch: boolean;
  panicStop: boolean;
  runtimeDisabled: boolean;
  defaultOrderMode: OrderMode;
  defaultNotional: number;
  maxNotionalPerTrade: number;
  maxDailyTrades: number;
  dailyTradesUsed: number;
  maxDailyLoss: number;
  dailyEstimatedPnL: number;
  minConfidence: number;
  cooldownMinutes: number;
  allowSellAuto: boolean;
  lastAutoTrade: AutoTradeDecision | null;
  nextEligibleAt: string | null;
  activeCooldowns: { symbol: string; side: "BUY" | "SELL"; until: string }[];
  recentDecisions: AutoTradeDecision[];
  recentLogs: AutoTradeLogEntry[];
  strategyVersion: string;
  analytics: AutoTradeAnalytics;
  /** Last full watchlist scan with every symbol ranked. */
  lastScan: LastScanSnapshot | null;
  topSignalLabel: string;
  blockSummary: AutoTradeBlockSummary;
  trader: TraderDashboardSnapshot;
  paperTest: PaperTestResultsSnapshot;
  /** Unified control plane — UI must derive badges from this. */
  engine: EngineControlSnapshot;
  runtimeSettings: AutoTradeRuntimeSettings;
};

export type ProcessAutoTradeInput = {
  opportunities: MonitorOpportunity[];
  marketOpen: boolean;
};

export type ProcessAutoTradeResult = {
  processed: number;
  submitted: number;
  skipped: number;
  decisions: AutoTradeDecision[];
};
