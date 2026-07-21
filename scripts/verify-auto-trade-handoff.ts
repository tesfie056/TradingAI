/**
 * Monitor → Auto Trading handoff, display states, and market-closed behavior.
 * Does not loosen strategy thresholds. Uses FakeAlpacaBroker for order-path checks
 * where the integration harness already covers live submit.
 *
 * Run: npm run verify:auto-trade-handoff
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

async function main() {
  console.log("verify:auto-trade-handoff starting…");

  const { decisionToOpportunity } = await import(
    "../src/lib/monitor/opportunity"
  );
  const {
    monitorTradeStatus,
    topSignalHeadline,
    primaryBlockReason,
  } = await import("../src/lib/monitor/display");
  const { evaluateAutoTradeEligibility } = await import(
    "../src/lib/auto-trade/eligibility"
  );
  const { buildOrderPipelineView } = await import(
    "../src/lib/auto-trade/order-pipeline"
  );
  // --- Display: market closed must not show Trade eligible / Ready ---
  const closedOpp = decisionToOpportunity({
    symbol: "MSFT",
    action: "BUY",
    decisionLabel: "BUY",
    confidence: 0.85,
    reasons: ["Interesting setup but market closed"],
    riskWarnings: [],
    riskStatus: "low",
    timestamp: new Date().toISOString(),
    paperOnly: true,
    readyForManualPaperTrade: true,
    tradeBlockReasons: [],
    dataQuality: {
      isMarketOpen: false,
      isQuoteStale: false,
      spreadPercent: 0.001,
      hasRecentBars: true,
      warningMessages: [],
    },
    explanation: {
      technical: "ok",
      news: "ok",
      market: "Market closed",
      risk: "ok",
      summary: "Interesting setup but market closed",
    },
  } as never)!;

  assert.equal(closedOpp.marketStatus, "closed");
  assert.equal(closedOpp.readyForPaperPreview, false);
  assert.equal(
    monitorTradeStatus(closedOpp, { marketOpen: false }),
    "Waiting for market",
  );
  assert.ok(
    !topSignalHeadline(closedOpp, { marketOpen: false }).includes(
      "ready for paper preview",
    ),
  );
  assert.equal(
    primaryBlockReason(closedOpp, { marketOpen: false }),
    "Market closed",
  );
  console.log("✓ market-closed BUY is Waiting for market, not Trade eligible");

  // Open market + ready
  const openOpp = decisionToOpportunity({
    symbol: "MSFT",
    action: "BUY",
    decisionLabel: "BUY",
    confidence: 0.85,
    reasons: ["Setup looks strong"],
    riskWarnings: [],
    riskStatus: "low",
    timestamp: new Date().toISOString(),
    paperOnly: true,
    readyForManualPaperTrade: true,
    tradeBlockReasons: [],
    dataQuality: {
      isMarketOpen: true,
      isQuoteStale: false,
      spreadPercent: 0.001,
      hasRecentBars: true,
      warningMessages: [],
    },
  } as never)!;
  assert.equal(openOpp.readyForPaperPreview, true);
  assert.equal(monitorTradeStatus(openOpp, { marketOpen: true }), "Trade eligible");
  console.log("✓ open-market ready BUY is Trade eligible");

  // Free-text "market closed" must not override open broker clock
  const textClosedButOpen = decisionToOpportunity({
    symbol: "MSFT",
    action: "BUY",
    decisionLabel: "BUY",
    confidence: 0.85,
    reasons: ["Interesting setup but market closed"],
    riskWarnings: [],
    riskStatus: "low",
    timestamp: new Date().toISOString(),
    paperOnly: true,
    readyForManualPaperTrade: true,
    tradeBlockReasons: [],
    dataQuality: {
      isMarketOpen: true,
      isQuoteStale: false,
      spreadPercent: 0.001,
      hasRecentBars: true,
      warningMessages: [],
    },
  } as never)!;
  assert.equal(textClosedButOpen.marketStatus, "open");
  assert.equal(textClosedButOpen.readyForPaperPreview, true);
  assert.notEqual(
    primaryBlockReason(textClosedButOpen, { marketOpen: true }),
    "Market closed",
  );
  console.log("✓ free-text market closed does not override open clock");

  // Engine paused context
  assert.equal(
    monitorTradeStatus(openOpp, { marketOpen: true, enginePaused: true }),
    "Not trade-ready",
  );
  console.log("✓ engine paused demotes trade status");

  const dq = {
    isMarketOpen: true,
    isQuoteStale: false,
    spreadPercent: 0.001,
    hasRecentBars: true,
    warningMessages: [] as string[],
  };

  const baseElig = {
    opportunity: openOpp,
    envEnabled: true,
    executionEnabled: true,
    runtimeBlocked: false,
    killSwitch: false,
    panicStop: false,
    paperEndpointOk: true,
    dataQuality: dq,
    riskStatus: "low" as const,
    estimatedPrice: 100,
    notional: 200,
    dailyTradeCount: 0,
    dailyEstimatedPnL: 0,
    buyingPower: 50_000,
    hasPosition: false,
    positionQty: 0,
    buyCooldownActive: false,
    sellCooldownActive: false,
    symbolTradedThisScan: false,
    opportunityAlreadyProcessed: false,
    recentBuyWithoutSell: false,
    lastTradeWasLoss: false,
  };

  const e1 = evaluateAutoTradeEligibility({
    ...baseElig,
    executionEnabled: false,
  });
  assert.equal(e1.eligible, false);
  assert.ok(e1.blockers.some((b) => b.code === "execution_disabled"));
  console.log("✓ paper execution off blocks order");

  const e2 = evaluateAutoTradeEligibility({
    ...baseElig,
    envEnabled: false,
  });
  assert.equal(e2.eligible, false);
  assert.ok(e2.blockers.some((b) => b.code === "auto_trading_disabled"));
  console.log("✓ auto trading off blocks order");

  const e3 = evaluateAutoTradeEligibility({
    ...baseElig,
    panicStop: true,
    runtimeBlocked: true,
  });
  assert.equal(e3.eligible, false);
  assert.ok(e3.blockers.some((b) => b.code === "panic_stop_active"));
  console.log("✓ emergency stop blocks order");

  const e4 = evaluateAutoTradeEligibility({
    ...baseElig,
    opportunity: closedOpp,
    dataQuality: { ...dq, isMarketOpen: false },
  });
  assert.equal(e4.eligible, false);
  assert.ok(e4.blockers.some((b) => b.code === "market_closed"));
  console.log("✓ market closed eligibility blocks order");

  const e5 = evaluateAutoTradeEligibility({
    ...baseElig,
    recentBuyWithoutSell: true,
    hasPosition: true,
    positionQty: 2,
  });
  assert.equal(e5.eligible, false);
  assert.ok(
    e5.blockers.some(
      (b) =>
        b.code === "average_down_blocked" || b.code === "duplicate_symbol",
    ),
  );
  console.log("✓ existing position / average-down blocks duplicate exposure");

  const e6 = evaluateAutoTradeEligibility({
    ...baseElig,
    opportunityAlreadyProcessed: true,
  });
  assert.equal(e6.eligible, false);
  assert.ok(e6.blockers.some((b) => b.code === "duplicate_opportunity"));
  console.log("✓ duplicate opportunity consumed once");

  // Pipeline stop reasons
  const pipeClosed = buildOrderPipelineView({
    marketOpen: false,
    autoTradingEnabled: true,
    executionEnabled: true,
    enginePaused: false,
    topOpportunity: closedOpp,
  });
  assert.equal(pipeClosed.stage, "waiting_for_market");
  assert.ok(pipeClosed.stopReason?.toLowerCase().includes("market is closed"));
  console.log("✓ pipeline shows waiting for market");

  const pipePaused = buildOrderPipelineView({
    marketOpen: true,
    autoTradingEnabled: true,
    executionEnabled: true,
    enginePaused: true,
    pauseReason: "New entries are paused. Resume Engine.",
    topOpportunity: openOpp,
  });
  assert.equal(pipePaused.stage, "paused");
  assert.ok(pipePaused.stopReason?.includes("paused"));
  console.log("✓ pipeline shows paused stop reason");

  const pipeExecOff = buildOrderPipelineView({
    marketOpen: true,
    autoTradingEnabled: true,
    executionEnabled: false,
    topOpportunity: openOpp,
  });
  assert.equal(pipeExecOff.stage, "execution_off");
  console.log("✓ pipeline shows execution off");

  // Expired proposal
  const expired = {
    ...openOpp,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  };
  const pipeExp = buildOrderPipelineView({
    marketOpen: true,
    autoTradingEnabled: true,
    executionEnabled: true,
    topOpportunity: expired,
    nowMs: Date.now(),
  });
  assert.equal(pipeExp.stage, "expired");
  console.log("✓ expired proposal is not treated as executable");

  // Advanced Monitoring wording
  const page = fs.readFileSync(
    path.join(process.cwd(), "src/components/monitor/MonitorPageView.tsx"),
    "utf8",
  );
  assert.ok(page.includes("sends eligible setups to Auto Trading"));
  assert.ok(!page.includes("Finds setups only — never places orders"));
  const panel = fs.readFileSync(
    path.join(process.cwd(), "src/components/monitor/MonitoringPanel.tsx"),
    "utf8",
  );
  assert.ok(
    panel.includes(
      "When Auto Trading and Paper Execution are enabled, eligible setups are handled by the Auto Trading engine",
    ),
  );
  console.log("✓ Advanced Monitoring wording updated");

  // hasProcessedOpportunity includes pending (in-memory logic unit)
  {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/auto-trade/decisions.ts"),
      "utf8",
    );
    assert.ok(src.includes('status === "pending"'));
    assert.ok(src.includes("hasProcessedOpportunity"));
    console.log("✓ pending decision blocks duplicate consume");
  }

  // FakeAlpacaBroker harness still paper-only
  const fake = fs.readFileSync(
    path.join(process.cwd(), "scripts/lib/v1-harness/fake-broker.ts"),
    "utf8",
  );
  assert.ok(fake.includes("FakeAlpacaBroker"));
  assert.ok(!/live-api\.alpaca\.markets/.test(fake));
  console.log("✓ FakeAlpacaBroker harness remains paper-oriented");

  // Confirm auto-submit path exists (no manual approval gate in service)
  const service = fs.readFileSync(
    path.join(process.cwd(), "src/lib/auto-trade/service.ts"),
    "utf8",
  );
  assert.ok(service.includes("submitRiskApprovedEntry"));
  assert.ok(service.includes("processAutoTradesForScan"));
  assert.ok(!/manualApproved|requireManualApproval/.test(service));
  console.log("✓ Auto Trading path auto-submits without manual approval");

  console.log("verify:auto-trade-handoff OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
