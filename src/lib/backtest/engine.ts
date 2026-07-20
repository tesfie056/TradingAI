/**
 * Full backtest engine — shared evaluator + execution sim + splits.
 * Never submits broker orders.
 */

import { runDataQualityChecks } from "@/lib/backtest/data-quality";
import { defaultAssumptions } from "@/lib/backtest/costs";
import { estimateExpectedRthBars } from "@/lib/backtest/coverage";
import { loadCachedUniverse } from "@/lib/backtest/downloader";
import { simulateSymbolPath } from "@/lib/backtest/execution";
import {
  generateSyntheticBars,
  generateSyntheticRange,
  getHistoricalBarsMulti,
} from "@/lib/backtest/historical-data";
import { computeMetrics } from "@/lib/backtest/metrics";
import { fingerprintFromAssumptions } from "@/lib/backtest/fingerprint";
import { evaluatePromotionEligibility } from "@/lib/backtest/promotion";
import {
  assertNoSyntheticAllowed,
  emptyRealDataProvenance,
  isRealDataOnlyEnv,
} from "@/lib/backtest/real-data-mode";
import {
  buildDefaultSplit,
  filterBarsByIsoRange,
  generateWalkForwardWindows,
  validateChronologicalSplit,
} from "@/lib/backtest/splits";
import { saveBacktestRun } from "@/lib/backtest/storage";
import type {
  BacktestRunRecord,
  ExecutionAssumptions,
  HistoricalBar,
  WalkForwardFold,
} from "@/lib/backtest/types";
import { getChampionIdentity } from "@/lib/strategy/registry";

