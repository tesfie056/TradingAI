/**
 * Version 1 daily completed round-trip tracking — types.
 *
 * Counting rule: a trade counts on the America/New_York market date of the
 * final exit fill (when P/L is realized). Deduplicate by tradeId.
 */

export type V1PnLClass = "win" | "loss" | "breakeven";

export type V1TargetFailureReasonCode =
  | "TARGET_IN_PROGRESS"
  | "NO_QUALIFIED_SETUP"
  | "MARKET_CLOSED"
  | "OPENING_DELAY"
  | "EOD_ENTRY_CUTOFF"
  | "NO_ELIGIBLE_SYMBOLS"
  | "DATA_UNAVAILABLE"
  | "DATA_STALE"
  | "SPREAD_TOO_WIDE"
  | "LIQUIDITY_TOO_LOW"
  | "VOLATILITY_UNSAFE"
  | "STRATEGY_THRESHOLD_NOT_MET"
  | "MAX_OPEN_POSITIONS"
  | "EXISTING_POSITION_CONFLICT"
  | "PENDING_ORDER_CONFLICT"
  | "COOLDOWN_ACTIVE"
  | "BUYING_POWER_INSUFFICIENT"
  | "DAILY_LOSS_LIMIT"
  | "CONSECUTIVE_LOSS_PAUSE"
  | "MAX_TRADES_REACHED"
  | "EXECUTION_DISABLED"
  | "AUTO_TRADING_DISABLED"
  | "EMERGENCY_STOP"
  | "KILL_SWITCH"
  | "PANIC_MODE"
  | "RECONCILIATION_REQUIRED"
  | "BROKER_UNAVAILABLE"
  | "ORDER_REJECTED"
  | "ENTRY_NOT_FILLED"
  | "POSITION_STILL_OPEN"
  | "EXIT_NOT_FILLED"
  | "MANUAL_INTERVENTION_REQUIRED"
  | "CONFIGURATION_CONFLICT";

export type V1TargetFailureReason = {
  code: V1TargetFailureReasonCode;
  message: string;
};

export type V1CountedTradeSummary = {
  tradeId: string;
  symbol: string;
  strategyVersion: string;
  exitReason: string | null;
  pnlClass: V1PnLClass;
  realizedGrossPnL: number | null;
  realizedNetPnL: number | null;
  fees: number | null;
  entryFilledAt: string;
  exitFilledAt: string;
  countedAt: string;
};

export type V1DailySessionAuditEvent = {
  at: string;
  event: string;
  detail: string;
  tradeId?: string;
};

export type V1DailySession = {
  paperOnly: true;
  sessionId: string;
  tradingDate: string;
  timezone: string;
  marketSession: {
    isOpen: boolean | null;
    note: string | null;
  };
  dailyCompletedTradeTarget: number;
  maxTradesPerDay: number;
  /** Hard-cap counter: entry submissions today (paper-trade-log). */
  entryAttemptsToday: number;
  /** Filled Version 1 entries still open or completed today (derived). */
  filledEntriesToday: number;
  /** Completed Version 1 round trips counted for the target. */
  completedTradesToday: number;
  remainingToTarget: number;
  targetReached: boolean;
  maxTradesReached: boolean;
  openV1Trades: number;
  pendingEntries: number;
  pendingExits: number;
  wins: number;
  losses: number;
  breakeven: number;
  grossRealizedPnL: number;
  fees: number | null;
  netRealizedPnL: number;
  averageProfitPerCompletedTrade: number | null;
  averageLossPerLosingTrade: number | null;
  largestWinningTrade: number | null;
  largestLosingTrade: number | null;
  consecutiveWins: number;
  consecutiveLosses: number;
  dailyLossLimitReached: boolean;
  tradingPaused: boolean;
  pauseReason: string | null;
  lastCompletedTradeAt: string | null;
  countedTradeIds: string[];
  countedTrades: V1CountedTradeSummary[];
  openTradeIds: string[];
  pendingTradeIds: string[];
  failureReasons: V1TargetFailureReason[];
  configurationWarnings: string[];
  status: "preliminary" | "final";
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  audit: V1DailySessionAuditEvent[];
};

export type V1DailyReport = {
  paperOnly: true;
  tradingDate: string;
  status: "preliminary" | "final";
  target: number;
  completed: number;
  remaining: number;
  targetReached: boolean;
  wins: number;
  losses: number;
  breakeven: number;
  realizedNetPnL: number;
  realizedGrossPnL: number;
  openOrUnresolved: number;
  whyTargetNotReached: V1TargetFailureReason[];
  safetyBlocks: V1TargetFailureReason[];
  completedTrades: V1CountedTradeSummary[];
  strategyNote: string;
  aaplShortExcluded: true;
  generatedAt: string;
};
