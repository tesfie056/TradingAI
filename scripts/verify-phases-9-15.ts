/**
 * Phases 9–15 master verification.
 * Run: npm run verify:phases-9-15
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

async function main() {
  console.log("verify:phases-9-15 starting…");

  execSync("npm run verify:phase8", { stdio: "inherit" });
  execSync("npm run verify:phase9", { stdio: "inherit" });
  execSync("npm run verify:phase10", { stdio: "inherit" });

  const {
    buildDecisionScores,
    chooseDecisionLabel,
    volumeToScore,
    momentumToScore,
    liquidityToScore,
  } = await import("../src/lib/stocks/scoring");

  const scores = buildDecisionScores({
    technicalScore: 0.7,
    newsScore: 0.6,
    marketScore: 0.65,
    riskScore: 0.8,
    volumeScore: volumeToScore(1.2),
    momentumScore: momentumToScore(1.8),
    liquidityScore: liquidityToScore(0.003, 1.1),
  });
  assert.ok(scores.liquidityScore > 0);
  assert.ok(scores.volumeScore > 0);
  assert.ok(scores.momentumScore > 0);
  assert.ok(scores.finalScore > 0);
  console.log("✓ Phase 11 extended scores");

  const label = chooseDecisionLabel({
    action: "BUY",
    blockReasons: [],
    technicalLean: 1.8,
    finalScore: 0.62,
  });
  assert.equal(label, "BUY");
  const skip = chooseDecisionLabel({
    action: "HOLD",
    blockReasons: ["Quote is stale."],
    technicalLean: 0.2,
    finalScore: 0.5,
  });
  assert.equal(skip, "SKIP");
  console.log("✓ Phase 11 decision labels BUY/SELL/HOLD/WATCH/SKIP");

  const { getStrategyConfig, getStrategyVersion } = await import(
    "../src/lib/strategy/version"
  );
  assert.ok(getStrategyVersion().startsWith("v"));
  assert.ok(getStrategyConfig().weights.technical > 0);
  console.log("✓ Phase 15 strategy version config");

  const { explainTradeDecision } = await import("../src/lib/ai/trade-reasoning");
  const reasoning = await explainTradeDecision({
    decision: {
      symbol: "AAPL",
      action: "HOLD",
      decisionLabel: "WATCH",
      confidence: 0.55,
      reasons: ["test"],
      riskWarnings: [],
      riskStatus: "low",
      timestamp: new Date().toISOString(),
      paperOnly: true,
      scores,
    },
    blockers: [{ code: "low_confidence", message: "Below threshold" }],
    placed: false,
  });
  assert.ok(reasoning.summary.length > 0);
  assert.ok(reasoning.allowBlock.length > 0);
  assert.equal(reasoning.provider, "heuristic");
  console.log("✓ Phase 12 trade reasoning (heuristic, no orders)");

  const { recordSignalDecision, readSignalTraining } = await import(
    "../src/lib/training/signal-loop"
  );
  await recordSignalDecision({
    source: "auto_trade",
    symbol: "MSFT",
    action: "BUY",
    priceAtDecision: 420,
    confidence: 0.8,
    scores,
    placed: false,
    skipCodes: ["low_confidence"],
    reason: "test training loop",
  });
  const training = await readSignalTraining(5);
  assert.ok(training.some((t) => t.symbol === "MSFT"));
  assert.ok(training[0]?.outcomes.m5);
  console.log("✓ Phase 13 signal training loop");

  const { getAutoTradeAnalytics } = await import(
    "../src/lib/performance/auto-trade-analytics"
  );
  const analytics = await getAutoTradeAnalytics();
  assert.equal(analytics.paperOnly, true);
  assert.ok(analytics.strategyVersion);
  console.log("✓ Phase 14 auto-trade analytics");

  const { readStrategyResults } = await import("../src/lib/strategy/results");
  const results = await readStrategyResults(5);
  assert.ok(Array.isArray(results));
  console.log("✓ Phase 15 strategy results store readable");

  console.log("verify:phases-9-15 passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