function newRunId(kind: string): string {
  return `bt_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const DISCLAIMER =
  "Backtest results are historical simulations only and do not prove future profitability. Paper-only; live trading blocked.";

export type BacktestEngineInput = {
  symbols: string[];
  start: string;
  end: string;
  kind?: BacktestRunRecord["kind"];
  strategyVersion?: string;
  parentVersion?: string | null;
  assumptions?: Partial<ExecutionAssumptions>;
  minConfidence?: number;
  /** Explicit synthetic (I-2). Forbidden when realDataOnly. */
  useSynthetic?: boolean;
  /** Prefer disk cache; fail if missing when realDataOnly. */
  preferCache?: boolean;
  realDataOnly?: boolean;
  blockedRegimes?: string[];
  persist?: boolean;
  runWalkForward?: boolean;
  excludeIncompleteSymbols?: boolean;
  minBarsPerSymbol?: number;
  /** Bar step between evaluations (higher = faster; default 6 synthetic / 18 real). */
  evalStep?: number;
};

export async function runBacktestEngine(
  input: BacktestEngineInput,
): Promise<BacktestRunRecord> {
  const champ = getChampionIdentity();
  const strategyVersion = input.strategyVersion ?? champ.version;
  const assumptions = defaultAssumptions(input.assumptions);
  const symbols = input.symbols.map((s) => s.toUpperCase());
  const realDataOnly = input.realDataOnly ?? isRealDataOnlyEnv();
  const useSynthetic = input.useSynthetic === true && !realDataOnly;
  const evalStep = input.evalStep ?? (realDataOnly || !useSynthetic ? 18 : 6);

  if (realDataOnly && input.useSynthetic === true) {
    throw new Error("REAL_DATA_ONLY: synthetic bars are forbidden");
  }

  let bySymbol: Record<string, HistoricalBar[]> = {};
  let datasetId = "unset";
  let syntheticDataUsed = false;
  const sourceBySymbol: Record<string, string> = {};
  const excludedSymbols: { symbol: string; reason: string }[] = [];
  const missingPeriods: {
    symbol: string;
    start: string;
    end: string;
    reason: string;
  }[] = [];
  let activeSymbols = [...symbols];

  if (useSynthetic) {
    syntheticDataUsed = true;
    for (const symbol of symbols) {
      const ranged = generateSyntheticRange({
        symbol,
        startDate: input.start,
        endDate: input.end,
        timeframeMinutes: 5,
        startPrice: 40 + (symbol.charCodeAt(0) % 20),
        seed: symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0),
      });
      bySymbol[symbol] =
        ranged.length >= 40
          ? ranged
          : generateSyntheticBars({
              symbol,
              startIso: `${input.start}T14:30:00.000Z`,
              count: 400,
              timeframeMinutes: 5,
              seed: symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0),
              trendBias: 0.55,
            });
      sourceBySymbol[symbol] = "synthetic";
    }
    datasetId = `synthetic_${input.start}_${input.end}`;
  } else {
    // Prefer cache for real runs
    const cached = await loadCachedUniverse({
      symbols,
      timeframe: "5Min",
      start: input.start,
      end: input.end,
    });
    bySymbol = cached.bySymbol;
    Object.assign(sourceBySymbol, cached.sourceBySymbol);

    const needFetch = symbols.filter((s) => !bySymbol[s]?.length);
    if (needFetch.length > 0 && input.preferCache !== true) {
      try {
        const hist = await getHistoricalBarsMulti({
          symbols: needFetch,
          timeframe: "5Min",
          start: `${input.start}T00:00:00.000Z`,
          end: `${input.end}T23:59:59.000Z`,
          paginate: true,
        });
        for (const s of needFetch) {
          const bars = hist.bySymbol[s] ?? [];
          if (bars.length > 0) {
            bySymbol[s] = bars;
            sourceBySymbol[s] = bars[0]?.source ?? "alpaca_iex";
          }
        }
        datasetId = hist.datasetId;
      } catch (e) {
        if (realDataOnly) {
          throw new Error(
            `REAL_DATA_ONLY: historical fetch failed — ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        // Legacy soft path only when not real-data-only
        syntheticDataUsed = true;
        for (const symbol of needFetch) {
          bySymbol[symbol] = generateSyntheticBars({
            symbol,
            startIso: `${input.start}T14:30:00.000Z`,
            count: 400,
            timeframeMinutes: 5,
            seed: 7,
          });
          sourceBySymbol[symbol] = "synthetic_error_fallback";
        }
        datasetId = "synthetic_error_fallback";
        assumptions.notes.push(
          "Historical fetch failed — synthetic bars used. Not promotion-eligible.",
        );
      }
    } else if (needFetch.length > 0 && realDataOnly) {
      for (const s of needFetch) {
        excludedSymbols.push({
          symbol: s,
          reason: "missing cached historical data (REAL_DATA_ONLY)",
        });
        missingPeriods.push({
          symbol: s,
          start: input.start,
          end: input.end,
          reason: "no cache / incomplete download",
        });
      }
      activeSymbols = symbols.filter((s) => bySymbol[s]?.length);
      if (activeSymbols.length === 0) {
        throw new Error(
          "REAL_DATA_ONLY: no symbols have cached historical data. Run npm run learning:download-history first.",
        );
      }
    }

    const minBars = input.minBarsPerSymbol ?? 100;
    if (input.excludeIncompleteSymbols !== false) {
      for (const s of [...activeSymbols]) {
        const n = bySymbol[s]?.length ?? 0;
        if (n < minBars) {
          excludedSymbols.push({
            symbol: s,
            reason: `insufficient bars (${n} < ${minBars})`,
          });
          missingPeriods.push({
            symbol: s,
            start: input.start,
            end: input.end,
            reason: "insufficient coverage",
          });
          delete bySymbol[s];
          activeSymbols = activeSymbols.filter((x) => x !== s);
        }
      }
    }

    if (!datasetId || datasetId === "unset") {
      datasetId = `real_cache_${input.start}_${input.end}_${activeSymbols.length}`;
    }

    if (realDataOnly) {
      assertNoSyntheticAllowed({
        realDataOnly: true,
        syntheticDataUsed,
        datasetId,
        sources: Object.values(sourceBySymbol),
      });
      if (activeSymbols.length < 1) {
        throw new Error("REAL_DATA_ONLY: no eligible symbols after coverage filter");
      }
    } else if (
      Object.values(bySymbol).reduce((a, b) => a + b.length, 0) < 30 &&
      !syntheticDataUsed
    ) {
      // Legacy I-2 soft fallback only when not real-data-only
      syntheticDataUsed = true;
      for (const symbol of symbols) {
        bySymbol[symbol] = generateSyntheticBars({
          symbol,
          startIso: `${input.start}T14:30:00.000Z`,
          count: 400,
          timeframeMinutes: 5,
          seed: 99,
        });
        sourceBySymbol[symbol] = "synthetic_fallback";
      }
      datasetId = `synthetic_fallback_${datasetId}`;
      assumptions.notes.push(
        "Alpaca history sparse — synthetic fallback (not real-data eligible).",
      );
      activeSymbols = [...symbols];
    }
  }

  const quality = runDataQualityChecks(
    Object.fromEntries(activeSymbols.map((s) => [s, bySymbol[s] ?? []])),
  );

  const allTrades = [];
  for (const symbol of activeSymbols) {
    const bars = filterBarsByIsoRange(
      bySymbol[symbol] ?? [],
      input.start,
      input.end,
    );
    const { trades } = simulateSymbolPath({
      symbol,
      bars,
      assumptions,
      strategyVersion,
      minConfidence: input.minConfidence,
      blockedRegimes: input.blockedRegimes,
      step: evalStep,
    });
    allTrades.push(...trades);
  }

  const metrics = computeMetrics(allTrades, assumptions.startingEquity);

  let folds: WalkForwardFold[] = [];
  if (input.runWalkForward) {
    const windows = generateWalkForwardWindows({
      start: input.start,
      end: input.end,
      trainDays: 20,
      testDays: 10,
      stepDays: 10,
      purgeGapDays: 1,
    });
    folds = windows.map((w, foldIndex) => {
      const v = validateChronologicalSplit(w);
      const foldTrades = [];
      for (const symbol of activeSymbols) {
        const bars = filterBarsByIsoRange(
          bySymbol[symbol] ?? [],
          w.validation.start,
          w.validation.end,
        );
        const { trades } = simulateSymbolPath({
          symbol,
          bars,
          assumptions,
          strategyVersion,
          minConfidence: input.minConfidence,
          blockedRegimes: input.blockedRegimes,
          step: evalStep,
        });
        foldTrades.push(...trades);
      }
      const fm = computeMetrics(foldTrades, assumptions.startingEquity);
      const passed =
        v.ok &&
        quality.passed &&
        !syntheticDataUsed &&
        (fm.expectancy ?? 0) > 0 &&
        (fm.maxDrawdown ?? 1) <= 0.2;
      return {
        foldIndex,
        trainingStart: w.training.start,
        trainingEnd: w.training.end,
        validationStart: w.validation.start,
        validationEnd: w.validation.end,
        purgeGapDays: w.purgeGapDays,
        symbols: activeSymbols,
        trades: fm.totalTrades,
        totalReturn: fm.totalReturn,
        expectancy: fm.expectancy,
        profitFactor: fm.profitFactor,
        maxDrawdown: fm.maxDrawdown,
        sharpe: fm.sharpe,
        sortino: fm.sortino,
        avgWinner: fm.avgWinner,
        avgLoser: fm.avgLoser,
        consecutiveLosses: fm.consecutiveLosses,
        byRegime: Object.fromEntries(
          Object.entries(fm.byRegime).map(([k, v]) => [k, v.trades]),
        ),
        bySymbol: Object.fromEntries(
          Object.entries(fm.bySymbol).map(([k, v]) => [k, v.trades]),
        ),
        passed,
        failReason: passed
          ? null
          : syntheticDataUsed
            ? "synthetic data"
            : !v.ok
              ? v.error
              : !quality.passed
                ? "blocking data quality"
                : "fold metrics failed thresholds",
      };
    });
  }

  const split = buildDefaultSplit({
    start: input.start,
    end: input.end,
    purgeGapDays: 1,
  });

  let coverageSum = 0;
  let coverageN = 0;
  for (const s of activeSymbols) {
    const n = bySymbol[s]?.length ?? 0;
    const expected = estimateExpectedRthBars(input.start, input.end, 5);
    if (expected > 0) {
      coverageSum += (n / expected) * 100;
      coverageN += 1;
    }
  }
  const coveragePercentage =
    coverageN > 0 ? Number((coverageSum / coverageN).toFixed(1)) : null;

  const provenance = emptyRealDataProvenance({
    realDataOnly,
    syntheticDataUsed,
  });
  provenance.sourceBySymbol = sourceBySymbol;
  provenance.sourceByTimeframe = { "5Min": Object.values(sourceBySymbol)[0] ?? "unknown" };
  provenance.missingPeriods = missingPeriods;
  provenance.excludedSymbols = excludedSymbols;
  provenance.coveragePercentage = coveragePercentage;
  provenance.dataQualityStatus = !quality.passed
    ? "BLOCKED"
    : coveragePercentage != null && coveragePercentage < 70
      ? "PARTIAL"
      : syntheticDataUsed
        ? "BLOCKED"
        : "READY";
  if (syntheticDataUsed) {
    provenance.label = "SYNTHETIC BACKTEST";
  } else if (realDataOnly) {
    provenance.label = "REAL HISTORICAL BACKTEST";
  }

  const run: BacktestRunRecord = {
    id: newRunId(input.kind ?? "baseline"),
    createdAt: new Date().toISOString(),
    kind: input.kind ?? "baseline",
    strategyId: champ.strategyId,
    strategyVersion,
    parentVersion: input.parentVersion ?? null,
    datasetId,
    symbols: activeSymbols,
    timeframe: "5Min",
    periodStart: input.start,
    periodEnd: input.end,
    split,
    assumptions,
    dataQuality: {
      warnings: quality.warnings,
      blocking: quality.blocking,
      passed: quality.passed && !syntheticDataUsed,
    },
    metrics,
    trades: allTrades,
    folds,
    reproducibleFrom: {
      strategyVersion,
      datasetId,
      dateRange: { start: input.start, end: input.end },
      universe: activeSymbols,
      timeframe: "5Min",
      parameters: {
        minConfidence: input.minConfidence ?? 0.55,
        realDataOnly,
        blockedRegimes: (input.blockedRegimes ?? []).join(",") || "none",
      },
      spreadModel: assumptions.spreadModel,
      slippageModel: assumptions.slippageModel,
      riskProfile: "runtime_risk_config",
      randomSeed: null,
    },
    promotionEligible: false,
    promotionBlockers: [],
    paperOnly: true,
    liveTradingAllowed: false,
    brokerOrdersSubmitted: false,
    disclaimer: DISCLAIMER,
    ...provenance,
    runFingerprint: null,
    comparableNote: null,
  };

  run.runFingerprint = fingerprintFromAssumptions({
    strategyVersion,
    datasetId,
    startDate: input.start,
    endDate: input.end,
    symbols: activeSymbols,
    timeframe: "5Min",
    assumptions,
    evalStep,
    blockedRegimes: input.blockedRegimes,
    minConfidence: input.minConfidence,
    realDataOnly,
  });
  run.comparableNote =
    "Compare only with runs that share this runFingerprint.hash";

  const eligibility = evaluatePromotionEligibility(run);
  run.promotionEligible = false;
  run.promotionBlockers = eligibility.checks
    .filter((c) => !c.passed)
    .map((c) => c.label);

  if (input.persist) {
    await saveBacktestRun(run);
  }
  return run;
}

