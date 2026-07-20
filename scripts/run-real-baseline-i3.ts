/**
 * Run real historical baseline + stress + challenger compare (I-3 report).
 * Loads .env.local for Alpaca keys if present.
 */
import fs from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

loadEnvLocal();

async function main() {
  const { buildCoverageInventory } = await import(
    "../src/lib/backtest/coverage"
  );
  const { runBacktestEngine } =
    await import("../src/lib/backtest/engine");
  const { runStressScenarios, assertStressDoesNotImprove } = await import(
    "../src/lib/backtest/stress"
  );
  const { analyzeRegimeCoverage } = await import(
    "../src/lib/backtest/regime-coverage"
  );
  const { loadCachedUniverse } = await import("../src/lib/backtest/downloader");
  const {
    deriveBlockedRegimesFromChampionTrades,
    ensureRegimeFilterChallenger,
    REGIME_FILTER_VERSION,
  } = await import("../src/lib/backtest/challenger-regime");
  const { compareChampionChallenger } = await import(
    "../src/lib/backtest/comparison"
  );
  const { summarizeWalkForward } = await import(
    "../src/lib/backtest/walk-forward"
  );
  const { buildEvidenceChecklist } = await import(
    "../src/lib/backtest/evidence"
  );

  console.log("Building coverage…");
  const cov = await buildCoverageInventory({
    startHint: "2024-07-01",
    endHint: "2025-06-30",
  });
  console.log(
    "COVERAGE",
    JSON.stringify(
      cov.map((r) => ({
        s: r.symbol,
        status: r.status,
        bars: r.actualCandles,
        cov: r.coveragePercentage,
        src: r.dataSource,
      })),
      null,
      2,
    ),
  );

  console.log("Running REAL baseline (evalStep=24)…");
  const run = await runBacktestEngine({
    symbols: [
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
    ],
    start: "2024-07-01",
    end: "2025-06-30",
    kind: "baseline",
    strategyVersion: "v1.0.0",
    useSynthetic: false,
    realDataOnly: true,
    preferCache: true,
    persist: true,
    runWalkForward: true,
    minBarsPerSymbol: 80,
    evalStep: 24,
  });

  console.log("Stress (base/moderate/high — SAME evalStep + full bars)…");
  const cached = await loadCachedUniverse({
    symbols: run.symbols,
    timeframe: "5Min",
    start: run.periodStart,
    end: run.periodEnd,
  });
  const stressAll = await runStressScenarios({
    bySymbol: cached.bySymbol,
    strategyVersion: "v1.0.0",
    evalStep: 24,
    scenarios: ["base", "moderate", "high"],
  });
  const stress = stressAll;
  assertStressDoesNotImprove(stress);

  const regimes = analyzeRegimeCoverage(run.trades);
  const blocked = deriveBlockedRegimesFromChampionTrades(run.trades, {
    minSample: 10,
  });
  await ensureRegimeFilterChallenger({
    blockedRegimes: blocked.length ? blocked : ["weak_uncertain"],
    championRunId: run.id,
  });

  console.log("Challenger compare…");
  const chall = await runBacktestEngine({
    symbols: run.symbols,
    start: run.periodStart,
    end: run.periodEnd,
    kind: "challenger",
    strategyVersion: REGIME_FILTER_VERSION,
    parentVersion: "v1.0.0",
    useSynthetic: false,
    realDataOnly: true,
    preferCache: true,
    blockedRegimes: blocked.length ? blocked : ["weak_uncertain"],
    persist: true,
    runWalkForward: true,
    minBarsPerSymbol: 80,
    evalStep: 24,
  });
  chall.datasetId = run.datasetId;
  const cmp = compareChampionChallenger(run, chall);
  const wf = summarizeWalkForward(run.folds);
  const evidence = buildEvidenceChecklist(run);

  console.log(
    "BASELINE",
    JSON.stringify(
      {
        label: run.label,
        symbols: run.symbols,
        period: [run.periodStart, run.periodEnd],
        excluded: run.excludedSymbols,
        coverage: run.coveragePercentage,
        dq: run.dataQualityStatus,
        warn: run.dataQuality.warnings.length,
        block: run.dataQuality.blocking.length,
        metrics: {
          trades: run.metrics.totalTrades,
          winRate: run.metrics.winRate,
          exp: run.metrics.expectancy,
          pf: run.metrics.profitFactor,
          dd: run.metrics.maxDrawdown,
          sharpe: run.metrics.sharpe,
          sortino: run.metrics.sortino,
          before: run.metrics.totalReturnBeforeCosts,
          after: run.metrics.totalReturnAfterCosts,
          spread: run.metrics.spreadCostTotal,
          slip: run.metrics.slippageCostTotal,
          bySymbol: run.metrics.bySymbol,
          byMonth: run.metrics.byMonth,
        },
        wf: {
          folds: wf.totalFolds,
          pass: wf.passingFolds,
          median: wf.medianFoldReturn,
        },
        oos: run.split?.outOfSample,
        regimes: regimes.map((r) => ({
          regime: r.regime,
          trades: r.trades,
          exp: r.expectancy,
          pf: r.profitFactor,
          weak: r.insufficientSample,
        })),
        stress: stress.map((s) => ({
          id: s.id,
          after: s.metrics.totalReturnAfterCosts,
          exp: s.metrics.expectancy,
          pf: s.metrics.profitFactor,
          fragile: s.fragileHint,
        })),
        blockedRegimes: blocked,
        comparison: {
          champTrades: cmp.champion.trades,
          challTrades: cmp.challenger.trades,
          deltaExp: cmp.deltas.expectancy,
          deltaPf: cmp.deltas.profitFactor,
          deltaDd: cmp.deltas.maxDrawdown,
        },
        evidenceFailed: evidence.failed.map((f) => f.id),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
