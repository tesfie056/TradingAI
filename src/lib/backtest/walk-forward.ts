/**
 * Walk-forward fold summary aggregates.
 */

import type { WalkForwardFold } from "@/lib/backtest/types";

export type WalkForwardSummary = {
  totalFolds: number;
  passingFolds: number;
  failingFolds: number;
  bestFold: WalkForwardFold | null;
  worstFold: WalkForwardFold | null;
  medianFoldReturn: number | null;
  pctProfitableFolds: number | null;
  pctAcceptableDrawdown: number | null;
  performanceDecayHint: string;
  parameterStabilityHint: string;
};

export function summarizeWalkForward(
  folds: WalkForwardFold[],
): WalkForwardSummary {
  if (folds.length === 0) {
    return {
      totalFolds: 0,
      passingFolds: 0,
      failingFolds: 0,
      bestFold: null,
      worstFold: null,
      medianFoldReturn: null,
      pctProfitableFolds: null,
      pctAcceptableDrawdown: null,
      performanceDecayHint: "No folds generated",
      parameterStabilityHint: "N/A",
    };
  }
  const passing = folds.filter((f) => f.passed);
  const byReturn = [...folds].sort((a, b) => b.totalReturn - a.totalReturn);
  const returns = folds.map((f) => f.totalReturn).sort((a, b) => a - b);
  const mid = Math.floor(returns.length / 2);
  const median =
    returns.length % 2 === 0
      ? ((returns[mid - 1]! + returns[mid]!) / 2)
      : returns[mid]!;
  const profitable = folds.filter((f) => f.totalReturn > 0).length;
  const okDd = folds.filter((f) => (f.maxDrawdown ?? 1) <= 0.2).length;
  const first = folds[0]!;
  const last = folds.at(-1)!;
  const decay =
    first.expectancy != null && last.expectancy != null
      ? last.expectancy - first.expectancy
      : null;

  return {
    totalFolds: folds.length,
    passingFolds: passing.length,
    failingFolds: folds.length - passing.length,
    bestFold: byReturn[0] ?? null,
    worstFold: byReturn.at(-1) ?? null,
    medianFoldReturn: Number(median.toFixed(4)),
    pctProfitableFolds: Number((profitable / folds.length).toFixed(4)),
    pctAcceptableDrawdown: Number((okDd / folds.length).toFixed(4)),
    performanceDecayHint:
      decay == null
        ? "Insufficient expectancy data for decay estimate"
        : `Validation expectancy change first→last fold: ${decay.toFixed(4)} (negative = decay)`,
    parameterStabilityHint:
      passing.length / folds.length >= 0.5
        ? "≥50% folds passed — moderate stability signal"
        : "<50% folds passed — unstable under walk-forward",
  };
}
