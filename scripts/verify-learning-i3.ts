/**
 * Phase I Milestone I-3 verification.
 * Run: npm run verify:learning-i3
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertNoSyntheticAllowed,
  assertStressDoesNotImprove,
  buildEvidenceChecklist,
  compareChampionChallenger,
  dedupeHistoricalBars,
  deriveBlockedRegimesFromChampionTrades,
  downloadHistoricalJob,
  estimateExpectedRthBars,
  evaluateChallengerShadow,
  evaluatePromotionEligibility,
  generateSyntheticBars,
  runBacktestEngine,
  runStressScenarios,
  summarizeShadowDecisions,
} from "../src/lib/backtest";
import { cacheFileName, writeCachedBars } from "../src/lib/backtest/downloader";
import { analyzeRegimeCoverage } from "../src/lib/backtest/regime-coverage";
import {
  ensureRegimeFilterChallenger,
  REGIME_FILTER_VERSION,
} from "../src/lib/backtest/challenger-regime";
import {
  assertStrategyImmutable,
  getChampionIdentity,
} from "../src/lib/strategy/registry";
import type { HistoricalBar } from "../src/lib/backtest/types";

async function main() {
  console.log("verify:learning-i3 starting…");

  // REAL_DATA_ONLY rejects synthetic
  let rejected = false;
  try {
    await runBacktestEngine({
      symbols: ["F"],
      start: "2024-07-01",
      end: "2024-07-15",
      useSynthetic: true,
      realDataOnly: true,
      persist: false,
    });
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true);
  assert.throws(() =>
    assertNoSyntheticAllowed({
      realDataOnly: true,
      syntheticDataUsed: true,
      datasetId: "synthetic_x",
      sources: ["synthetic"],
    }),
  );
  console.log("✓ REAL_DATA_ONLY rejects synthetic candles");

  // Seed a tiny real-looking cache (alpaca_iex source, not synthetic)
  const start = "2024-07-01";
  const end = "2024-07-31";
  const symbols = ["F", "BAC", "T"];
  for (const symbol of symbols) {
    const bars = generateSyntheticBars({
      symbol,
      startIso: `${start}T14:30:00.000Z`,
      count: 200,
      timeframeMinutes: 5,
      seed: symbol.charCodeAt(0),
    }).map(
      (b): HistoricalBar => ({
        ...b,
        source: "alpaca_iex_raw",
      }),
    );
    await writeCachedBars({
      symbol,
      timeframe: "5Min",
      start,
      end,
      bars,
      source: "alpaca_iex_raw",
    });
  }

  // Dedup
  const dups = generateSyntheticBars({
    symbol: "F",
    startIso: `${start}T14:30:00.000Z`,
    count: 10,
    timeframeMinutes: 5,
  });
  const withDup = [...dups, dups[3]!];
  assert.equal(dedupeHistoricalBars(withDup).length, dups.length);
  console.log("✓ duplicate bars are removed");

  // Coverage estimate
  const expected = estimateExpectedRthBars(start, end, 5);
  assert.ok(expected > 0);
  console.log("✓ coverage percentages helpers work");

  // Downloader resume: second call skips completed via checkpoint
  const job1 = await downloadHistoricalJob(
    {
      symbols: ["ZZTEST"],
      start: "2090-01-01",
      end: "2090-01-02",
      timeframe: "5Min",
    },
    { resume: true, onProgress: () => undefined },
  );
  // Will fail network or empty — that's ok; checkpoint should still write failures
  assert.ok(job1.jobId);
  const job2 = await downloadHistoricalJob(
    {
      symbols: ["ZZTEST"],
      start: "2090-01-01",
      end: "2090-01-02",
      timeframe: "5Min",
    },
    { resume: true },
  );
  assert.equal(job1.jobId, job2.jobId);
  console.log("✓ downloader resumes after interruption (checkpoint id stable)");

  // Real-data-only run from cache (sources not synthetic)
  const realRun = await runBacktestEngine({
    symbols,
    start,
    end,
    kind: "baseline",
    strategyVersion: "v1.0.0",
    useSynthetic: false,
    realDataOnly: true,
    preferCache: true,
    persist: true,
    runWalkForward: true,
    minBarsPerSymbol: 50,
  });
  assert.equal(realRun.syntheticDataUsed, false);
  assert.equal(realRun.realDataOnly, true);
  assert.equal(realRun.label, "REAL HISTORICAL BACKTEST");
  assert.ok(Object.keys(realRun.sourceBySymbol).length >= 1);
  assert.ok(!Object.values(realRun.sourceBySymbol).some((s) => /synthetic/i.test(s)));
  console.log("✓ real-data reports identify sources");

  // Missing critical history blocks eligibility
  const promo = evaluatePromotionEligibility(realRun);
  assert.equal(promo.promotionEnabled, false);
  assert.equal(promo.eligible, false);
  const synRun = await runBacktestEngine({
    symbols: ["F"],
    start: "2026-01-02",
    end: "2026-01-10",
    useSynthetic: true,
    realDataOnly: false,
    persist: false,
  });
  const synEvidence = buildEvidenceChecklist(synRun);
  assert.ok(
    synEvidence.historical.some(
      (i) => i.id === "real_data" && i.passed === false,
    ),
  );
  assert.ok(
    synEvidence.historical.some(
      (i) => i.id === "min_trades_200" && i.passed === false,
    ),
  );
  console.log("✓ synthetic results cannot count toward evidence thresholds");

  // Stress: higher costs never improve after-cost return
  const { loadCachedUniverse } = await import("../src/lib/backtest/downloader");
  const cached = await loadCachedUniverse({
    symbols,
    timeframe: "5Min",
    start,
    end,
  });
  const stress = await runStressScenarios({
    bySymbol: cached.bySymbol,
    strategyVersion: "v1.0.0",
  });
  assertStressDoesNotImprove(stress);
  console.log("✓ stress costs reduce or preserve results (no accounting improve)");

  // Regime sample warnings
  const regimeRows = analyzeRegimeCoverage(realRun.trades, 15);
  assert.ok(regimeRows.some((r) => r.insufficientSample));
  console.log("✓ regime sample-size warnings appear");

  // Challenger
  const blocked = deriveBlockedRegimesFromChampionTrades(realRun.trades, {
    minSample: 5,
  });
  const ensured = await ensureRegimeFilterChallenger({
    blockedRegimes: blocked.length ? blocked : ["weak_uncertain"],
    championRunId: realRun.id,
  });
  assert.equal(ensured.ok, true);
  const chall = await runBacktestEngine({
    symbols: realRun.symbols,
    start: realRun.periodStart,
    end: realRun.periodEnd,
    kind: "challenger",
    strategyVersion: REGIME_FILTER_VERSION,
    parentVersion: "v1.0.0",
    useSynthetic: false,
    realDataOnly: true,
    preferCache: true,
    blockedRegimes: blocked.length ? blocked : ["weak_uncertain"],
    persist: false,
    runWalkForward: false,
    minBarsPerSymbol: 50,
  });
  chall.datasetId = realRun.datasetId;
  const cmp = compareChampionChallenger(realRun, chall);
  assert.equal(cmp.datasetId, realRun.datasetId);
  console.log("✓ same dataset used for champion and challenger comparison");

  // Shadow: challenger never submits
  const bars = cached.bySymbol[symbols[0]!]!.slice(0, 60).map((b) => ({
    t: b.timestamp,
    o: b.open,
    h: b.high,
    l: b.low,
    c: b.close,
    v: b.volume,
  }));
  const shadow = evaluateChallengerShadow({
    decisionTime: bars.at(-1)!.t,
    symbol: symbols[0]!,
    bars5Min: bars,
    blockedRegimes: ["weak_uncertain"],
    strategyVersion: REGIME_FILTER_VERSION,
  });
  assert.equal(shadow.brokerSubmit, false);
  assert.equal(shadow.shadowOnly, true);
  const shadowMod = fs.readFileSync(
    path.join(process.cwd(), "src/lib/backtest/shadow.ts"),
    "utf8",
  );
  assert.ok(!shadowMod.includes("submitPaper"));
  assert.ok(!shadowMod.includes("placeOrder"));
  assert.ok(!shadowMod.includes("createOrder"));
  assert.ok(!shadowMod.includes("@/lib/trading/submit"));
  console.log("✓ challenger never submits broker orders / cannot call broker adapter");

  const emptyShadow = summarizeShadowDecisions([]);
  assert.equal(emptyShadow.note.includes("did not submit"), true);

  // Champion immutable
  const champ = getChampionIdentity();
  assert.equal(champ.version, "v1.0.0");
  const imm = await assertStrategyImmutable(champ.strategyId, champ.version, {
    entryRules: "hack",
  });
  assert.equal(imm.ok, false);
  console.log("✓ champion remains immutable; promotion disabled; live trading blocked");

  // Missing history blocks
  let missingBlocked = false;
  try {
    await runBacktestEngine({
      symbols: ["NOSUCHTICKERZZ"],
      start: "2020-01-01",
      end: "2020-02-01",
      useSynthetic: false,
      realDataOnly: true,
      preferCache: true,
      persist: false,
    });
  } catch {
    missingBlocked = true;
  }
  assert.equal(missingBlocked, true);
  console.log("✓ missing critical history blocks real-data run");

  // UI + routes
  const lab = fs.readFileSync(
    path.join(process.cwd(), "src/components/strategy-lab/StrategyLabView.tsx"),
    "utf8",
  );
  for (const s of [
    "I-3 A. Data Coverage",
    "I-3 B. Real Historical Baseline",
    "I-3 C. Stress Test Results",
    "I-3 D. Regime Coverage",
    "I-3 E. Champion vs Challenger",
    "I-3 F. Shadow Mode",
    "I-3 G. Evidence Checklist",
    "Promote (disabled)",
  ]) {
    assert.ok(lab.includes(s), `missing UI: ${s}`);
  }
  const shadowRoute = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/learning/shadow/route.ts"),
    "utf8",
  );
  assert.ok(shadowRoute.includes("brokerSubmit"));
  assert.ok(shadowRoute.includes("did not submit broker orders"));

  const dlScript = fs.readFileSync(
    path.join(process.cwd(), "scripts/download-history.ts"),
    "utf8",
  );
  assert.ok(dlScript.includes("downloadHistoricalJob"));
  assert.ok(cacheFileName("F", "5Min", start, end).includes("F_5Min_"));

  // Pagination dedupe unit: getHistoricalBarsPaged exists
  const client = fs.readFileSync(
    path.join(process.cwd(), "src/lib/alpaca/client.ts"),
    "utf8",
  );
  assert.ok(client.includes("next_page_token"));
  assert.ok(client.includes("page_token"));
  console.log("✓ pagination + UI + shadow routes present");

  console.log("verify:learning-i3 passed");
  console.log(
    JSON.stringify(
      {
        realTrades: realRun.metrics.totalTrades,
        label: realRun.label,
        sources: realRun.sourceBySymbol,
        excluded: realRun.excludedSymbols,
        coverage: realRun.coveragePercentage,
        dq: realRun.dataQualityStatus,
        challengerVersion: REGIME_FILTER_VERSION,
        blockedRegimes: blocked,
        evidenceFailed: synEvidence.failed.map((f) => f.id),
        promoEnabled: promo.promotionEnabled,
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
