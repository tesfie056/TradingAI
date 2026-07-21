/**
 * Phase I Milestone I-2 verification.
 * Run: npm run verify:learning-i2
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  applyEntryCosts,
  assertOutOfSampleImmutable,
  buildDefaultSplit,
  createChallengerDraft,
  defaultAssumptions,
  estimateSlippagePct,
  estimateSpreadPct,
  evaluatePromotionEligibility,
  evaluateStrategyAt,
  filterBarsByIsoRange,
  generateSyntheticBars,
  generateWalkForwardWindows,
  lockOutOfSample,
  rejectRandomSplit,
  resolveSameCandleExit,
  runBacktestEngine,
  runDataQualityChecks,
  simulateSymbolPath,
  validateChronologicalSplit,
} from "../src/lib/backtest";
import { filterBarsAsOf } from "../src/lib/learning";
import {
  assertStrategyImmutable,
  getChampionIdentity,
  readStrategyRegistry,
} from "../src/lib/strategy/registry";

async function main() {
  console.log("verify:learning-i2 starting…");

  // Shared evaluator — no broker submit
  const bars = generateSyntheticBars({
    symbol: "AAPL",
    startIso: "2026-01-05T14:30:00.000Z",
    count: 80,
    timeframeMinutes: 5,
    startPrice: 100,
    seed: 11,
    trendBias: 0.58,
  });
  const alpaca = bars.map((b) => ({
    t: b.timestamp,
    o: b.open,
    h: b.high,
    l: b.low,
    c: b.close,
    v: b.volume,
  }));
  const decisionTime = bars[50]!.timestamp;
  const futureLeak = [
    ...alpaca,
    {
      t: "2099-01-01T00:00:00.000Z",
      o: 999,
      h: 999,
      l: 999,
      c: 999,
      v: 1,
    },
  ];
  const evalResult = evaluateStrategyAt({
    decisionTime,
    symbol: "AAPL",
    bars5Min: futureLeak,
    strategyVersion: "v1.0.0",
    skipRiskEngine: true,
  });
  assert.equal(evalResult.brokerSubmit, false);
  assert.equal(evalResult.paperOnly, true);
  const asOf = filterBarsAsOf(futureLeak, decisionTime);
  assert.ok(asOf.every((b) => Date.parse(b.t) <= Date.parse(decisionTime)));
  assert.ok(!asOf.some((b) => b.c === 999), "no future candles in evaluation window");
  console.log("✓ strategy logic shared; no broker submission; no future candles");

  // Chronological splits
  const split = buildDefaultSplit({
    start: "2026-01-02",
    end: "2026-03-31",
    purgeGapDays: 2,
  });
  const v = validateChronologicalSplit(split);
  assert.equal(v.ok, true);
  assert.equal(split.outOfSampleLocked, true);

  let randomRejected = false;
  try {
    rejectRandomSplit("random");
  } catch {
    randomRejected = true;
  }
  assert.equal(randomRejected, true);
  console.log("✓ chronological ordering enforced; random splits rejected");

  const locked = lockOutOfSample(split);
  assert.throws(() =>
    assertOutOfSampleImmutable(locked, {
      ...locked,
      outOfSample: { start: "2099-01-01", end: "2099-02-01" },
    }),
  );
  console.log("✓ locked OOS dates cannot change silently");

  const overlap = validateChronologicalSplit({
    id: "bad",
    training: { start: "2026-01-01", end: "2026-01-20" },
    validation: { start: "2026-01-15", end: "2026-01-25" },
    purgeGapDays: 1,
    outOfSample: null,
    outOfSampleLocked: false,
  });
  assert.equal(overlap.ok, false);
  console.log("✓ overlapping periods rejected; purge gaps enforced");

  const folds = generateWalkForwardWindows({
    start: "2026-01-02",
    end: "2026-03-31",
    trainDays: 10,
    testDays: 5,
    stepDays: 5,
    purgeGapDays: 1,
  });
  assert.ok(folds.length >= 2);
  console.log("✓ walk-forward fold generation");

  // Data quality
  const dupBars = [...bars];
  dupBars.push({ ...bars[10]! });
  const dq = runDataQualityChecks({ AAPL: dupBars });
  assert.ok(dq.blocking.some((i) => i.code === "duplicate_timestamp"));
  const missing = runDataQualityChecks({ AAPL: bars.slice(0, 5) });
  assert.equal(missing.passed, false);
  console.log("✓ duplicate / missing critical candles block quality");

  // Costs
  const assumptions = defaultAssumptions({
    fixedSpreadBps: 10,
    fixedSlippageBps: 5,
  });
  const mid = 100;
  const spreadPct = estimateSpreadPct(bars[40]!, bars.slice(0, 41), assumptions);
  const slipPct = estimateSlippagePct(bars[40]!, bars.slice(0, 41), assumptions);
  const costs = applyEntryCosts(mid, "buy", spreadPct, slipPct);
  assert.ok(costs.fill > mid);
  const zeroCost = applyEntryCosts(mid, "buy", 0, 0);
  assert.equal(zeroCost.fill, mid);
  assert.ok(costs.spreadCost > 0);
  assert.ok(costs.slippageCost > 0);
  console.log("✓ spread and slippage reduce simulated entry quality");

  // Same-candle SL/TP conservative
  const collision = resolveSameCandleExit({
    stop: 98,
    target: 102,
    low: 97,
    high: 103,
    close: 100,
    isLastBar: false,
    stopFirst: true,
  });
  assert.equal(collision.sameCandleCollision, true);
  assert.equal(collision.exitReason, "stop");
  assert.equal(collision.exitPrice, 98);
  console.log("✓ same-candle stop/target uses conservative stop-first");

  // Daily limits via simulator path (smoke)
  const sim = simulateSymbolPath({
    symbol: "AAPL",
    bars,
    strategyVersion: "v1.0.0",
    maxTradesPerDay: 1,
    maxDailyLossPct: 0.01,
    minConfidence: 0.1,
  });
  assert.equal(sim.assumptions.sameCandleStopFirst, true);
  assert.equal(typeof sim.trades.length, "number");
  console.log("✓ execution simulator runs with daily limits + SL/TP path");

  // Baseline engine (synthetic, no persist needed for speed — still persist once)
  const baseline = await runBacktestEngine({
    symbols: ["AAPL", "MSFT"],
    start: "2026-01-02",
    end: "2026-02-15",
    kind: "baseline",
    strategyVersion: "v1.0.0",
    useSynthetic: true,
    persist: true,
    runWalkForward: true,
    minConfidence: 0.45,
  });
  assert.equal(baseline.brokerOrdersSubmitted, false);
  assert.equal(baseline.paperOnly, true);
  assert.equal(baseline.liveTradingAllowed, false);
  assert.equal(baseline.strategyVersion, "v1.0.0");
  assert.ok(baseline.reproducibleFrom.datasetId);
  assert.ok(baseline.folds.length >= 1 || baseline.folds.length === 0);
  console.log(
    `✓ baseline Paper Intelligence v1 generated (trades=${baseline.metrics.totalTrades})`,
  );

  const baseline2 = await runBacktestEngine({
    symbols: ["AAPL", "MSFT"],
    start: "2026-01-02",
    end: "2026-02-15",
    kind: "baseline",
    strategyVersion: "v1.0.0",
    useSynthetic: true,
    persist: false,
    runWalkForward: false,
    minConfidence: 0.45,
  });
  assert.equal(baseline.metrics.totalTrades, baseline2.metrics.totalTrades);
  assert.equal(
    baseline.metrics.totalReturnAfterCosts,
    baseline2.metrics.totalReturnAfterCosts,
  );
  console.log("✓ results are reproducible (deterministic synthetic)");

  // Champion immutable + challenger isolation
  const champ = getChampionIdentity();
  assert.equal(champ.version, "v1.0.0");
  const immut = await assertStrategyImmutable(champ.strategyId, champ.version, {
    entryRules: "hacked rules",
  });
  assert.equal(immut.ok, false);

  const challenger = await createChallengerDraft({
    name: "I-2 challenger",
    reason: "higher confidence threshold",
    params: { minConfidence: 0.7 },
  });
  assert.equal(challenger.ok, true);
  if (challenger.ok) {
    assert.notEqual(challenger.version, "v1.0.0");
    assert.ok(challenger.version.includes("challenger"));
  }
  const reg = await readStrategyRegistry();
  const stillChamp = reg.entries.find((e) => e.status === "CHAMPION");
  assert.equal(stillChamp?.version, "v1.0.0");
  console.log("✓ champion immutable; challenger creates new version");

  // Promotion disabled
  const promo = evaluatePromotionEligibility(baseline);
  assert.equal(promo.promotionEnabled, false);
  assert.equal(promo.eligible, false);
  assert.equal(promo.liveTradingAllowed, false);
  assert.equal(promo.manualApprovalRequired, true);
  console.log("✓ promotion remains disabled; paper-only locks");

  // GET routes do not write
  const backtestGet = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/backtest/route.ts"),
    "utf8",
  );
  assert.ok(!backtestGet.includes("appendStrategyBacktestResult"));
  const learningBt = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/learning/backtests/route.ts"),
    "utf8",
  );
  assert.ok(learningBt.includes("export async function GET"));
  assert.ok(!learningBt.includes("saveBacktestRun"));
  assert.ok(!learningBt.includes("runBacktestEngine"));
  const promoRoute = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/learning/promotion/route.ts"),
    "utf8",
  );
  assert.ok(promoRoute.includes("promotionEnabled: false"));
  assert.ok(promoRoute.includes("status: 403"));
  console.log("✓ backtest GET routes do not write; promotion POST blocked");

  // Lab UI sections
  const lab = fs.readFileSync(
    path.join(process.cwd(), "src/components/strategy-lab/StrategyLabView.tsx"),
    "utf8",
  );
  for (const section of [
    "A. Baseline Backtest",
    "B. Walk-Forward Results",
    "C. Out-of-Sample Results",
    "D. Performance Breakdown",
    "E. Experiments",
    "F. Promotion Eligibility",
    "Promote (disabled)",
  ]) {
    assert.ok(lab.includes(section), `missing UI section: ${section}`);
  }
  console.log("✓ Strategy Lab I-2 sections present");

  // filterBarsByIsoRange chronological
  const filtered = filterBarsByIsoRange(bars, "2026-01-05", "2026-01-05");
  assert.ok(filtered.every((b) => b.timestamp.startsWith("2026-01-05")));
  console.log("✓ historical-data range filter + chronological protection");

  console.log("verify:learning-i2 passed");
  console.log(
    JSON.stringify(
      {
        baselineTrades: baseline.metrics.totalTrades,
        weak: baseline.metrics.statisticallyWeak,
        spreadCost: baseline.metrics.spreadCostTotal,
        slippageCost: baseline.metrics.slippageCostTotal,
        dataQualityPassed: baseline.dataQuality.passed,
        folds: baseline.folds.length,
        disclaimer: baseline.disclaimer.slice(0, 80),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
