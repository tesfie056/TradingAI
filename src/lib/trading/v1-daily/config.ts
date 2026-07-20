/**
 * Version 1 daily completed-round-trip target configuration.
 * Progress target only — never forces trades or weakens safety.
 */

import { getMaxDailyPaperTrades } from "@/lib/config";
import { MARKET_TIMEZONE } from "@/lib/market/time";

export const V1_DAILY_TARGET_DEFAULT = 3 as const;

export type V1DailyConfig = {
  /** Desired completed Version 1 round trips per U.S. market day. */
  dailyCompletedTradeTarget: number;
  /**
   * Hard cap on entry submissions (existing paper-trade-log policy).
   * Distinct from the completed-trade target.
   */
  maxTradesPerDay: number;
  timezone: typeof MARKET_TIMEZONE;
  /** Absolute P/L within this band counts as breakeven. */
  breakevenTolerance: number;
};

export function getV1DailyConfig(): V1DailyConfig {
  const envTarget = process.env.V1_DAILY_COMPLETED_TRADE_TARGET?.trim();
  const parsed = envTarget ? Number(envTarget) : NaN;
  const dailyCompletedTradeTarget =
    Number.isFinite(parsed) && parsed >= 1
      ? Math.floor(parsed)
      : V1_DAILY_TARGET_DEFAULT;

  return {
    dailyCompletedTradeTarget,
    maxTradesPerDay: getMaxDailyPaperTrades(),
    timezone: MARKET_TIMEZONE,
    breakevenTolerance: 0.005,
  };
}

export type V1DailyConfigWarning = {
  code: "MAX_BELOW_TARGET" | "TARGET_INVALID";
  message: string;
};

export function getV1DailyConfigWarnings(
  cfg: V1DailyConfig = getV1DailyConfig(),
): V1DailyConfigWarning[] {
  const warnings: V1DailyConfigWarning[] = [];
  if (cfg.dailyCompletedTradeTarget < 1) {
    warnings.push({
      code: "TARGET_INVALID",
      message: "Daily completed-trade target must be at least 1.",
    });
  }
  if (cfg.maxTradesPerDay < cfg.dailyCompletedTradeTarget) {
    warnings.push({
      code: "MAX_BELOW_TARGET",
      message: `Maximum trades per day (${cfg.maxTradesPerDay}) is below the daily completed-trade target (${cfg.dailyCompletedTradeTarget}). New entries may hit the max before the goal is reachable.`,
    });
  }
  return warnings;
}
