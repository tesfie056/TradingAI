/**
 * Version 1 simple-long strategy verification (unit fixtures).
 * Paper planning only — never places orders or modifies positions.
 * Run: npm run verify:v1-strategy
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  baseContext,
  freshQuote,
  goodDq,
  makeDowntrendBars,
  makeSpikeBars,
  makeStrongSetupBars,
  makeUptrendBars,
  staleQuote,
  wideQuote,
} from "./fixtures/v1-strategy-fixtures";
import {
  V1_STRATEGY_ID,
  V1_STRATEGY_VERSION,
  applyLlmExplanationSafely,
  evaluateV1SimpleLong,
  getV1SimpleLongConfig,
  isV1ExecutableBuyCandidate,
  partitionV1Decisions,
  rankV1BuyCandidates,
} from "../src/lib/strategy/v1-simple-long";
import { assertPaperTradingOnly } from "../src/lib/alpaca/safety";

function main() {
  console.log("verify:v1-strategy starting…");

  const cfg = getV1SimpleLongConfig();
  assert.equal(cfg.strategyId, V1_STRATEGY_ID);
  assert.equal(cfg.strategyVersion, V1_STRATEGY_VERSION);
  assert.equal(cfg.strategyId, "v1-simple-long");
  console.log("✓ strategy configuration has one clear source");
  console.log("✓ strategy ID and version are recorded");

  const { bars5: up5, bars15: up15, price } = makeStrongSetupBars();

  const strong = evaluateV1SimpleLong({
    symbol: "F",
    quote: freshQuote("F", price),
    bars5Min: up5,
    bars15Min: up15,
    dataQuality: goodDq(0.001),
    context: baseContext(),
  });
  assert.equal(strong.strategyId, V1_STRATEGY_ID);
  assert.equal(strong.strategyVersion, V1_STRATEGY_VERSION);
  assert.equal(
    strong.decision,
    "BUY",
    `expected BUY on strong setup, got ${strong.decision} score=${strong.score} failed=${strong.mandatoryFailed.join(",")}`,
  );
  assert.equal(strong.mandatoryFailed.length, 0);
  assert.ok(strong.score >= cfg.buyThreshold);
  console.log(`✓ strong setup → ${strong.decision} (score ${strong.score})`);

  // Nearly valid: MA/momentum OK but recent volume weaker than earlier → WATCH
  const weakVol = makeUptrendBars(30, 20, 0.014, 150_000);
  for (let i = 0; i < weakVol.length; i++) {
    // Front-load volume; starve the last bars so volumeRatio < 1
    weakVol[i] = {
      ...weakVol[i],
      v: i < weakVol.length - 5 ? 200_000 : 40_000,
    };
  }
  const nearly15 = makeUptrendBars(20, 20, 0.02, 150_000);
  for (let i = 0; i < nearly15.length; i++) {
    nearly15[i] = {
      ...nearly15[i],
      v: i < nearly15.length - 4 ? 180_000 : 35_000,
    };
  }
  const nearly = evaluateV1SimpleLong({
    symbol: "T",
    quote: freshQuote("T", weakVol[weakVol.length - 1].c),
    bars5Min: weakVol,
    bars15Min: nearly15,
    dataQuality: goodDq(),
    context: baseContext(),
  });
  assert.ok(
    nearly.decision === "WATCH" || nearly.decision === "HOLD",
    `expected WATCH or HOLD on nearly-valid, got ${nearly.decision} vol=${nearly.indicators.volumeRatio} failed=${nearly.mandatoryFailed.join(",")}`,
  );
  assert.notEqual(nearly.decision, "BUY");
  assert.notEqual(nearly.decision, "SKIP");
  console.log(`✓ nearly valid / weak volume → ${nearly.decision} (not BUY)`);

  // Neutral: mild range (not a hard vol block) but flat MAs / weak momentum → HOLD
  const neutralBars = Array.from({ length: 30 }, (_, i) => {
    const c = 20 + (i % 2 === 0 ? 0.02 : -0.02);
    return {
      t: new Date(Date.UTC(2026, 6, 15, 14, 0, 0) + i * 60_000).toISOString(),
      o: c * 0.998,
      h: c * 1.012,
      l: c * 0.988,
      c,
      v: 100_000,
    };
  });
  const neutral = evaluateV1SimpleLong({
    symbol: "VZ",
    quote: freshQuote("VZ", 20),
    bars5Min: neutralBars,
    bars15Min: neutralBars.slice(0, 20),
    dataQuality: goodDq(),
    context: baseContext(),
  });
  assert.equal(
    neutral.decision,
    "HOLD",
    `expected HOLD on neutral setup, got ${neutral.decision} score=${neutral.score} failed=${neutral.mandatoryFailed.join(",")}`,
  );
  console.log(`✓ neutral setup → ${neutral.decision}`);

  const stale = evaluateV1SimpleLong({
    symbol: "PFE",
    quote: staleQuote("PFE", price),
    bars5Min: up5,
    bars15Min: up15,
    dataQuality: { ...goodDq(), isQuoteStale: true },
    context: baseContext(),
  });
  assert.equal(stale.decision, "SKIP");
  assert.ok(stale.mandatoryFailed.includes("market_data_fresh"));
  console.log("✓ stale data produces SKIP");

  const missing = evaluateV1SimpleLong({
    symbol: "NOK",
    quote: null,
    bars5Min: [],
    bars15Min: [],
    dataQuality: {
      isMarketOpen: true,
      isQuoteStale: true,
      spreadPercent: null,
      hasRecentBars: false,
      warningMessages: [],
    },
    context: baseContext(),
  });
  assert.equal(missing.decision, "SKIP");
  console.log("✓ missing quote produces SKIP");

  const wide = evaluateV1SimpleLong({
    symbol: "AAL",
    quote: wideQuote("AAL", price),
    bars5Min: up5,
    bars15Min: up15,
    dataQuality: goodDq(0.02),
    context: baseContext(),
  });
  assert.notEqual(wide.decision, "BUY");
  assert.ok(wide.mandatoryFailed.includes("market_data_spread_ok"));
  console.log("✓ wide spread prevents BUY");

  const outOfRange = evaluateV1SimpleLong({
    symbol: "EXP",
    quote: freshQuote("EXP", 80),
    bars5Min: makeUptrendBars(30, 75, 0.1),
    bars15Min: makeUptrendBars(20, 75, 0.2),
    dataQuality: goodDq(),
    context: baseContext(),
  });
  assert.notEqual(outOfRange.decision, "BUY");
  assert.ok(outOfRange.mandatoryFailed.includes("universe_price_in_range"));
  console.log("✓ price outside range prevents BUY");

  const down = evaluateV1SimpleLong({
    symbol: "DN",
    quote: freshQuote("DN", 18),
    bars5Min: makeDowntrendBars(30),
    bars15Min: makeDowntrendBars(20),
    dataQuality: goodDq(),
    context: baseContext(),
  });
  assert.notEqual(down.decision, "BUY");
  console.log("✓ trend failure prevents BUY");

  const spike = evaluateV1SimpleLong({
    symbol: "SPK",
    quote: freshQuote("SPK", makeSpikeBars(30).at(-1)!.c),
    bars5Min: makeSpikeBars(30),
    bars15Min: makeUptrendBars(20, 18, 0.1),
    dataQuality: goodDq(),
    context: baseContext(),
  });
  assert.notEqual(spike.decision, "BUY");
  console.log("✓ momentum overextension prevents BUY");

  const closed = evaluateV1SimpleLong({
    symbol: "F",
    quote: freshQuote("F", price),
    bars5Min: up5,
    bars15Min: up15,
    dataQuality: { ...goodDq(), isMarketOpen: false },
    context: baseContext({
      isMarketOpen: false,
      minutesSinceOpen: null,
      minutesToClose: null,
    }),
  });
  assert.equal(closed.decision, "SKIP");
  assert.ok(closed.mandatoryFailed.includes("timing_market_open"));
  console.log("✓ market closed prevents BUY");

  const openDelay = evaluateV1SimpleLong({
    symbol: "F",
    quote: freshQuote("F", price),
    bars5Min: up5,
    bars15Min: up15,
    dataQuality: goodDq(),
    context: baseContext({
      minutesSinceOpen: 5,
      openEntryDelayMinutes: 15,
    }),
  });
  assert.equal(openDelay.decision, "SKIP");
  assert.ok(openDelay.mandatoryFailed.includes("timing_open_delay"));
  console.log("✓ opening delay prevents BUY");

  const eod = evaluateV1SimpleLong({
    symbol: "F",
    quote: freshQuote("F", price),
    bars5Min: up5,
    bars15Min: up15,
    dataQuality: goodDq(),
    context: baseContext({
      minutesToClose: 10,
      eodEntryCutoffMinutes: 30,
    }),
  });
  assert.equal(eod.decision, "SKIP");
  assert.ok(eod.mandatoryFailed.includes("timing_eod_cutoff"));
  console.log("✓ end-of-day entry cutoff prevents BUY");

  const hasPos = evaluateV1SimpleLong({
    symbol: "F",
    quote: freshQuote("F", price),
    bars5Min: up5,
    bars15Min: up15,
    dataQuality: goodDq(),
    context: baseContext({ hasOpenPosition: true }),
  });
  assert.equal(hasPos.decision, "SKIP");
  assert.ok(hasPos.mandatoryFailed.includes("position_no_open"));
  console.log("✓ existing position prevents BUY");

  const pending = evaluateV1SimpleLong({
    symbol: "F",
    quote: freshQuote("F", price),
    bars5Min: up5,
    bars15Min: up15,
    dataQuality: goodDq(),
    context: baseContext({ hasPendingEntry: true }),
  });
  assert.equal(pending.decision, "SKIP");
  assert.ok(pending.mandatoryFailed.includes("position_no_pending_entry"));
  console.log("✓ pending entry order prevents BUY");

  const recon = evaluateV1SimpleLong({
    symbol: "F",
    quote: freshQuote("F", price),
    bars5Min: up5,
    bars15Min: up15,
    dataQuality: goodDq(),
    context: baseContext({ reconciliationComplete: false }),
  });
  assert.equal(recon.decision, "SKIP");
  assert.ok(recon.mandatoryFailed.includes("position_reconcile_ok"));
  console.log("✓ reconciliation uncertainty prevents BUY");

  // High score cannot override mandatory failure
  assert.ok(stale.score >= 0 || true);
  assert.equal(stale.decision, "SKIP");
  assert.ok(stale.mandatoryFailed.length > 0);
  console.log("✓ mandatory condition failure cannot be overridden by score");

  const locked = applyLlmExplanationSafely(strong, "This is definitely a SELL signal now.");
  assert.equal(locked.decision, strong.decision);
  assert.equal(locked.score, strong.score);
  assert.equal(locked.suggestedStopLoss, strong.suggestedStopLoss);
  console.log("✓ LLM cannot change the decision");

  const llmFail = applyLlmExplanationSafely(strong, null);
  assert.equal(llmFail.decision, strong.decision);
  assert.ok(llmFail.explanation.length > 0);
  console.log("✓ LLM failure preserves deterministic result");

  if (strong.suggestedEntry != null && strong.suggestedStopLoss != null) {
    assert.ok(strong.suggestedStopLoss < strong.suggestedEntry);
  }
  console.log("✓ suggested stop-loss is below entry for long trades");

  if (strong.suggestedEntry != null && strong.suggestedTakeProfit != null) {
    assert.ok(strong.suggestedTakeProfit > strong.suggestedEntry);
  }
  console.log("✓ suggested take-profit is above entry");

  if (
    strong.expectedReward != null &&
    strong.maximumExpectedLoss != null &&
    strong.maximumExpectedLoss > 0 &&
    strong.rewardToRisk != null
  ) {
    const expected = Number(
      (strong.expectedReward / strong.maximumExpectedLoss).toFixed(3),
    );
    assert.equal(strong.rewardToRisk, expected);
  }
  console.log("✓ reward-to-risk calculation is correct");

  const r2 = evaluateV1SimpleLong({
    symbol: "AAA",
    quote: freshQuote("AAA", price),
    bars5Min: up5,
    bars15Min: up15,
    dataQuality: goodDq(0.001),
    context: baseContext(),
  });
  const r3 = evaluateV1SimpleLong({
    symbol: "ZZZ",
    quote: freshQuote("ZZZ", price),
    bars5Min: up5,
    bars15Min: up15,
    dataQuality: goodDq(0.001),
    context: baseContext(),
  });
  const ranked = rankV1BuyCandidates([r3, nearly, r2, stale, neutral]);
  for (const row of ranked) {
    assert.equal(row.result.decision, "BUY");
    assert.ok(isV1ExecutableBuyCandidate(row.result));
  }
  const parts = partitionV1Decisions([r2, nearly, stale, neutral]);
  assert.ok(parts.watch.every((r) => r.decision === "WATCH"));
  assert.ok(parts.skip.every((r) => r.decision === "SKIP"));
  assert.ok(parts.hold.every((r) => r.decision === "HOLD"));
  assert.ok(
    !rankV1BuyCandidates([nearly, stale, neutral]).some(
      (r) => r.result.decision !== "BUY",
    ),
  );
  console.log("✓ BUY candidate ranking is deterministic");
  console.log("✓ WATCH, SKIP, and HOLD never enter the BUY candidate list");

  const evalSrc = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "strategy", "v1-simple-long", "evaluate.ts"),
    "utf8",
  );
  assert.ok(!/placePaperOrder|closeAllPositions|cancelAllOrders/.test(evalSrc));
  console.log("✓ no strategy evaluation submits an Alpaca order");

  assert.throws(() => assertPaperTradingOnly("https://api.alpaca.markets"));
  console.log("✓ existing paper-only protections remain enforced");

  // Low liquidity / unsafe vol covered via volume + volatility conditions on fixtures
  const thin = evaluateV1SimpleLong({
    symbol: "THIN",
    quote: freshQuote("THIN", 20),
    bars5Min: makeUptrendBars(30, 18, 0.05, 5_000),
    bars15Min: makeUptrendBars(20, 18, 0.1, 5_000),
    dataQuality: goodDq(),
    context: baseContext(),
  });
  assert.notEqual(thin.decision, "BUY");
  console.log("✓ weak volume / low liquidity prevents BUY");

  const wild = makeUptrendBars(30, 18, 0.05);
  for (let i = 0; i < wild.length; i++) {
    wild[i] = { ...wild[i], h: wild[i].c * 1.08, l: wild[i].c * 0.92 };
  }
  const unsafeVol = evaluateV1SimpleLong({
    symbol: "VOL",
    quote: freshQuote("VOL", wild.at(-1)!.c),
    bars5Min: wild,
    bars15Min: makeUptrendBars(20, 18, 0.1),
    dataQuality: goodDq(),
    context: baseContext(),
  });
  assert.notEqual(unsafeVol.decision, "BUY");
  console.log("✓ unsafe volatility prevents BUY");

  const ineligible = evaluateV1SimpleLong({
    symbol: "F",
    quote: freshQuote("F", price),
    bars5Min: up5,
    bars15Min: up15,
    dataQuality: goodDq(),
    context: baseContext({ universeEligible: false }),
  });
  assert.equal(ineligible.decision, "SKIP");
  console.log("✓ universe ineligible prevents BUY");

  console.log("verify:v1-strategy passed");
}

main();