/** I-2 synthetic baseline (not real-data eligible). */
export async function runBaselinePaperIntelligenceV1(input?: {
  symbols?: string[];
  start?: string;
  end?: string;
  persist?: boolean;
}): Promise<BacktestRunRecord> {
  return runBacktestEngine({
    symbols: input?.symbols ?? ["AAPL", "MSFT", "F"],
    start: input?.start ?? "2026-01-02",
    end: input?.end ?? "2026-03-31",
    kind: "baseline",
    strategyVersion: "v1.0.0",
    useSynthetic: true,
    realDataOnly: false,
    persist: input?.persist ?? true,
    runWalkForward: true,
  });
}

/** I-3 real historical baseline — no synthetic fallback. */
export async function runRealBaselinePaperIntelligenceV1(input?: {
  symbols?: string[];
  start?: string;
  end?: string;
  persist?: boolean;
}): Promise<BacktestRunRecord> {
  const defaultSymbols = [
    "F",
    "BAC",
    "T",
    "VZ",
    "PFE",
    "INTC",
    "MO",
    "KMI",
    "KEY",
    "AAL",
    "CCL",
    "WBD",
  ];
  return runBacktestEngine({
    symbols: input?.symbols ?? defaultSymbols,
    start: input?.start ?? "2024-07-01",
    end: input?.end ?? "2025-06-30",
    kind: "baseline",
    strategyVersion: "v1.0.0",
    useSynthetic: false,
    realDataOnly: true,
    preferCache: true,
    persist: input?.persist ?? true,
    runWalkForward: true,
    excludeIncompleteSymbols: true,
    minBarsPerSymbol: 80,
    evalStep: 24,
  });
}
