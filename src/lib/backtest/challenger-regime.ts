/**
 * First controlled challenger: Paper Intelligence v1.1 Regime Filter.
 * Same scoring / entry / risk — only blocks entries in weak regimes.
 * Never submits broker orders.
 */

import { analyzeRegimeCoverage } from "@/lib/backtest/regime-coverage";
import type { BacktestRunRecord, SimTrade } from "@/lib/backtest/types";
import { registerStrategyVersion } from "@/lib/strategy/registry";
import { getChampionIdentity } from "@/lib/strategy/registry";

export const REGIME_FILTER_VERSION = "v1.1.0-regime-filter";
export const REGIME_FILTER_NAME = "Paper Intelligence v1.1 Regime Filter";

/**
 * Derive blocked regimes from champion real trades:
 * negative expectancy (min sample) OR unsafe drawdown within regime.
 */
export function deriveBlockedRegimesFromChampionTrades(
  trades: SimTrade[],
  options?: { minSample?: number; maxRegimeDd?: number },
): string[] {
  const minSample = options?.minSample ?? 15;
  const maxDd = options?.maxRegimeDd ?? 0.12;
  const rows = analyzeRegimeCoverage(trades, minSample);
  const blocked: string[] = [];
  for (const r of rows) {
    if (r.trades < minSample) continue;
    if ((r.expectancy ?? 0) < 0) blocked.push(r.regime);
    else if (
      (r.maxDrawdown ?? 0) > maxDd &&
      (r.expectancy ?? 0) <= 0
    ) {
      blocked.push(r.regime);
    }
  }
  // Always keep weak_uncertain blocked if present with any negative sample
  const weak = rows.find((r) => r.regime === "weak_uncertain");
  if (weak && weak.trades >= 5 && (weak.expectancy ?? 0) < 0) {
    if (!blocked.includes("weak_uncertain")) blocked.push("weak_uncertain");
  }
  // v1.1 conservative default: always filter weak/uncertain + zero-sample high-vol
  // when those regimes lack positive evidence on the champion real run.
  for (const r of ["weak_uncertain", "high_volatility"] as const) {
    const row = rows.find((x) => x.regime === r);
    if (!row || row.trades < minSample || (row.expectancy ?? 0) <= 0) {
      if (!blocked.includes(r)) blocked.push(r);
    }
  }
  return [...new Set(blocked)];
}

export async function ensureRegimeFilterChallenger(input: {
  blockedRegimes: string[];
  championRunId?: string;
}): Promise<
  | { ok: true; strategyId: string; version: string; blockedRegimes: string[] }
  | { ok: false; error: string }
> {
  const champ = getChampionIdentity();
  const blocked = input.blockedRegimes;
  const result = await registerStrategyVersion({
    strategyId: champ.strategyId,
    name: REGIME_FILTER_NAME,
    version: REGIME_FILTER_VERSION,
    status: "DRAFT",
    parentVersion: champ.version,
    entryRules: `Same as ${champ.version} scoring/entry via shared evaluator. ADDITIONAL: block new entries when regime is one of [${blocked.join(", ") || "none"}]. Derived from champion real historical expectancy/drawdown.`,
    exitRules: "Inherited brackets and risk exits from parent (unchanged).",
    featureSet: [
      "shared_evaluator",
      "regime_filter",
      "typed_params_only",
      "no_broker_submit",
    ],
    parameterValues: {
      blockedRegimes: blocked.join(","),
      parentVersion: champ.version,
      championRunId: input.championRunId ?? "",
      scoringUnchanged: true,
      riskRulesUnchanged: true,
    },
    supportedRegimes: [
      "trending_up",
      "trending_down",
      "range_bound",
      "high_volatility",
      "low_volatility",
      "high_volume_momentum",
      "weak_uncertain",
    ].filter((r) => !blocked.includes(r)),
    supportedUniverse: "same as parent real-data universe",
    riskRequirements: [
      "paper_only",
      "no_broker_in_backtest",
      "no_broker_in_shadow",
      "risk_engine_required",
    ],
    backtestPeriod: { start: null, end: null },
    validationResults: null,
    paperTradingResults: null,
    rejectionReason: null,
    rollbackTarget: champ.version,
  });
  if (!result.ok) {
    // Already registered — treat as success if version exists
    if (result.error.includes("already") || result.error.includes("immutable")) {
      return {
        ok: true,
        strategyId: champ.strategyId,
        version: REGIME_FILTER_VERSION,
        blockedRegimes: blocked,
      };
    }
    return result;
  }
  return {
    ok: true,
    strategyId: result.entry.strategyId,
    version: result.entry.version,
    blockedRegimes: blocked,
  };
}

export function challengerDiffFromChampion(blockedRegimes: string[]): string[] {
  return [
    "Scoring logic: unchanged (shared decideForSymbol)",
    "Entry logic: unchanged except regime gate",
    "Risk rules: unchanged",
    `Blocked regimes for new entries: ${blockedRegimes.join(", ") || "(none derived)"}`,
    "No broker order submission in backtest or shadow",
  ];
}

export function assertSameDataset(
  a: BacktestRunRecord,
  b: BacktestRunRecord,
): void {
  if (a.datasetId !== b.datasetId) {
    throw new Error(
      `Champion/challenger dataset mismatch: ${a.datasetId} vs ${b.datasetId}`,
    );
  }
  if (a.periodStart !== b.periodStart || a.periodEnd !== b.periodEnd) {
    throw new Error("Champion/challenger date range mismatch");
  }
  if (a.symbols.join(",") !== b.symbols.join(",")) {
    throw new Error("Champion/challenger universe mismatch");
  }
  if (a.syntheticDataUsed || b.syntheticDataUsed) {
    throw new Error("Cannot compare using synthetic datasets");
  }
}
