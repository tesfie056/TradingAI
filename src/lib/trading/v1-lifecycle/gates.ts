/**
 * Pre-entry gates for Version 1 lifecycle submission.
 * Pure checks — caller supplies current flags and broker facts.
 */

import { getV1LifecycleConfig } from "@/lib/trading/v1-lifecycle/config";
import type { V1PositionClassification } from "@/lib/trading/v1-lifecycle/types";

export type V1EntryGateInput = {
  paperUrlOk: boolean;
  marketOpen: boolean;
  minutesSinceOpen: number | null;
  minutesToClose: number | null;
  openEntryDelayMinutes: number;
  eodEntryCutoffMinutes: number;
  dataFresh: boolean;
  universeEligible: boolean;
  strategyIsBuy: boolean;
  strategyVersion: string;
  executionEnabled: boolean;
  autoTradingEnabled: boolean;
  emergencyStopActive: boolean;
  killSwitchActive: boolean;
  panicActive: boolean;
  reconciliationHealthy: boolean;
  hasOpenPosition: boolean;
  hasPendingEntry: boolean;
  hasPendingExit: boolean;
  maxOpenPositionsReached: boolean;
  maxDailyTradesReached: boolean;
  dailyLossLimitReached: boolean;
  consecutiveLossPause: boolean;
  buyingPowerSufficient: boolean;
  sizingPassed: boolean;
  stopLossValid: boolean;
  takeProfitValid: boolean;
  rewardToRisk: number | null;
  qtyPositive: boolean;
  fractionalOk: boolean;
  classification?: V1PositionClassification | null;
  /** Pause from lifecycle monitor (missing protection, etc.) */
  lifecyclePauseEntries?: boolean;
};

export type V1EntryGateResult = {
  ok: boolean;
  blockers: { code: string; message: string }[];
};

export function evaluateV1EntryGates(input: V1EntryGateInput): V1EntryGateResult {
  const blockers: { code: string; message: string }[] = [];
  const push = (code: string, message: string) => blockers.push({ code, message });

  if (!input.paperUrlOk) push("paper_only", "Alpaca paper URL required");
  if (!input.marketOpen) push("market_closed", "Market is closed");
  if (
    input.minutesSinceOpen != null &&
    input.minutesSinceOpen < input.openEntryDelayMinutes
  ) {
    push("open_delay", "Opening delay has not passed");
  }
  if (
    input.minutesToClose != null &&
    input.minutesToClose <= input.eodEntryCutoffMinutes
  ) {
    push("eod_entry_cutoff", "End-of-day entry cutoff active");
  }
  if (
    input.minutesToClose != null &&
    input.minutesToClose <= getV1LifecycleConfig().eodFlattenMinutes
  ) {
    push("eod_flatten_window", "End-of-day flatten window — new entries paused");
  }
  if (!input.dataFresh) push("stale_data", "Market data is not fresh");
  if (!input.universeEligible) push("universe", "Symbol not universe-eligible");
  if (!input.strategyIsBuy) push("not_buy", "Strategy result is not BUY-qualified");
  if (!input.strategyVersion) push("strategy_version", "Strategy version missing");
  if (!input.executionEnabled) push("execution_off", "Execution is disabled");
  if (!input.autoTradingEnabled) push("auto_off", "Auto Trading is disabled");
  if (input.emergencyStopActive) push("emergency_stop", "Emergency Stop is active");
  if (input.killSwitchActive) push("kill_switch", "Kill switch is active");
  if (input.panicActive) push("panic", "Panic mode is active");
  if (!input.reconciliationHealthy) {
    push("reconciliation", "Reconciliation is not healthy");
  }
  if (input.hasOpenPosition) push("open_position", "Existing position in symbol");
  if (input.hasPendingEntry) push("pending_entry", "Pending entry order exists");
  if (input.hasPendingExit) push("pending_exit", "Pending exit order exists");
  if (input.maxOpenPositionsReached) {
    push("max_positions", "Maximum open positions reached");
  }
  if (input.maxDailyTradesReached) {
    push("max_daily_trades", "Maximum daily trades reached");
  }
  if (input.dailyLossLimitReached) {
    push("daily_loss", "Daily loss limit reached");
  }
  if (input.consecutiveLossPause) {
    push("consecutive_loss", "Consecutive-loss pause is active");
  }
  if (!input.buyingPowerSufficient) {
    push("buying_power", "Buying power insufficient");
  }
  if (!input.sizingPassed) push("sizing", "Position sizing failed risk engine");
  if (!input.stopLossValid) push("stop_loss", "Stop-loss invalid for long entry");
  if (!input.takeProfitValid) {
    push("take_profit", "Take-profit invalid for long entry");
  }
  if (
    input.rewardToRisk == null ||
    input.rewardToRisk < getV1LifecycleConfig().minRewardToRisk
  ) {
    push("reward_to_risk", "Reward-to-risk below Version 1 minimum");
  }
  if (!input.qtyPositive) push("qty", "Quantity must be positive");
  if (!input.fractionalOk) {
    push("fractional", "Fractional quantity not supported for this asset");
  }
  if (input.classification?.blocksV1Buy) {
    push(
      "ownership_conflict",
      input.classification.reason || "Position ownership blocks Version 1 BUY",
    );
  }
  if (input.classification?.isLegacyAaplShort) {
    push(
      "legacy_aapl_short",
      "Existing AAPL short blocks Version 1 AAPL BUY",
    );
  }
  if (input.lifecyclePauseEntries) {
    push(
      "lifecycle_pause",
      "Lifecycle monitor paused new entries (protection/reconcile)",
    );
  }

  return { ok: blockers.length === 0, blockers };
}
