/**
 * Phase 6 verification:
 * - execution disabled by default blocks orders
 * - live endpoint blocks orders
 * - market closed / stale quote / high risk / HOLD block orders
 * - valid manual-approved paper order gates pass only when enabled
 * - no secrets logged
 * - no automatic trading (manual approval required)
 *
 * Run: npm run verify:phase6
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { placePaperOrder } from "../src/lib/alpaca/client";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "../src/lib/alpaca/safety";
import {
  getMaxDailyPaperTrades,
  getMaxPaperTradeNotional,
  isPaperOrderExecutionEnabled,
} from "../src/lib/config";
import { evaluateOrderGates } from "../src/lib/trades/gates";
import type { DataQuality } from "../src/lib/alpaca/types";

const goodDq: DataQuality = {
  isMarketOpen: true,
  isQuoteStale: false,
  spreadPercent: 0.001,
  hasRecentBars: true,
  warningMessages: [],
};

function baseGateInput(
  overrides: Partial<Parameters<typeof evaluateOrderGates>[0]> = {},
) {
  return {
    executionEnabled: true,
    paperEndpointOk: true,
    action: "BUY" as const,
    side: "buy" as const,
    riskStatus: "low" as const,
    dataQuality: goodDq,
    orderMode: "quantity" as const,
    qty: 1,
    notional: null,
    estimatedPrice: 100,
    maxNotional: 500,
    dailyTradeCount: 0,
    maxDailyTrades: 5,
    requireManualApproval: true,
    manualApproved: true,
    confirmed: true,
    ...overrides,
  };
}

async function main() {
  // --- execution disabled by default ---
  delete process.env.ENABLE_PAPER_ORDER_EXECUTION;
  assert.equal(isPaperOrderExecutionEnabled(), false);
  await assert.rejects(
    () => placePaperOrder({ symbol: "AAPL", qty: 1, side: "buy" }),
    /disabled/i,
  );

  const disabled = evaluateOrderGates(
    baseGateInput({ executionEnabled: false }),
  );
  assert.equal(disabled.allowed, false);
  assert.ok(disabled.blockers.some((b) => b.code === "execution_disabled"));

  // --- live endpoint blocked ---
  try {
    assertPaperTradingOnly("https://api.alpaca.markets");
    assert.fail("live should be blocked");
  } catch (e) {
    assert.ok(e instanceof PaperTradingSafetyError);
  }

  const liveGate = evaluateOrderGates(
    baseGateInput({ paperEndpointOk: false }),
  );
  assert.equal(liveGate.allowed, false);
  assert.ok(liveGate.blockers.some((b) => b.code === "live_endpoint"));

  // --- market closed ---
  const closed = evaluateOrderGates(
    baseGateInput({
      dataQuality: { ...goodDq, isMarketOpen: false },
    }),
  );
  assert.equal(closed.allowed, false);
  assert.ok(closed.blockers.some((b) => b.code === "market_closed"));

  // --- stale quote ---
  const stale = evaluateOrderGates(
    baseGateInput({
      dataQuality: { ...goodDq, isQuoteStale: true },
    }),
  );
  assert.equal(stale.allowed, false);
  assert.ok(stale.blockers.some((b) => b.code === "stale_quote"));

  // --- wide spread ---
  const wide = evaluateOrderGates(
    baseGateInput({
      dataQuality: { ...goodDq, spreadPercent: 0.02 },
    }),
  );
  assert.equal(wide.allowed, false);
  assert.ok(wide.blockers.some((b) => b.code === "wide_spread"));

  // --- high risk ---
  const highRisk = evaluateOrderGates(
    baseGateInput({ riskStatus: "high" }),
  );
  assert.equal(highRisk.allowed, false);
  assert.ok(highRisk.blockers.some((b) => b.code === "high_risk"));

  // --- HOLD blocked ---
  const hold = evaluateOrderGates(
    baseGateInput({ action: "HOLD", side: "buy" }),
  );
  assert.equal(hold.allowed, false);
  assert.ok(hold.blockers.some((b) => b.code === "hold_decision"));

  // --- missing manual approval ---
  const noApproval = evaluateOrderGates(
    baseGateInput({ manualApproved: false, confirmed: false }),
  );
  assert.equal(noApproval.allowed, false);
  assert.ok(noApproval.blockers.some((b) => b.code === "missing_approval"));

  // --- max notional ---
  const overNotional = evaluateOrderGates(
    baseGateInput({ qty: 10, estimatedPrice: 100, maxNotional: 500 }),
  );
  assert.equal(overNotional.allowed, false);
  assert.ok(overNotional.blockers.some((b) => b.code === "max_notional"));

  // --- valid manual approved paper order when enabled ---
  const valid = evaluateOrderGates(baseGateInput());
  assert.equal(valid.allowed, true);
  assert.equal(valid.blockers.length, 0);
  assert.ok(valid.warnings.some((w) => /PAPER TRADE ONLY/i.test(w)));

  // Enabling env alone is not enough without approval + gates
  process.env.ENABLE_PAPER_ORDER_EXECUTION = "true";
  assert.equal(isPaperOrderExecutionEnabled(), true);
  const stillNeedsApproval = evaluateOrderGates(
    baseGateInput({
      executionEnabled: true,
      manualApproved: false,
      confirmed: true,
    }),
  );
  assert.equal(stillNeedsApproval.allowed, false);

  // placePaperOrder still requires credentials when enabled — must not silently succeed
  delete process.env.ALPACA_API_KEY;
  delete process.env.ALPACA_SECRET_KEY;
  await assert.rejects(
    () => placePaperOrder({ symbol: "AAPL", qty: 1, side: "buy" }),
    /ALPACA_API_KEY|ALPACA_SECRET_KEY|Missing/i,
  );

  // restore disabled default for remaining checks
  delete process.env.ENABLE_PAPER_ORDER_EXECUTION;
  assert.equal(isPaperOrderExecutionEnabled(), false);

  // --- config defaults ---
  // maxTradesPerDay seeds from env (default 3); soak profile would lower to 2.
  delete process.env.MAX_PAPER_TRADE_NOTIONAL;
  delete process.env.MAX_DAILY_PAPER_TRADES;
  delete process.env.PAPER_SOAK_PROFILE;
  assert.equal(getMaxPaperTradeNotional(), 500);
  assert.equal(getMaxDailyPaperTrades(), 3);

  // --- API routes exist; submit requires manual path ---
  assert.ok(fs.existsSync("src/app/api/trades/preview/route.ts"));
  assert.ok(fs.existsSync("src/app/api/trades/submit-paper/route.ts"));

  const submitSrc = fs.readFileSync(
    "src/app/api/trades/submit-paper/route.ts",
    "utf8",
  );
  assert.ok(submitSrc.includes("submitManualPaperOrder"));
  assert.ok(submitSrc.includes("manualApproval"));

  const paperOrderSrc = fs.readFileSync(
    "src/lib/trades/paper-order.ts",
    "utf8",
  );
  assert.ok(paperOrderSrc.includes("evaluateOrderGates"));
  assert.ok(paperOrderSrc.includes("placePaperOrder"));
  // no auto-loop / cron style auto trading
  assert.equal(paperOrderSrc.includes("setInterval"), false);
  assert.equal(paperOrderSrc.includes("cron"), false);

  // --- no secrets logged ---
  for (const f of [
    "src/lib/trades/gates.ts",
    "src/lib/trades/paper-order.ts",
    "src/lib/trades/daily-limit.ts",
    "src/app/api/trades/preview/route.ts",
    "src/app/api/trades/submit-paper/route.ts",
  ]) {
    const src = fs.readFileSync(f, "utf8");
    assert.equal(src.includes("console.log"), false, `${f} must not console.log`);
    assert.equal(src.includes("ALPACA_SECRET_KEY"), false);
    assert.equal(src.includes("FINNHUB_API_KEY"), false);
  }

  // .env.example keeps execution commented / off by default
  const envExample = fs.readFileSync(".env.example", "utf8");
  assert.ok(envExample.includes("# ENABLE_PAPER_ORDER_EXECUTION=true"));
  assert.ok(envExample.includes("MAX_PAPER_TRADE_NOTIONAL"));
  assert.ok(envExample.includes("MAX_DAILY_PAPER_TRADES"));
  assert.equal(
    /^\s*ENABLE_PAPER_ORDER_EXECUTION=true\s*$/m.test(envExample),
    false,
  );

  console.log("verify-phase6: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
