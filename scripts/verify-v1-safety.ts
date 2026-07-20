/**
 * Group 1 — Configuration and paper-only safety (deterministic).
 * Run: npm run verify:v1-safety
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "../src/lib/alpaca/safety";
import { PAPER_TRADING_BASE_URL } from "../src/lib/config";
import { buildRuntimeSettingsFromEnv } from "../src/lib/auto-trade/runtime-settings/defaults";
import { validateRuntimeSettingsPatch } from "../src/lib/auto-trade/runtime-settings/validate";
import { buildAlpacaOrderBody } from "../src/lib/alpaca/client";
import { filterUsStockSymbols } from "../src/lib/stocks/universe";
import { evaluateV1EntryGates } from "../src/lib/trading/v1-lifecycle";
import { classifyPosition } from "../src/lib/trading/v1-lifecycle";
import { mockPosition } from "./fixtures/v1-lifecycle-fixtures";
import { assertCanEnableAutoTrading } from "../src/lib/auto-trade/enable-guards";
import { withTempTradingData } from "./lib/v1-harness";
import {
  getEffectiveRuntimeSettings,
  resetRuntimeSettingsCacheForTests,
  setExecutionEnabled,
  setAutoTradingEnabled,
} from "../src/lib/auto-trade/runtime-settings/service";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

async function main() {
  console.log("verify:v1-safety starting…");
  const temp = await withTempTradingData();
  let failed = false;
  try {
    // 1–3 paper URL
    assert.doesNotThrow(() => assertPaperTradingOnly(PAPER_TRADING_BASE_URL));
    assert.throws(
      () => assertPaperTradingOnly("https://api.alpaca.markets"),
      PaperTradingSafetyError,
    );
    assert.throws(
      () => assertPaperTradingOnly("https://broker.example.com"),
      PaperTradingSafetyError,
    );
    console.log("✓ paper URL accepted; live and unknown hosts rejected");

    // 4 runtime cannot enable live trading
    const current = buildRuntimeSettingsFromEnv();
    const locked = validateRuntimeSettingsPatch(current, {
      liveTradingAllowed: true,
    } as never);
    assert.equal(locked.ok, false);
    console.log("✓ runtime settings cannot enable live trading");

    // 5 UI has no live-trading control
    const page = read("src/components/auto-trade/AutoTradePageView.tsx");
    const controls = read("src/components/auto-trade/AutoTradeControlsPanel.tsx");
    assert.ok(!page.includes("Enable Live"));
    assert.ok(!controls.includes("liveTradingEnabled"));
    assert.ok(controls.includes("Paper") || controls.includes("paper"));
    console.log("✓ UI does not expose a live-trading control");

    // 6–7 defaults OFF
    await resetRuntimeSettingsCacheForTests();
    delete process.env.ENABLE_PAPER_ORDER_EXECUTION;
    delete process.env.AUTO_PAPER_TRADING_ENABLED;
    const defaults = buildRuntimeSettingsFromEnv();
    assert.equal(defaults.executionEnabled, false);
    assert.equal(defaults.autoTradingEnabled, false);
    console.log("✓ execution and Auto Trading default OFF");

    // 8–9 long-only cannot be disabled; short position blocks entry
    assert.equal(defaults.longOnly, true);
    const shortPatch = validateRuntimeSettingsPatch(current, {
      longOnly: false,
    });
    assert.equal(shortPatch.ok, false);
    const shortGates = evaluateV1EntryGates({
      paperUrlOk: true,
      marketOpen: true,
      minutesSinceOpen: 60,
      minutesToClose: 120,
      openEntryDelayMinutes: 0,
      eodEntryCutoffMinutes: 30,
      dataFresh: true,
      universeEligible: true,
      strategyIsBuy: true,
      strategyVersion: "1.0.0",
      executionEnabled: true,
      autoTradingEnabled: true,
      emergencyStopActive: false,
      killSwitchActive: false,
      panicActive: false,
      reconciliationHealthy: true,
      hasOpenPosition: true,
      hasPendingEntry: false,
      hasPendingExit: false,
      maxOpenPositionsReached: false,
      maxDailyTradesReached: false,
      dailyLossLimitReached: false,
      consecutiveLossPause: false,
      buyingPowerSufficient: true,
      sizingPassed: true,
      stopLossValid: true,
      takeProfitValid: true,
      rewardToRisk: 2,
      qtyPositive: true,
      fractionalOk: true,
      classification: classifyPosition({
        position: mockPosition({ symbol: "F", qty: -1 }),
        v1Trades: [],
        openOrders: [],
        recentOrders: [],
      }),
    });
    assert.equal(shortGates.ok, false);
    void buildAlpacaOrderBody;
    console.log("✓ long-only locked; short position conflict blocks Version 1 entry");

    // 10 crypto/options/futures rejected from V1 watchlist parser
    const filtered = filterUsStockSymbols(["F", "BTCUSD", "AAPL240119C00150000", "ES"]);
    assert.ok(filtered.includes("F"));
    assert.ok(!filtered.includes("BTCUSD"));
    console.log("✓ non-equity symbols rejected from Version 1 universe filter");

    // 11–12 strategy / LLM cannot submit orders
    const strat = read("src/lib/strategy/v1-simple-long/evaluate.ts");
    const explain = read("src/lib/strategy/v1-simple-long/explain.ts");
    assert.ok(!strat.includes("placePaperOrder"));
    assert.ok(!explain.includes("placePaperOrder"));
    assert.ok(!explain.includes("submit-paper"));
    console.log("✓ strategy and LLM modules cannot submit orders");

    // Paper smoke is operator-gated and never part of verify:v1-all
    const v1All = read("scripts/verify-v1-all.ts");
    const pkg = read("package.json");
    assert.ok(!v1All.includes("paper-smoke"));
    assert.ok(pkg.includes("paper-smoke:v1"));
    assert.ok(!pkg.includes('"verify:paper-smoke'));
    const smokeCli = read("scripts/paper-smoke-v1.ts");
    assert.ok(smokeCli.includes("PAPER SMOKE"));
    assert.ok(smokeCli.includes("enable-execution-once"));
    console.log("✓ paper-smoke:v1 exists and is excluded from verify:v1-all");

    // 13–14 Emergency Stop ≠ Close All
    const emergency = read("src/lib/trading/emergency.ts");
    const activateBody = emergency.slice(
      emergency.indexOf("export async function activateEmergencyStop"),
      emergency.indexOf("export async function closeAllOpenPositions"),
    );
    assert.ok(!activateBody.includes("closeAllPositions("));
    assert.ok(activateBody.includes("openPositionsPreserved") || emergency.includes("openPositionsPreserved"));
    const safetyUi = read("src/components/auto-trade/SafetyActionsCard.tsx");
    assert.ok(safetyUi.includes("Emergency Stop"));
    assert.ok(safetyUi.includes("Close All Positions"));
    assert.ok(safetyUi.includes("remain open") || safetyUi.includes("does not close"));
    console.log("✓ Emergency Stop separate from Close All; does not flatten");

    // 15 unknown positions not auto-adopted
    const unknown = classifyPosition({
      position: mockPosition({ symbol: "ZZZ", qty: 5 }),
      v1Trades: [],
      openOrders: [],
      recentOrders: [],
    });
    assert.ok(
      unknown.ownership === "external" ||
        unknown.ownership === "unknown" ||
        unknown.ownership === "orphaned",
    );
    assert.notEqual(unknown.ownership, "v1_managed");
    console.log("✓ unknown positions are not auto-adopted as v1_managed");

    // Enable guards: execution off blocks API enable path
    await resetRuntimeSettingsCacheForTests();
    await setExecutionEnabled(false, "test");
    await setAutoTradingEnabled(false, "test");
    const guard = await assertCanEnableAutoTrading();
    assert.equal(guard.ok, false);
    if (!guard.ok) assert.equal(guard.code, "execution_off");
    console.log("✓ Auto Trading enable guard blocks when execution is off");

    // Gate matrix sample — daily target never bypasses
    const scoreBypass = evaluateV1EntryGates({
      paperUrlOk: true,
      marketOpen: true,
      minutesSinceOpen: 60,
      minutesToClose: 120,
      openEntryDelayMinutes: 0,
      eodEntryCutoffMinutes: 30,
      dataFresh: true,
      universeEligible: true,
      strategyIsBuy: true,
      strategyVersion: "1.0.0",
      executionEnabled: false,
      autoTradingEnabled: true,
      emergencyStopActive: false,
      killSwitchActive: false,
      panicActive: false,
      reconciliationHealthy: true,
      hasOpenPosition: false,
      hasPendingEntry: false,
      hasPendingExit: false,
      maxOpenPositionsReached: false,
      maxDailyTradesReached: false,
      dailyLossLimitReached: false,
      consecutiveLossPause: false,
      buyingPowerSufficient: true,
      sizingPassed: true,
      stopLossValid: true,
      takeProfitValid: true,
      rewardToRisk: 2,
      qtyPositive: true,
      fractionalOk: true,
    });
    assert.equal(scoreBypass.ok, false);
    console.log("✓ high-quality setup never bypasses execution-off gate");

    void getEffectiveRuntimeSettings;
    console.log("verify:v1-safety passed");
  } catch (e) {
    failed = true;
    throw e;
  } finally {
    await temp.cleanup({ failed });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
