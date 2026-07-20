/**
 * Version 1 Auto Trade operator UI verification.
 * Source + fixture checks only — never submits Alpaca orders.
 * Run: npm run verify:v1-auto-trade-ui
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildOperatorBlockers,
  formatRemainingToGoal,
  friendlyUniverseReason,
  protectionStatusLabel,
  marketDataStatusLabel,
} from "../src/lib/auto-trade/operator-blockers";
import { buildRecentActivity } from "../src/components/auto-trade/RecentAutoTradeActivity";
import { assertPaperTradingOnly } from "../src/lib/alpaca/safety";
import { PaperTradingSafetyError } from "../src/lib/alpaca/safety";
import {
  V1_STRATEGY_ID,
  V1_STRATEGY_VERSION,
} from "../src/lib/strategy/v1-simple-long/config";

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function assertNoNativeDialogs(rel: string) {
  const src = read(rel);
  assert.ok(!/\bwindow\.confirm\s*\(/.test(src), `${rel} must not use window.confirm`);
  assert.ok(!/\bwindow\.alert\s*\(/.test(src), `${rel} must not use window.alert`);
  assert.ok(!/\bwindow\.prompt\s*\(/.test(src), `${rel} must not use window.prompt`);
}

async function main() {
  console.log("verify:v1-auto-trade-ui starting…");

  const page = read("src/components/auto-trade/AutoTradePageView.tsx");
  const header = read("src/components/auto-trade/AutoTradeStatusHeader.tsx");
  const daily = read("src/components/auto-trade/V1DailyProgressPanel.tsx");
  const managed = read("src/components/auto-trade/V1ManagedTradeCard.tsx");
  const external = read("src/components/auto-trade/ExternalPositionsWarning.tsx");
  const decision = read("src/components/auto-trade/LatestStrategyDecisionCard.tsx");
  const blockers = read("src/components/auto-trade/TradingBlockersPanel.tsx");
  const controls = read("src/components/auto-trade/AutoTradeControlsPanel.tsx");
  const safety = read("src/components/auto-trade/SafetyActionsCard.tsx");
  const universe = read("src/components/auto-trade/V1UniversePanel.tsx");
  const activity = read("src/components/auto-trade/RecentAutoTradeActivity.tsx");
  const advanced = read("src/components/auto-trade/AdvancedAutoTradeDetails.tsx");
  const blockersLib = read("src/lib/auto-trade/operator-blockers.ts");

  // 1–7 status header
  assert.ok(header.includes("Paper Trading"));
  assert.ok(header.includes("Auto Trading On") && header.includes("Auto Trading Off"));
  assert.ok(header.includes("Order Execution On") && header.includes("Order Execution Off"));
  assert.ok(header.includes("Market Open") && header.includes("Market Closed"));
  assert.ok(header.includes("Alpaca Connected") && header.includes("Alpaca Disconnected"));
  assert.ok(header.includes("Data ") && header.includes("marketDataStatusLabel"));
  assert.ok(header.includes("V1_STRATEGY_ID") && header.includes("V1_STRATEGY_VERSION"));
  assert.equal(V1_STRATEGY_ID, "v1-simple-long");
  assert.equal(V1_STRATEGY_VERSION, "1.0.0");
  console.log("✓ status header shows paper / auto / execution / market / alpaca / data / strategy");

  // 8–12 daily progress
  assert.ok(daily.includes("Daily goal:"));
  assert.ok(daily.includes("formatRemainingToGoal"));
  assert.ok(daily.includes("never overrides safety rules"));
  assert.ok(daily.includes("Wins:"));
  assert.ok(daily.includes("Losses:"));
  assert.ok(daily.includes("Breakeven:"));
  assert.ok(daily.includes("Realized P/L:"));
  assert.ok(daily.includes('role="progressbar"'));
  assert.equal(formatRemainingToGoal(2), "2 remaining to daily goal");
  assert.ok(!formatRemainingToGoal(2).toLowerCase().includes("must"));
  assert.ok(!formatRemainingToGoal(2).toLowerCase().includes("required"));
  assert.ok(!formatRemainingToGoal(2).toLowerCase().includes("behind"));
  console.log("✓ daily progress wording and safety explanation");

  // 13–18 managed trade
  assert.ok(managed.includes("No active Version 1 trade"));
  assert.ok(managed.includes("waiting for a qualified setup"));
  assert.ok(managed.includes("protectionStatusLabel"));
  assert.ok(managed.includes("Partial entry"));
  assert.ok(managed.includes("Partial exit"));
  assert.ok(managed.includes("Manual intervention"));
  assert.equal(protectionStatusLabel("active"), "Protected");
  assert.equal(protectionStatusLabel("pending"), "Protection Pending");
  assert.equal(protectionStatusLabel("missing"), "Missing Protection");
  console.log("✓ managed trade empty/active/protection/partial/manual copy");

  // 19–20 legacy AAPL
  assert.ok(external.includes("Legacy / external to Version 1"));
  assert.ok(external.includes("will not manage or close"));
  assert.ok(external.includes("AAPL entries are blocked"));
  assert.ok(!external.includes("closeAll") && !external.includes("/api/auto-trade/close-all"));
  assert.ok(page.includes("ExternalPositionsWarning"));
  assert.ok(page.includes("V1ManagedTradeCard"));
  console.log("✓ legacy AAPL short is separate from managed trade card");

  // 21–25 strategy decisions
  assert.ok(decision.includes('"BUY"'));
  assert.ok(decision.includes('"WATCH"'));
  assert.ok(decision.includes('"SKIP"'));
  assert.ok(decision.includes('"HOLD"'));
  assert.ok(decision.includes("Show condition details"));
  assert.ok(decision.includes("c.name") && decision.includes("c.explanation"));
  console.log("✓ latest strategy decision card covers BUY/WATCH/SKIP/HOLD + conditions");

  // 26–28 blockers
  const summary = buildOperatorBlockers({
    status: {
      executionEnabled: false,
      envEnabled: false,
      effectivelyEnabled: false,
      killSwitch: false,
      panicStop: false,
      runtimeDisabled: false,
      dailyTradesUsed: 0,
      maxDailyTrades: 10,
      activeCooldowns: [],
      blockSummary: {
        runtimeOff: true,
        primaryReason: "paused",
        items: [],
      },
    },
    marketOpen: false,
    alpacaConnected: true,
    dataFreshness: "stale",
    eligibleCount: 0,
    reconciliationComplete: true,
    hasLegacyConflict: true,
    hasManualIntervention: false,
    hasQualifiedBuy: false,
    updatedAt: new Date().toISOString(),
  });
  assert.ok(summary.primary);
  assert.ok(summary.additional.length >= 1);
  assert.ok(summary.all.every((b) => !b.id.includes("AUTO_")));
  assert.ok(blockers.includes("Why trading is not active"));
  assert.ok(blockers.includes("primary.label"));
  assert.ok(!blockersLib.includes("AUTO_PAPER_TRADING_ENABLED"));
  console.log("✓ primary + additional blockers in plain language; no raw env codes on UI");

  // 29–38 controls / safety
  assert.ok(controls.includes('open={modal === "enableAuto"}'));
  assert.ok(controls.includes("Turn paper execution on before Auto Trading"));
  assert.ok(controls.includes("No eligible symbols"));
  assert.ok(controls.includes("Reconciliation is unhealthy"));
  assert.ok(controls.includes('open={modal === "enableExecution"}'));
  assert.ok(safety.includes('open={modal === "emergency"}'));
  assert.ok(safety.includes("does not close open positions") || safety.includes("remain open"));
  assert.ok(safety.includes("Safety Actions"));
  assert.ok(safety.includes('requireTypedText="CLOSE ALL"'));
  assert.ok(controls.includes("SafetyActionsCard"));
  assert.ok(controls.includes("Run Scan Now"));
  assert.ok(page.indexOf("AutoTradeControlsPanel") < page.indexOf("AdvancedAutoTradeDetails"));
  console.log("✓ enable confirmations, auto gates, separated safety actions");

  // 39–40 universe
  assert.ok(universe.includes("Configured symbols:"));
  assert.ok(universe.includes("Eligible:"));
  assert.ok(universe.includes("friendlyUniverseReason"));
  assert.equal(
    friendlyUniverseReason("Price 62 is above max 50"),
    "Price is above the Version 1 range",
  );
  assert.equal(marketDataStatusLabel("fresh"), "Current");
  console.log("✓ universe counts and friendly rejection reasons");

  // 41–42 recent activity + logs
  const items = buildRecentActivity({
    decisions: Array.from({ length: 20 }, (_, i) => ({
      id: `d${i}`,
      opportunityId: `o${i}`,
      symbol: "F",
      action: "BUY" as const,
      orderMode: "notional" as const,
      notional: 5,
      confidence: 0.8,
      reason: "test",
      status: "skipped" as const,
      blockers: [],
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
      submittedAt: null,
      orderId: null,
      orderStatus: null,
      filledAvgPrice: null,
      estimatedPnL: null,
      paperOnly: true as const,
    })),
    logs: [],
    limit: 8,
  });
  assert.equal(items.length, 8);
  assert.ok(activity.includes("Full Logs page") || activity.includes('href="/logs"'));
  console.log("✓ recent activity limited; logs remain accessible");

  // 43–45 advanced collapsed; no raw JSON / env on primary
  assert.ok(advanced.includes("useState(false)"));
  assert.ok(advanced.includes("Collapse") && advanced.includes("Expand"));
  assert.ok(!header.includes("<pre") && !daily.includes("<pre"));
  assert.ok(!managed.includes("JSON.stringify") && !blockers.includes("JSON.stringify"));
  assert.ok(!header.includes("AUTO_PAPER"));
  assert.ok(!daily.includes("process.env"));
  assert.ok(!page.includes("AUTO_PAPER_TRADING_ENABLED"));
  console.log("✓ advanced collapsed by default; no raw JSON/env on primary page");

  // 46–47 a11y / responsive hints
  assert.ok(page.includes("max-w-6xl") || page.includes("flex-col"));
  assert.ok(controls.includes("aria-label") || safety.includes("aria-label"));
  assert.ok(header.includes('aria-label="More information"') || header.includes("AutoTradeInfoTip"));
  assert.ok(daily.includes("aria-valuetext"));
  console.log("✓ accessible labels and responsive layout structure");

  // 48–50 loading / error / stale
  assert.ok(header.includes("Loading system status"));
  assert.ok(page.includes("Unable to refresh Auto Trade status") || page.includes("Retry"));
  assert.ok(header.includes("stale") || header.includes("Updates appear stale"));
  console.log("✓ loading, error, and stale-update states present");

  // 51 existing actions reachable
  assert.ok(page.includes("TradingSettingsDrawer"));
  assert.ok(page.includes("AutoTradeControlsPanel"));
  assert.ok(advanced.includes("V1LifecyclePanel"));
  assert.ok(advanced.includes("V1StrategyDecisionsPanel"));
  assert.ok(advanced.includes("Paper Test Results"));
  console.log("✓ existing actions remain reachable (settings, advanced panels)");

  // 52–54 no order submission in UI verify; paper-only hard block
  assert.ok(!page.includes("placePaperOrder"));
  assert.ok(!managed.includes("placePaperOrder"));
  assertNoNativeDialogs("src/components/auto-trade/AutoTradeControlsPanel.tsx");
  assertNoNativeDialogs("src/components/auto-trade/SafetyActionsCard.tsx");
  assert.throws(
    () => assertPaperTradingOnly("https://api.alpaca.markets"),
    PaperTradingSafetyError,
  );
  console.log("✓ UI verify does not submit orders; live trading hard-blocked");

  // Page composition
  for (const name of [
    "AutoTradeStatusHeader",
    "V1DailyProgressPanel",
    "V1ManagedTradeCard",
    "ExternalPositionsWarning",
    "LatestStrategyDecisionCard",
    "TradingBlockersPanel",
    "AutoTradeControlsPanel",
    "V1UniversePanel",
    "RecentAutoTradeActivity",
    "AdvancedAutoTradeDetails",
  ]) {
    assert.ok(page.includes(name), `page must compose ${name}`);
  }
  console.log("✓ Auto Trade page composes focused V1 operator components");

  console.log("verify:v1-auto-trade-ui passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
