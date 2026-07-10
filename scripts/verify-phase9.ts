/**
 * Phase 9 — auto-trade stabilization verification.
 * Run: npm run verify:phase9
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

async function main() {
  console.log("verify:phase9 starting…");

  const { isAutoPaperTradingEnabled } = await import("../src/lib/config");
  assert.equal(isAutoPaperTradingEnabled(), false);
  console.log("✓ auto trading disabled by default");

  const { getAutoTradePolicy } = await import("../src/lib/auto-trade/policy");
  const policy = getAutoTradePolicy();
  assert.equal(policy.paperOnly, true);
  assert.ok(policy.rules.some((r) => r.id === "kill_switch"));
  assert.ok(policy.rules.some((r) => r.id === "max_daily"));
  assert.ok(policy.rules.some((r) => r.id === "cooldown"));
  assert.ok(policy.rules.some((r) => r.id === "max_trade"));
  console.log("✓ policy documents limits and kill switch");

  const { evaluateAutoTradeEligibility } = await import(
    "../src/lib/auto-trade/eligibility"
  );
  const { getAutoTradeStatus } = await import("../src/lib/auto-trade/status");
  const { activateKillSwitch, resetAutoTradeRuntimeForTests } = await import(
    "../src/lib/auto-trade/runtime"
  );

  const goodDq = {
    isMarketOpen: true,
    isQuoteStale: false,
    spreadPercent: 0.002,
    hasRecentBars: true,
    warningMessages: [] as string[],
  };

  const base = {
    opportunity: {
      id: "opp_p9",
      symbol: "AAPL",
      action: "BUY" as const,
      score: 0.7,
      confidence: 0.8,
      reason: "test",
      marketStatus: "open" as const,
      newsSummary: "quiet",
      timestamp: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      paperOnly: true as const,
      technicalScore: 0.7,
      newsScore: 0.6,
      marketScore: 0.6,
      riskScore: 0.75,
      blockedReasons: [],
      readyForPaperPreview: true,
      ollamaUsed: false,
    },
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
  };

  const kill = evaluateAutoTradeEligibility({ ...base, killSwitch: true });
  assert.equal(kill.eligible, false);
  assert.equal(kill.blockers[0]?.code, "kill_switch_active");
  console.log("✓ kill switch blocks with exact code");

  await resetAutoTradeRuntimeForTests();
  await activateKillSwitch();
  const status = await getAutoTradeStatus();
  assert.equal(status.killSwitch, true);
  assert.equal(status.effectivelyEnabled, false);
  assert.ok(status.strategyVersion);
  assert.ok(status.analytics);
  console.log("✓ status includes kill switch, strategy version, analytics");

  const { buildAgentLiveSnapshot } = await import("../src/lib/auto-trade/display");
  const snap = buildAgentLiveSnapshot({
    monitor: null,
    scanning: false,
    autoEnabled: true,
    recentDecisions: [
      {
        id: "t1",
        opportunityId: "o1",
        symbol: "AAPL",
        action: "BUY",
        orderMode: "notional",
        notional: 5,
        confidence: 0.8,
        reason: "test",
        status: "skipped",
        blockers: [{ code: "kill_switch_active", message: "Kill switch ON" }],
        createdAt: new Date().toISOString(),
        submittedAt: null,
        orderId: null,
        orderStatus: null,
        filledAvgPrice: null,
        estimatedPnL: null,
        paperOnly: true,
      },
    ],
  });
  assert.equal(snap.autoStatus, "skipped");
  assert.ok(snap.reason.includes("Kill switch"));
  console.log("✓ frontend live snapshot exposes skip reason");

  const apiDir = path.join(process.cwd(), "src", "app", "api", "auto-trade");
  assert.ok(fs.existsSync(path.join(apiDir, "route.ts")));
  assert.ok(fs.existsSync(path.join(apiDir, "kill", "route.ts")));
  assert.ok(fs.existsSync(path.join(apiDir, "resume", "route.ts")));
  assert.ok(fs.existsSync(path.join(apiDir, "analytics", "route.ts")));
  console.log("✓ auto-trade API routes including analytics");

  console.log("verify:phase9 passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
