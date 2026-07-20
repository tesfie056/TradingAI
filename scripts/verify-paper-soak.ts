/**
 * Phase H — paper soak profile + session report checks.
 * Paper only — does not place live orders.
 * Run: npm run verify:paper-soak
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getMaxDailyPaperTrades } from "../src/lib/config";
import {
  getPaperSoakProfileSummary,
  PAPER_SOAK_DEFAULTS,
} from "../src/lib/config/paper-soak-profile";
import { getRiskTradingConfig } from "../src/lib/config/risk-config";
import { evaluateRiskProposal } from "../src/lib/risk/engine";
import type { RiskRuntimeState } from "../src/lib/risk/runtime";

function runtime(overrides: Partial<RiskRuntimeState> = {}): RiskRuntimeState {
  return {
    paperOnly: true,
    dayKey: "2026-07-10",
    consecutiveLosses: 0,
    consecutiveWins: 0,
    dailyRealizedPnL: 0,
    dailyUnrealizedPnL: 0,
    entriesPaused: false,
    pauseReason: null,
    lastReconciledAt: new Date().toISOString(),
    reconciliationComplete: true,
    ...overrides,
  };
}

function main() {
  console.log("verify:paper-soak starting…");

  const profile = getPaperSoakProfileSummary();
  assert.equal(profile.paperOnly, true);
  assert.equal(profile.liveTradingAllowed, false);
  assert.equal(PAPER_SOAK_DEFAULTS.maxOpenPositions, 1);
  assert.equal(PAPER_SOAK_DEFAULTS.maxDailyPaperTrades, 2);
  assert.equal(PAPER_SOAK_DEFAULTS.maxRiskPerTradePct, 0.25);
  assert.equal(PAPER_SOAK_DEFAULTS.maxPositionAllocationPct, 5);
  assert.equal(PAPER_SOAK_DEFAULTS.maxDailyLossPct, 1);
  assert.equal(PAPER_SOAK_DEFAULTS.openEntryDelayMinutes, 15);
  assert.equal(PAPER_SOAK_DEFAULTS.eodEntryCutoffMinutes, 45);
  assert.equal(PAPER_SOAK_DEFAULTS.longOnly, true);
  console.log("✓ conservative soak defaults documented");

  process.env.PAPER_SOAK_PROFILE = "true";
  delete process.env.RISK_MAX_OPEN_POSITIONS;
  delete process.env.RISK_OPEN_ENTRY_DELAY_MINUTES;
  delete process.env.RISK_EOD_ENTRY_CUTOFF_MINUTES;
  delete process.env.RISK_MAX_DAILY_LOSS_PCT;
  delete process.env.RISK_MAX_RISK_PER_TRADE_PCT;
  delete process.env.RISK_MAX_POSITION_ALLOCATION_PCT;
  delete process.env.MAX_DAILY_PAPER_TRADES;

  const cfg = getRiskTradingConfig();
  assert.equal(cfg.maxOpenPositions, 1);
  assert.equal(cfg.maxRiskPerTradePct, 0.25);
  assert.equal(cfg.maxPositionAllocationPct, 5);
  assert.equal(cfg.maxDailyLossPct, 1);
  assert.equal(cfg.openEntryDelayMinutes, 15);
  assert.equal(cfg.eodEntryCutoffMinutes, 45);
  assert.equal(cfg.longOnly, true);
  assert.equal(getMaxDailyPaperTrades(), 2);
  console.log("✓ PAPER_SOAK_PROFILE applies conservative risk config");

  const openDelay = evaluateRiskProposal({
    symbol: "AAPL",
    direction: "long",
    entryPrice: 20,
    stopLossPrice: 19.7,
    takeProfitPrice: 20.6,
    confidence: 0.8,
    equity: 10_000,
    openPositionCount: 0,
    openSymbols: [],
    pendingEntrySymbols: [],
    marketOpen: true,
    minutesToClose: 200,
    minutesSinceOpen: 5,
    riskRuntime: runtime(),
    reconciliationComplete: true,
  });
  assert.equal(openDelay.approved, false);
  assert.equal(openDelay.code, "open_delay");
  console.log("✓ first-15-minutes open delay blocks entries");

  const eod = evaluateRiskProposal({
    symbol: "AAPL",
    direction: "long",
    entryPrice: 20,
    stopLossPrice: 19.7,
    takeProfitPrice: 20.6,
    confidence: 0.8,
    equity: 10_000,
    openPositionCount: 0,
    openSymbols: [],
    pendingEntrySymbols: [],
    marketOpen: true,
    minutesToClose: 40,
    minutesSinceOpen: 120,
    riskRuntime: runtime(),
    reconciliationComplete: true,
  });
  assert.equal(eod.approved, false);
  assert.equal(eod.code, "eod_cutoff");
  console.log("✓ last-45-minutes EOD cutoff blocks entries");

  const maxPos = evaluateRiskProposal({
    symbol: "MSFT",
    direction: "long",
    entryPrice: 20,
    stopLossPrice: 19.7,
    takeProfitPrice: 20.6,
    confidence: 0.8,
    equity: 10_000,
    openPositionCount: 1,
    openSymbols: ["AAPL"],
    pendingEntrySymbols: [],
    marketOpen: true,
    minutesToClose: 200,
    minutesSinceOpen: 60,
    riskRuntime: runtime(),
    reconciliationComplete: true,
  });
  assert.equal(maxPos.approved, false);
  assert.equal(maxPos.code, "max_open_positions");
  console.log("✓ max 1 open position enforced under soak profile");

  delete process.env.PAPER_SOAK_PROFILE;

  const emergency = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "trading", "emergency.ts"),
    "utf8",
  );
  assert.ok(/Preserves open positions|preserve/i.test(emergency));
  assert.ok(emergency.includes("closeAllOpenPositions"));
  console.log("✓ Emergency Stop preserves positions; Close All separate");

  const closeAll = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "app",
      "api",
      "auto-trade",
      "close-all",
      "route.ts",
    ),
    "utf8",
  );
  assert.ok(closeAll.includes("confirm"));
  console.log("✓ Close All requires confirm:true");

  const page = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "auto-trade",
      "AutoTradePageView.tsx",
    ),
    "utf8",
  );
  const advanced = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "auto-trade",
      "AdvancedAutoTradeDetails.tsx",
    ),
    "utf8",
  );
  assert.ok(
    page.includes("Paper Test Results") || advanced.includes("Paper Test Results"),
  );
  assert.ok(
    page.includes("Rejected proposals") || advanced.includes("Rejected proposals"),
  );
  console.log("✓ Paper Test Results dashboard section present");

  const checklist = fs.readFileSync(
    path.join(process.cwd(), "docs", "PAPER-SOAK-TEST-CHECKLIST.md"),
    "utf8",
  );
  assert.ok(checklist.includes("Normal entry and bracket order"));
  assert.ok(checklist.includes("Emergency Stop with an open position"));
  assert.ok(checklist.includes("Backend restart with a pending order"));
  console.log("✓ controlled test checklist present");

  const reportMod = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "trading", "session-report.ts"),
    "utf8",
  );
  for (const field of [
    "sessionDate",
    "engineStartedAt",
    "symbolsScanned",
    "qualifiedCandidates",
    "rejectedCandidates",
    "submittedOrders",
    "filledOrders",
    "canceledOrRejectedOrders",
    "plannedRisk",
    "actualRisk",
    "slippage",
    "realizedPnL",
    "unrealizedPnL",
    "winRate",
    "profitFactor",
    "maximumDrawdownPct",
    "emergencyStopEvents",
    "restartReconciliation",
    "unprotectedPositions",
  ]) {
    assert.ok(reportMod.includes(field), `missing report field ${field}`);
  }
  console.log("✓ session report fields present");

  execSync("npx --yes tsx scripts/verify-risk-engine.ts", { stdio: "inherit" });

  console.log("verify:paper-soak passed");
}

main();
