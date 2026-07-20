/**
 * Champion vs challenger comparison on the same dataset.
 */

import type { BacktestRunRecord } from "@/lib/backtest/types";
import { assertSameDataset } from "@/lib/backtest/challenger-regime";
import { analyzeRegimeCoverage } from "@/lib/backtest/regime-coverage";

export type StrategyComparison = {
  datasetId: string;
  periodStart: string;
  periodEnd: string;
  symbols: string[];
  champion: {
    version: string;
    trades: number;
    expectancy: number | null;
    profitFactor: number | null;
    maxDrawdown: number | null;
    sharpe: number | null;
    sortino: number | null;
    totalReturnAfterCosts: number;
    symbolConcentration: Record<string, number>;
  };
  challenger: {
    version: string;
    trades: number;
    expectancy: number | null;
    profitFactor: number | null;
    maxDrawdown: number | null;
    sharpe: number | null;
    sortino: number | null;
    totalReturnAfterCosts: number;
    symbolConcentration: Record<string, number>;
  };
  deltas: {
    trades: number;
    expectancy: number | null;
    profitFactor: number | null;
    maxDrawdown: number | null;
    totalReturnAfterCosts: number;
  };
  monthlyConsistency: {
    championWinningMonths: number;
    challengerWinningMonths: number;
    championLosingMonths: number;
    challengerLosingMonths: number;
  };
  regimeNotes: string[];
  oosDecayHint: string;
  disclaimer: string;
};

function symbolShare(
  run: BacktestRunRecord,
): Record<string, number> {
  const total = Math.max(1, run.metrics.totalTrades);
  const out: Record<string, number> = {};
  for (const [s, v] of Object.entries(run.metrics.bySymbol)) {
    out[s] = Number((v.trades / total).toFixed(4));
  }
  return out;
}

export function compareChampionChallenger(
  champion: BacktestRunRecord,
  challenger: BacktestRunRecord,
): StrategyComparison {
  assertSameDataset(champion, challenger);
  const c = champion.metrics;
  const h = challenger.metrics;
  const cMonths = Object.values(c.byMonth);
  const hMonths = Object.values(h.byMonth);
  const regimeC = analyzeRegimeCoverage(champion.trades);
  const regimeH = analyzeRegimeCoverage(challenger.trades);
  const regimeNotes: string[] = [];
  for (const r of regimeC) {
    const other = regimeH.find((x) => x.regime === r.regime);
    if (r.insufficientSample && r.trades > 0) {
      regimeNotes.push(`Champion ${r.regime}: ${r.sampleWarning}`);
    }
    if (other?.insufficientSample && (other.trades ?? 0) > 0) {
      regimeNotes.push(`Challenger ${other.regime}: ${other.sampleWarning}`);
    }
  }

  const champExpect = c.expectancy;
  const challExpect = h.expectancy;
  const oosDecayHint =
    champExpect != null && challExpect != null
      ? `Challenger expectancy delta vs champion: ${(challExpect - champExpect).toFixed(4)}`
      : "Insufficient expectancy for decay comparison";

  return {
    datasetId: champion.datasetId,
    periodStart: champion.periodStart,
    periodEnd: champion.periodEnd,
    symbols: champion.symbols,
    champion: {
      version: champion.strategyVersion,
      trades: c.totalTrades,
      expectancy: c.expectancy,
      profitFactor: c.profitFactor,
      maxDrawdown: c.maxDrawdown,
      sharpe: c.sharpe,
      sortino: c.sortino,
      totalReturnAfterCosts: c.totalReturnAfterCosts,
      symbolConcentration: symbolShare(champion),
    },
    challenger: {
      version: challenger.strategyVersion,
      trades: h.totalTrades,
      expectancy: h.expectancy,
      profitFactor: h.profitFactor,
      maxDrawdown: h.maxDrawdown,
      sharpe: h.sharpe,
      sortino: h.sortino,
      totalReturnAfterCosts: h.totalReturnAfterCosts,
      symbolConcentration: symbolShare(challenger),
    },
    deltas: {
      trades: h.totalTrades - c.totalTrades,
      expectancy:
        champExpect != null && challExpect != null
          ? Number((challExpect - champExpect).toFixed(4))
          : null,
      profitFactor:
        c.profitFactor != null && h.profitFactor != null
          ? Number((h.profitFactor - c.profitFactor).toFixed(4))
          : null,
      maxDrawdown:
        c.maxDrawdown != null && h.maxDrawdown != null
          ? Number((h.maxDrawdown - c.maxDrawdown).toFixed(5))
          : null,
      totalReturnAfterCosts: Number(
        (h.totalReturnAfterCosts - c.totalReturnAfterCosts).toFixed(4),
      ),
    },
    monthlyConsistency: {
      championWinningMonths: cMonths.filter((m) => m.pnl > 0).length,
      challengerWinningMonths: hMonths.filter((m) => m.pnl > 0).length,
      championLosingMonths: cMonths.filter((m) => m.pnl < 0).length,
      challengerLosingMonths: hMonths.filter((m) => m.pnl < 0).length,
    },
    regimeNotes,
    oosDecayHint,
    disclaimer:
      "Same-dataset comparison only. Does not prove future profitability. Promotion disabled.",
  };
}
