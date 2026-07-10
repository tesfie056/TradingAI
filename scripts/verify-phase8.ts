/**
 * Phase 8 verification:
 * - auto trading disabled by default
 * - no live endpoint allowed
 * - paper endpoint only
 * - notional order sends notional only
 * - qty and notional never both sent
 * - max notional enforced
 * - daily trade limit enforced
 * - cooldown enforced
 * - loss limit enforced
 * - HOLD/WATCH never auto trade
 * - market closed blocks auto trade
 * - high risk blocks auto trade
 * - stale quote blocks auto trade
 * - kill switch stops auto trading
 * - no secrets logged
 *
 * Run: npm run verify:phase8
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildAlpacaOrderBody } from "../src/lib/alpaca/client";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "../src/lib/alpaca/safety";
import {
  getAutoDefaultNotionalAmount,
  getAutoMaxNotionalPerTrade,
  getAutoTradeCooldownMinutes,
  getMaxDailyPaperLoss,
  getMaxDailyPaperTrades,
  getMinConfidenceForAutoTrade,
  isAutoPaperTradingEnabled,
  isPaperOrderExecutionEnabled,
} from "../src/lib/config";
import { getAutoTradePolicy } from "../src/lib/auto-trade/policy";
import { evaluateAutoTradeEligibility } from "../src/lib/auto-trade/eligibility";
import type { MonitorOpportunity } from "../src/lib/monitor/types";
import type { DataQuality } from "../src/lib/alpaca/types";

const goodDq: DataQuality = {
  isMarketOpen: true,
  isQuoteStale: false,
  spreadPercent: 0.002,
  hasRecentBars: true,
  warningMessages: [],
};

function sampleOpp(
  overrides: Partial<MonitorOpportunity> = {},
): MonitorOpportunity {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? "opp_test_1",
    symbol: overrides.symbol ?? "AAPL",
    action: overrides.action ?? "BUY",
    score: 0.7,
    confidence: overrides.confidence ?? 0.8,
    reason: "Test opportunity",
    marketStatus: overrides.marketStatus ?? "open",
    newsSummary: "Quiet",
    timestamp: now,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    paperOnly: true,
    technicalScore: 0.7,
    newsScore: 0.6,
    marketScore: 0.6,
    riskScore: overrides.riskScore ?? 0.75,
    blockedReasons: overrides.blockedReasons ?? [],
    readyForPaperPreview: overrides.readyForPaperPreview ?? true,
    ollamaUsed: false,
    ...overrides,
  };
}

function eligibilityBase(
  overrides: Partial<Parameters<typeof evaluateAutoTradeEligibility>[0]> = {},
) {
  return {
    opportunity: sampleOpp(),
    envEnabled: true,
    executionEnabled: true,
    runtimeBlocked: false,
    killSwitch: false,
    panicStop: false,
    paperEndpointOk: true,
    dataQuality: goodDq,
    riskStatus: "low" as const,
    estimatedPrice: 180,
    notional: 5,
    dailyTradeCount: 0,
    dailyEstimatedPnL: 0,
    buyingPower: 1000,
    hasPosition: false,
    positionQty: 0,
    buyCooldownActive: false,
    sellCooldownActive: false,
    opportunityAlreadyProcessed: false,
    symbolTradedThisScan: false,
    recentBuyWithoutSell: false,
    lastTradeWasLoss: false,
    ...overrides,
  };
}

async function main() {
  console.log("verify:phase8 starting…");

  assert.equal(isAutoPaperTradingEnabled(), false);
  console.log("✓ auto trading disabled by default");

  assert.throws(
    () => assertPaperTradingOnly("https://api.alpaca.markets"),
    PaperTradingSafetyError,
  );
  console.log("✓ live trading endpoint blocked");

  const notionalBody = buildAlpacaOrderBody({
    symbol: "AAPL",
    notional: getAutoDefaultNotionalAmount(),
    side: "buy",
  });
  assert.equal(notionalBody.notional, String(getAutoDefaultNotionalAmount()));
  assert.equal(notionalBody.qty, undefined);
  console.log("✓ notional order sends notional only");

  assert.throws(
    () =>
      buildAlpacaOrderBody({
        symbol: "AAPL",
        qty: 1,
        notional: 5,
        side: "buy",
      } as Parameters<typeof buildAlpacaOrderBody>[0]),
    /cannot include both/i,
  );
  console.log("✓ qty and notional never both sent");

  const overMax = evaluateAutoTradeEligibility(
    eligibilityBase({ notional: getAutoMaxNotionalPerTrade() + 1 }),
  );
  assert.equal(overMax.eligible, false);
  assert.ok(overMax.blockers.some((b) => b.code === "max_notional"));
  console.log("✓ max notional enforced");

  const dailyLimit = evaluateAutoTradeEligibility(
    eligibilityBase({ dailyTradeCount: getMaxDailyPaperTrades() }),
  );
  assert.equal(dailyLimit.eligible, false);
  assert.ok(dailyLimit.blockers.some((b) => b.code === "max_daily_trades"));
  console.log("✓ daily trade limit enforced");

  const lossLimit = evaluateAutoTradeEligibility(
    eligibilityBase({ dailyEstimatedPnL: -(getMaxDailyPaperLoss() + 1) }),
  );
  assert.equal(lossLimit.eligible, false);
  assert.ok(lossLimit.blockers.some((b) => b.code === "max_daily_loss"));
  console.log("✓ loss limit enforced");

  const buyCooldown = evaluateAutoTradeEligibility(
    eligibilityBase({ buyCooldownActive: true }),
  );
  assert.equal(buyCooldown.eligible, false);
  assert.ok(buyCooldown.blockers.some((b) => b.code === "duplicate_symbol"));
  console.log("✓ no duplicate BUY on same symbol (30 min cooldown)");

  const duplicateScan = evaluateAutoTradeEligibility(
    eligibilityBase({ symbolTradedThisScan: true }),
  );
  assert.equal(duplicateScan.eligible, false);
  assert.ok(duplicateScan.blockers.some((b) => b.code === "duplicate_symbol"));
  console.log("✓ no duplicate trade for same symbol in one scan");

  const sellDisabled = evaluateAutoTradeEligibility(
    eligibilityBase({
      opportunity: sampleOpp({ action: "SELL" }),
      hasPosition: true,
      positionQty: 1,
    }),
  );
  assert.equal(sellDisabled.eligible, false);
  assert.ok(sellDisabled.blockers.some((b) => b.code === "sell_auto_disabled"));
  console.log("✓ SELL auto disabled by default");

  const sellAutoDefault = (await import("../src/lib/config")).isAllowSellAuto();
  assert.equal(sellAutoDefault, false);
  console.log("✓ ALLOW_SELL_AUTO off until explicitly true");

  assert.equal(getAutoDefaultNotionalAmount(), 5);
  assert.equal(getAutoMaxNotionalPerTrade(), 10);
  assert.equal(getAutoTradeCooldownMinutes(), 30);
  assert.equal(getMaxDailyPaperTrades(), 3);
  console.log("✓ defaults: $5 size, $10 max, 3/day, 30 min cooldown");

  const hold = evaluateAutoTradeEligibility(
    eligibilityBase({ opportunity: sampleOpp({ action: "HOLD" }) }),
  );
  assert.equal(hold.eligible, false);
  assert.ok(hold.blockers.some((b) => b.code === "hold_action"));
  console.log("✓ HOLD never auto trades");

  const watch = evaluateAutoTradeEligibility(
    eligibilityBase({ opportunity: sampleOpp({ action: "WATCH" }) }),
  );
  assert.equal(watch.eligible, false);
  assert.ok(watch.blockers.some((b) => b.code === "watch_action"));
  console.log("✓ WATCH never auto trades");

  const closed = evaluateAutoTradeEligibility(
    eligibilityBase({
      opportunity: sampleOpp({ marketStatus: "closed" }),
      dataQuality: { ...goodDq, isMarketOpen: false },
    }),
  );
  assert.equal(closed.eligible, false);
  assert.ok(closed.blockers.some((b) => b.code === "market_closed"));
  console.log("✓ market closed blocks auto trade");

  const highRisk = evaluateAutoTradeEligibility(
    eligibilityBase({
      riskStatus: "high",
      opportunity: sampleOpp({ riskScore: 0.2 }),
    }),
  );
  assert.equal(highRisk.eligible, false);
  assert.ok(highRisk.blockers.some((b) => b.code === "high_risk"));
  console.log("✓ high risk blocks auto trade");

  const stale = evaluateAutoTradeEligibility(
    eligibilityBase({
      dataQuality: { ...goodDq, isQuoteStale: true },
    }),
  );
  assert.equal(stale.eligible, false);
  assert.ok(stale.blockers.some((b) => b.code === "stale_quote"));
  console.log("✓ stale quote blocks auto trade");

  const lowConf = evaluateAutoTradeEligibility(
    eligibilityBase({
      opportunity: sampleOpp({ confidence: getMinConfidenceForAutoTrade() - 0.1 }),
    }),
  );
  assert.equal(lowConf.eligible, false);
  assert.ok(lowConf.blockers.some((b) => b.code === "low_confidence"));
  console.log("✓ confidence threshold enforced");

  const kill = evaluateAutoTradeEligibility(
    eligibilityBase({ killSwitch: true, runtimeBlocked: true }),
  );
  assert.equal(kill.eligible, false);
  assert.ok(kill.blockers.some((b) => b.code === "kill_switch_active"));
  console.log("✓ kill switch stops auto trading");

  const disabled = evaluateAutoTradeEligibility(
    eligibilityBase({ envEnabled: false }),
  );
  assert.equal(disabled.eligible, false);
  assert.ok(disabled.blockers.some((b) => b.code === "auto_trading_disabled"));
  console.log("✓ env gate blocks when disabled");

  const ok = evaluateAutoTradeEligibility(eligibilityBase());
  assert.equal(ok.eligible, true);
  console.log("✓ eligible opportunity passes all checks");

  // Module layout
  const autoDir = path.join(process.cwd(), "src", "lib", "auto-trade");
  assert.ok(fs.existsSync(autoDir));
  for (const file of [
    "types.ts",
    "eligibility.ts",
    "service.ts",
    "runtime.ts",
    "logs.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(autoDir, file)), `${file} exists`);
  }
  console.log("✓ auto-trade module present");

  // Monitor delegates to auto-trade, does not call placePaperOrder directly
  const monitorDir = path.join(process.cwd(), "src", "lib", "monitor");
  for (const file of fs.readdirSync(monitorDir)) {
    if (!file.endsWith(".ts")) continue;
    const src = fs.readFileSync(path.join(monitorDir, file), "utf8");
    const code = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .join("\n");
    assert.equal(/\bplacePaperOrder\b/.test(code), false, `${file} must not call placePaperOrder`);
  }
  console.log("✓ monitor does not call placePaperOrder directly");

  const scannerSrc = fs.readFileSync(path.join(monitorDir, "scanner.ts"), "utf8");
  assert.match(scannerSrc, /processAutoTradesForScan/);
  console.log("✓ scanner integrates auto-trade processor");

  // Runtime kill switch
  const { activateKillSwitch, resetAutoTradeRuntimeForTests } = await import(
    "../src/lib/auto-trade/runtime"
  );
  const { getAutoTradeStatus } = await import("../src/lib/auto-trade/status");
  await resetAutoTradeRuntimeForTests();
  await activateKillSwitch();
  const status = await getAutoTradeStatus();
  assert.equal(status.killSwitch, true);
  assert.equal(status.effectivelyEnabled, false);
  console.log("✓ kill switch updates runtime status");

  // Logs redaction
  const { appendAutoTradeLog, readAutoTradeLogs } = await import(
    "../src/lib/auto-trade/logs"
  );
  await appendAutoTradeLog({
    event: "opportunity_detected",
    message: "test PKSECRETKEY1234567890 Bearer abc.def",
  });
  const logs = await readAutoTradeLogs(3);
  const leaked = logs.some((l) => /PKSECRETKEY1234567890|Bearer abc/.test(l.message));
  assert.equal(leaked, false);
  assert.ok(logs[0]?.message.includes("REDACTED"));
  console.log("✓ no secrets logged");

  assert.equal(isPaperOrderExecutionEnabled(), false);
  console.log("✓ paper execution still disabled by default");

  const apiAuto = path.join(process.cwd(), "src", "app", "api", "auto-trade");
  assert.ok(fs.existsSync(apiAuto));
  console.log("✓ auto-trade API routes present");

  const policy = getAutoTradePolicy();
  assert.equal(policy.paperOnly, true);
  assert.equal(policy.liveTradingAllowed, false);
  assert.ok(policy.rules.some((r) => r.id === "kill_switch"));
  assert.ok(policy.rules.some((r) => r.id === "panic_stop"));
  console.log("✓ policy documents kill switch and panic stop");

  const skipped = evaluateAutoTradeEligibility(
    eligibilityBase({ killSwitch: true }),
  );
  assert.ok(skipped.blockers.every((b) => b.code && b.message));
  console.log("✓ every skip reason has code and message");

  console.log("verify:phase8 passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
