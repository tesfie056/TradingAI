/**
 * Phase 5 verification:
 * - no order execution
 * - no live endpoint
 * - history files are gitignored
 * - backtest does not call order API
 * - secrets are not logged
 * - outcome scoring works
 *
 * Run: npm run verify:phase5
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { placePaperOrder } from "../src/lib/alpaca/client";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "../src/lib/alpaca/safety";
import { isPaperOrderExecutionEnabled } from "../src/lib/config";
import { scoreDecisionOutcome } from "../src/lib/performance/score";
import { decisionToPerformanceEntry } from "../src/lib/performance/from-decision";
import type { AiDecision } from "../src/lib/alpaca/types";

async function main() {
  delete process.env.ENABLE_PAPER_ORDER_EXECUTION;
  assert.equal(isPaperOrderExecutionEnabled(), false);
  await assert.rejects(
    () => placePaperOrder({ symbol: "AAPL", qty: 1, side: "buy" }),
    /disabled/i,
  );

  try {
    assertPaperTradingOnly("https://api.alpaca.markets");
    assert.fail("live should be blocked");
  } catch (e) {
    assert.ok(e instanceof PaperTradingSafetyError);
  }

  // history path gitignored
  const ignored = execSync("git check-ignore -v data/decision-history.jsonl", {
    encoding: "utf8",
  });
  assert.ok(ignored.includes("data") || ignored.includes(".gitignore"));

  // scoring
  const buyGood = scoreDecisionOutcome({
    action: "BUY",
    entryPrice: 100,
    laterPrice: 101,
    horizon: "m15",
  });
  assert.equal(buyGood.label, "correct");
  assert.ok((buyGood.estimatedPnlPct ?? 0) > 0);

  const sellGood = scoreDecisionOutcome({
    action: "SELL",
    entryPrice: 100,
    laterPrice: 99,
    horizon: "h1",
  });
  assert.equal(sellGood.label, "correct");

  const holdFlat = scoreDecisionOutcome({
    action: "HOLD",
    entryPrice: 100,
    laterPrice: 100.05,
    horizon: "m15",
  });
  assert.equal(holdFlat.label, "correct");

  const decision: AiDecision = {
    symbol: "AAPL",
    action: "HOLD",
    confidence: 0.7,
    reasons: ["Market is closed — defaulting to HOLD"],
    riskWarnings: [],
    riskStatus: "high",
    timestamp: new Date().toISOString(),
    paperOnly: true,
    dataQuality: {
      isMarketOpen: false,
      isQuoteStale: true,
      spreadPercent: 0.01,
      hasRecentBars: false,
      warningMessages: [],
    },
    newsContext: {
      overallSentiment: "positive",
      highestImportance: "medium",
      sentimentScore: 0.3,
      explanation: "heuristic lean positive",
      headlines: ["x"],
    },
    metrics: {
      last: 190,
      mid: 190,
      spreadPct: 0.01,
      trendPct: null,
      rangePct: null,
      volumeRatio: null,
    },
  };

  const row = decisionToPerformanceEntry(decision, { aiProvider: "heuristic" });
  assert.equal(row.paperOnly, true);
  assert.equal(row.orderExecuted, false);
  assert.equal(row.priceAtDecision, 190);
  assert.equal(row.marketOpen, false);
  assert.equal(row.newsSentiment, "positive");
  assert.equal(row.overallLabel, "pending");

  // backtest module must not import placePaperOrder
  const backtestSrc = fs.readFileSync("src/lib/performance/backtest.ts", "utf8");
  assert.equal(backtestSrc.includes("placePaperOrder"), false);
  assert.equal(backtestSrc.includes("/v2/orders"), false);

  // no console in performance libs
  for (const f of [
    "src/lib/performance/score.ts",
    "src/lib/performance/backtest.ts",
    "src/lib/performance/update-outcomes.ts",
    "src/lib/ai/history.ts",
  ]) {
    const src = fs.readFileSync(f, "utf8");
    assert.equal(/console\./.test(src), false, `console found in ${f}`);
  }

  console.log("verify-phase5: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
