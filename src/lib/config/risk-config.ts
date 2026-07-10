/**
 * Single configuration layer for paper auto-trading risk + universe.
 * Prefers runtime settings (no restart); env seeds defaults on first boot.
 * Paper only — never enables live trading.
 */

import { getEffectiveRuntimeSettings } from "@/lib/auto-trade/runtime-settings/service";

export type RiskTradingConfig = {
  minPrice: number;
  maxPrice: number;
  minAvgDailyVolume: number;
  maxSpreadPercent: number;
  excludeLeveragedInverseEtfs: boolean;
  requireShortableWhenShorting: boolean;
  maxOpenPositions: number;
  maxRiskPerTradePct: number;
  maxPositionAllocationPct: number;
  maxDailyLossPct: number;
  consecutiveLossPause: number;
  openEntryDelayMinutes: number;
  eodEntryCutoffMinutes: number;
  regularHoursOnly: boolean;
  longOnly: boolean;
  defaultStopLossPct: number;
  defaultTakeProfitPct: number;
};

export function getRiskTradingConfig(): RiskTradingConfig {
  const s = getEffectiveRuntimeSettings();
  return {
    minPrice: s.minPrice,
    maxPrice: s.maxPrice,
    minAvgDailyVolume: s.minAvgDailyVolume,
    maxSpreadPercent: s.maxSpreadPercent,
    excludeLeveragedInverseEtfs: s.excludeLeveragedInverseEtfs,
    requireShortableWhenShorting: true,
    maxOpenPositions: s.maxOpenPositions,
    maxRiskPerTradePct: s.maxRiskPerTradePct,
    maxPositionAllocationPct: s.maxPositionAllocationPct,
    maxDailyLossPct: s.maxDailyLossPct,
    consecutiveLossPause: s.consecutiveLossPause,
    openEntryDelayMinutes: s.openEntryDelayMinutes,
    eodEntryCutoffMinutes: s.eodEntryCutoffMinutes,
    regularHoursOnly: s.regularHoursOnly,
    longOnly: s.longOnly,
    defaultStopLossPct: s.defaultStopLossPct,
    defaultTakeProfitPct: s.defaultTakeProfitPct,
  };
}
