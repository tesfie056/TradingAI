/**
 * Centralized risk-management engine — runs before every order.
 * Paper only. Never places orders itself.
 */

import { getRiskTradingConfig } from "@/lib/config/risk-config";
import { sizePosition } from "@/lib/risk/sizing";
import type { RiskRuntimeState } from "@/lib/risk/runtime";

export type TradeDirection = "long" | "short";

export type RiskProposalInput = {
  symbol: string;
  direction: TradeDirection;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  confidence: number;
  equity: number;
  openPositionCount: number;
  /** Symbols with an open position. */
  openSymbols: string[];
  /** Symbols with a pending entry order. */
  pendingEntrySymbols: string[];
  marketOpen: boolean;
  /** Minutes until regular session close; null if unknown/closed. */
  minutesToClose: number | null;
  /** Minutes since regular session open; null if unknown/closed. */
  minutesSinceOpen: number | null;
  riskRuntime: RiskRuntimeState;
  /** When false, block until reconciliation finishes. */
  reconciliationComplete: boolean;
  maxNotionalCap?: number;
};

export type RiskRejectionCode =
  | "reconciliation_pending"
  | "entries_paused"
  | "consecutive_losses"
  | "market_closed"
  | "open_delay"
  | "eod_cutoff"
  | "max_open_positions"
  | "duplicate_position"
  | "pending_entry"
  | "daily_loss_limit"
  | "invalid_prices"
  | "missing_stop_or_target"
  | "bad_risk_reward"
  | "zero_size"
  | "short_not_supported";

export type RiskValidationResult = {
  approved: boolean;
  code: RiskRejectionCode | null;
  reason: string | null;
  qty: number;
  notional: number;
  riskAmount: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskRewardRatio: number | null;
};

function rrRatio(
  direction: TradeDirection,
  entry: number,
  stop: number,
  target: number,
): number | null {
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (risk <= 0) return null;
  return Number((reward / risk).toFixed(3));
}

/**
 * Validate and size a trade proposal. Does not submit orders.
 */
export function evaluateRiskProposal(
  input: RiskProposalInput,
): RiskValidationResult {
  const cfg = getRiskTradingConfig();
  const symbol = input.symbol.toUpperCase();

  const reject = (
    code: RiskRejectionCode,
    reason: string,
  ): RiskValidationResult => ({
    approved: false,
    code,
    reason,
    qty: 0,
    notional: 0,
    riskAmount: 0,
    stopLossPrice: input.stopLossPrice,
    takeProfitPrice: input.takeProfitPrice,
    riskRewardRatio: rrRatio(
      input.direction,
      input.entryPrice,
      input.stopLossPrice,
      input.takeProfitPrice,
    ),
  });

  if (!input.reconciliationComplete) {
    return reject(
      "reconciliation_pending",
      "Waiting for startup reconciliation before new entries",
    );
  }

  if (input.riskRuntime.entriesPaused) {
    return reject(
      "entries_paused",
      input.riskRuntime.pauseReason ?? "New entries are paused",
    );
  }

  if (input.riskRuntime.consecutiveLosses >= cfg.consecutiveLossPause) {
    return reject(
      "consecutive_losses",
      `Paused after ${input.riskRuntime.consecutiveLosses} consecutive losses`,
    );
  }

  if (cfg.regularHoursOnly && !input.marketOpen) {
    return reject("market_closed", "Regular market hours only — market closed");
  }

  if (
    input.marketOpen &&
    cfg.openEntryDelayMinutes > 0 &&
    input.minutesSinceOpen != null &&
    input.minutesSinceOpen < cfg.openEntryDelayMinutes
  ) {
    return reject(
      "open_delay",
      `No new entries during the first ${cfg.openEntryDelayMinutes} minutes after open`,
    );
  }

  if (
    input.marketOpen &&
    input.minutesToClose != null &&
    input.minutesToClose <= cfg.eodEntryCutoffMinutes
  ) {
    return reject(
      "eod_cutoff",
      `No new entries within ${cfg.eodEntryCutoffMinutes} minutes of close`,
    );
  }

  if (cfg.longOnly && input.direction === "short") {
    return reject(
      "short_not_supported",
      "Long trades only — short entries are disabled",
    );
  }

  if (input.direction === "short") {
    return reject(
      "short_not_supported",
      "Short entries are not enabled in this paper stage",
    );
  }

  if (input.openPositionCount >= cfg.maxOpenPositions) {
    return reject(
      "max_open_positions",
      `Max open positions reached (${cfg.maxOpenPositions})`,
    );
  }

  if (input.openSymbols.map((s) => s.toUpperCase()).includes(symbol)) {
    return reject(
      "duplicate_position",
      `Already have an open position in ${symbol}`,
    );
  }

  if (input.pendingEntrySymbols.map((s) => s.toUpperCase()).includes(symbol)) {
    return reject(
      "pending_entry",
      `Entry order already pending for ${symbol}`,
    );
  }

  const dailyPnL =
    input.riskRuntime.dailyRealizedPnL + input.riskRuntime.dailyUnrealizedPnL;
  const maxDailyLoss = input.equity * (cfg.maxDailyLossPct / 100);
  if (input.equity > 0 && dailyPnL <= -maxDailyLoss) {
    return reject(
      "daily_loss_limit",
      `Daily loss limit reached (${cfg.maxDailyLossPct}% of equity)`,
    );
  }

  const entry = input.entryPrice;
  const stop = input.stopLossPrice;
  const target = input.takeProfitPrice;
  if (!(entry > 0 && stop > 0 && target > 0)) {
    return reject("invalid_prices", "Entry, stop-loss, and take-profit required");
  }
  if (stop >= entry) {
    return reject(
      "missing_stop_or_target",
      "Long stop-loss must be below entry",
    );
  }
  if (target <= entry) {
    return reject(
      "missing_stop_or_target",
      "Long take-profit must be above entry",
    );
  }

  const ratio = rrRatio(input.direction, entry, stop, target);
  if (ratio == null || ratio < 1) {
    return reject(
      "bad_risk_reward",
      `Risk/reward ${ratio ?? 0} must be at least 1.0`,
    );
  }

  const sized = sizePosition({
    equity: input.equity,
    entryPrice: entry,
    stopLossPrice: stop,
    maxNotionalCap: input.maxNotionalCap,
  });

  if (sized.qty <= 0 || sized.notional <= 0) {
    return reject("zero_size", "Position size calculated to zero");
  }

  return {
    approved: true,
    code: null,
    reason: null,
    qty: sized.qty,
    notional: sized.notional,
    riskAmount: sized.riskAmount,
    stopLossPrice: stop,
    takeProfitPrice: target,
    riskRewardRatio: ratio,
  };
}

/** Regular US equity session length in minutes (9:30–16:00 ET). */
export const REGULAR_SESSION_MINUTES = 6.5 * 60;

/** Minutes from now until a clock close ISO timestamp. */
export function minutesUntilClose(closeAtIso: string | null | undefined): number | null {
  if (!closeAtIso) return null;
  const t = Date.parse(closeAtIso);
  if (Number.isNaN(t)) return null;
  return (t - Date.now()) / 60_000;
}

/**
 * Estimate minutes since regular open from minutes-to-close.
 * Uses the standard 6.5h RTH session when the market is open.
 */
export function minutesSinceOpenFromClose(
  minutesToClose: number | null,
  marketOpen: boolean,
): number | null {
  if (!marketOpen || minutesToClose == null) return null;
  return REGULAR_SESSION_MINUTES - minutesToClose;
}
