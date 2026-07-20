/**
 * Regime coverage analytics with sample-size warnings.
 */

import type { BacktestMetrics, SimTrade } from "@/lib/backtest/types";
import type { MarketRegime } from "@/lib/learning/regime";

const ALL_REGIMES: MarketRegime[] = [
  "trending_up",
  "trending_down",
  "range_bound",
  "high_volatility",
  "low_volatility",
  "high_volume_momentum",
  "weak_uncertain",
];

export type RegimeCoverageRow = {
  regime: string;
  trades: number;
  winRate: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  maxDrawdown: number | null;
  avgHoldingBars: number | null;
  pnl: number;
  insufficientSample: boolean;
  sampleWarning: string | null;
};

export function analyzeRegimeCoverage(
  trades: SimTrade[],
  minSample = 15,
): RegimeCoverageRow[] {
  const by: Record<string, SimTrade[]> = {};
  for (const r of ALL_REGIMES) by[r] = [];
  for (const t of trades) {
    const key = t.regime || "weak_uncertain";
    if (!by[key]) by[key] = [];
    by[key]!.push(t);
  }

  return Object.entries(by).map(([regime, list]) => {
    const wins = list.filter((t) => t.realizedPnl > 0);
    const losses = list.filter((t) => t.realizedPnl < 0);
    const grossWin = wins.reduce((a, t) => a + t.realizedPnl, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.realizedPnl, 0));
    const pnl = list.reduce((a, t) => a + t.realizedPnl, 0);
    const insufficient = list.length > 0 && list.length < minSample;
    // equity curve dd within regime
    let eq = 0;
    let peak = 0;
    let maxDd = 0;
    for (const t of list) {
      eq += t.realizedPnl;
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? (peak - eq) / Math.max(peak, 1) : 0;
      if (dd > maxDd) maxDd = dd;
    }
    return {
      regime,
      trades: list.length,
      winRate: list.length ? wins.length / list.length : null,
      expectancy: list.length ? pnl / list.length : null,
      profitFactor:
        grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(4)) : null,
      maxDrawdown: list.length ? Number(maxDd.toFixed(5)) : null,
      avgHoldingBars: list.length
        ? Number(
            (
              list.reduce((a, t) => a + t.holdingBars, 0) / list.length
            ).toFixed(2),
          )
        : null,
      pnl: Number(pnl.toFixed(4)),
      insufficientSample: insufficient || list.length === 0,
      sampleWarning:
        list.length === 0
          ? "No trades in this regime — do not conclude strength."
          : insufficient
            ? `Only ${list.length} trades (<${minSample}) — insufficient for strong conclusions.`
            : null,
    };
  });
}

export function meaningfulRegimeCount(
  rows: RegimeCoverageRow[],
  minSample = 15,
): number {
  return rows.filter((r) => r.trades >= minSample).length;
}

export function regimesWithNegativeExpectancy(
  metrics: BacktestMetrics,
): string[] {
  return Object.entries(metrics.byRegime)
    .filter(([, v]) => v.trades >= 10 && v.pnl / v.trades < 0)
    .map(([k]) => k);
}
