/**
 * Structured reasons why the daily completed-trade target is incomplete.
 * Multiple reasons may apply. Never reduces to a generic “missed target”.
 */

import type {
  V1DailySession,
  V1TargetFailureReason,
  V1TargetFailureReasonCode,
} from "@/lib/trading/v1-daily/types";

const MESSAGES: Record<V1TargetFailureReasonCode, string> = {
  TARGET_IN_PROGRESS: "Daily goal is still in progress.",
  NO_QUALIFIED_SETUP: "No Version 1 BUY setup met the strategy thresholds.",
  MARKET_CLOSED: "Market is closed — new entries are blocked.",
  OPENING_DELAY: "Opening delay is active — new entries wait after the open.",
  EOD_ENTRY_CUTOFF: "End-of-day entry cutoff is active.",
  NO_ELIGIBLE_SYMBOLS: "No symbols passed the Version 1 universe filters.",
  DATA_UNAVAILABLE: "Market data was unavailable for evaluation.",
  DATA_STALE: "Market data was stale during the open session.",
  SPREAD_TOO_WIDE: "Bid/ask spreads were too wide for safe entry.",
  LIQUIDITY_TOO_LOW: "Liquidity was too low for Version 1 entries.",
  VOLATILITY_UNSAFE: "Volatility was outside the Version 1 safe band.",
  STRATEGY_THRESHOLD_NOT_MET: "Strategy score/conditions did not reach BUY.",
  MAX_OPEN_POSITIONS: "Maximum open positions limit is reached.",
  EXISTING_POSITION_CONFLICT: "An existing position conflicted with a new entry.",
  PENDING_ORDER_CONFLICT: "A pending order conflicted with a new entry.",
  COOLDOWN_ACTIVE: "Symbol or trade cooldown is active.",
  BUYING_POWER_INSUFFICIENT: "Buying power was insufficient.",
  DAILY_LOSS_LIMIT: "Daily loss limit paused new entries.",
  CONSECUTIVE_LOSS_PAUSE: "Consecutive-loss pause is active.",
  MAX_TRADES_REACHED: "Maximum daily entry submissions were reached.",
  EXECUTION_DISABLED: "Paper execution is disabled.",
  AUTO_TRADING_DISABLED: "Auto Trading is disabled.",
  EMERGENCY_STOP: "Emergency Stop is active.",
  KILL_SWITCH: "Kill switch is active.",
  PANIC_MODE: "Panic mode is active.",
  RECONCILIATION_REQUIRED: "Reconciliation is required before new entries.",
  BROKER_UNAVAILABLE: "Broker was unavailable.",
  ORDER_REJECTED: "One or more entry orders were rejected.",
  ENTRY_NOT_FILLED: "An entry was accepted but not filled.",
  POSITION_STILL_OPEN: "A Version 1 position is still open.",
  EXIT_NOT_FILLED: "An exit was submitted but not fully filled.",
  MANUAL_INTERVENTION_REQUIRED: "Manual intervention is required on a trade.",
  CONFIGURATION_CONFLICT: "Daily target and maximum-trade settings conflict.",
};

export function reason(
  code: V1TargetFailureReasonCode,
  message?: string,
): V1TargetFailureReason {
  return { code, message: message ?? MESSAGES[code] };
}

export type FailureContext = {
  marketOpen?: boolean | null;
  executionEnabled?: boolean;
  autoTradingEnabled?: boolean;
  emergencyStop?: boolean;
  killSwitch?: boolean;
  panic?: boolean;
  reconciliationHealthy?: boolean;
  eligibleSymbolCount?: number | null;
  configConflict?: boolean;
  dailyLossLimitReached?: boolean;
  consecutiveLossPause?: boolean;
  maxTradesReached?: boolean;
  hasOpenV1?: boolean;
  hasPendingEntry?: boolean;
  hasPendingExit?: boolean;
  hasManualIntervention?: boolean;
  hasRejectedEntry?: boolean;
  hasUnfilledEntry?: boolean;
  noQualifiedSetup?: boolean;
};

/**
 * Build failure / incomplete reasons for the current session progress.
 * Does not invent strategy details — caller supplies observed context.
 */
export function buildTargetFailureReasons(
  session: Pick<
    V1DailySession,
    | "completedTradesToday"
    | "dailyCompletedTradeTarget"
    | "targetReached"
    | "openV1Trades"
    | "pendingEntries"
    | "pendingExits"
    | "configurationWarnings"
    | "maxTradesReached"
  >,
  ctx: FailureContext = {},
): V1TargetFailureReason[] {
  if (session.targetReached) return [];

  const out: V1TargetFailureReason[] = [];
  const push = (code: V1TargetFailureReasonCode, message?: string) => {
    if (!out.some((r) => r.code === code)) out.push(reason(code, message));
  };

  push("TARGET_IN_PROGRESS");

  if (session.configurationWarnings.length > 0 || ctx.configConflict) {
    push("CONFIGURATION_CONFLICT");
  }
  if (ctx.marketOpen === false) push("MARKET_CLOSED");
  if (ctx.executionEnabled === false) push("EXECUTION_DISABLED");
  if (ctx.autoTradingEnabled === false) push("AUTO_TRADING_DISABLED");
  if (ctx.emergencyStop) push("EMERGENCY_STOP");
  if (ctx.killSwitch) push("KILL_SWITCH");
  if (ctx.panic) push("PANIC_MODE");
  if (ctx.reconciliationHealthy === false) push("RECONCILIATION_REQUIRED");
  if (ctx.eligibleSymbolCount === 0) push("NO_ELIGIBLE_SYMBOLS");
  if (ctx.dailyLossLimitReached) push("DAILY_LOSS_LIMIT");
  if (ctx.consecutiveLossPause) push("CONSECUTIVE_LOSS_PAUSE");
  if (ctx.maxTradesReached || session.maxTradesReached) {
    push("MAX_TRADES_REACHED");
  }
  if (ctx.hasOpenV1 || session.openV1Trades > 0) push("POSITION_STILL_OPEN");
  if (ctx.hasPendingEntry || session.pendingEntries > 0) {
    push("ENTRY_NOT_FILLED");
  }
  if (ctx.hasPendingExit || session.pendingExits > 0) push("EXIT_NOT_FILLED");
  if (ctx.hasManualIntervention) push("MANUAL_INTERVENTION_REQUIRED");
  if (ctx.hasRejectedEntry) push("ORDER_REJECTED");
  if (ctx.hasUnfilledEntry) push("ENTRY_NOT_FILLED");
  if (ctx.noQualifiedSetup) push("NO_QUALIFIED_SETUP");

  return out;
}

export function safetyBlocksOnly(
  reasons: V1TargetFailureReason[],
): V1TargetFailureReason[] {
  const safety = new Set<V1TargetFailureReasonCode>([
    "DAILY_LOSS_LIMIT",
    "CONSECUTIVE_LOSS_PAUSE",
    "EMERGENCY_STOP",
    "KILL_SWITCH",
    "PANIC_MODE",
    "RECONCILIATION_REQUIRED",
    "EXECUTION_DISABLED",
    "AUTO_TRADING_DISABLED",
    "MAX_TRADES_REACHED",
    "CONFIGURATION_CONFLICT",
    "MARKET_CLOSED",
  ]);
  return reasons.filter((r) => safety.has(r.code));
}
