/**
 * Auto Trade Controls + settings UX verification.
 * Run: npm run verify:auto-trade-controls
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  clearKillSwitchKeepPaused,
  activateKillSwitch,
  getAutoTradeRuntime,
  resumeAutoTrading,
  clearPanicStop,
  activatePanicStop,
} from "../src/lib/auto-trade/runtime";
import {
  describeWatchlistSource,
  getEffectiveRuntimeSettings,
  loadRuntimeSettings,
  patchRuntimeSettings,
  resetRuntimeSettingsCacheForTests,
  setAutoTradingEnabled,
  setExecutionEnabled,
} from "../src/lib/auto-trade/runtime-settings";
import { deriveEngineControlSnapshot } from "../src/lib/auto-trade/runtime-settings/engine-state";
import { DEFAULT_PAPER_SOAK_WATCHLIST } from "../src/lib/universe/paper-soak-watchlist";
async function main() {
  console.log("verify:auto-trade-controls starting…");

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
  assert.ok(page.includes("AutoTradeControlsPanel"));
  assert.ok(page.indexOf("AutoTradeControlsPanel") < page.indexOf("Mode"));
  console.log("✓ Auto Trade Controls panel above summary cards");

  const controls = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "auto-trade",
      "AutoTradeControlsPanel.tsx",
    ),
    "utf8",
  );
  assert.ok(controls.includes('Execution: ${executionOn ? "ON" : "OFF"}'));
  assert.ok(controls.includes('Auto Trading: ${autoOn ? "ON" : "OFF"}'));
  assert.ok(controls.includes("Pause Engine") || controls.includes("Resume Engine"));
  assert.ok(controls.includes("Emergency Stop"));
  assert.ok(controls.includes("Close All Positions"));
  assert.ok(controls.includes("Clear Kill Switch") || controls.includes("Clear Emergency"));
  assert.ok(controls.includes("executionEnabled"));
  assert.ok(controls.includes("blockingReasons"));
  assert.ok(controls.includes("ConfirmActionModal"));
  assert.ok(!controls.includes("window.confirm"));
  console.log("✓ Execution/Auto toggles visible while OFF; emergency + close-all present");

  await resetRuntimeSettingsCacheForTests();
  await loadRuntimeSettings();
  await setExecutionEnabled(false, "test");
  assert.equal(getEffectiveRuntimeSettings().executionEnabled, false);
  await setExecutionEnabled(true, "test");
  assert.equal(getEffectiveRuntimeSettings().executionEnabled, true);
  await setAutoTradingEnabled(false, "test");
  assert.equal(getEffectiveRuntimeSettings().autoTradingEnabled, false);
  await setAutoTradingEnabled(true, "test");
  assert.equal(getEffectiveRuntimeSettings().autoTradingEnabled, true);
  console.log("✓ execution and auto trading enable/disable");

  await activateKillSwitch();
  let rt = await getAutoTradeRuntime();
  assert.equal(rt.killSwitch, true);
  assert.equal(rt.runtimeDisabled, true);

  await setExecutionEnabled(false, "test");
  await setAutoTradingEnabled(false, "test");
  await clearKillSwitchKeepPaused();
  rt = await getAutoTradeRuntime();
  assert.equal(rt.killSwitch, false);
  assert.equal(rt.runtimeDisabled, true);
  assert.equal(getEffectiveRuntimeSettings().executionEnabled, false);
  assert.equal(getEffectiveRuntimeSettings().autoTradingEnabled, false);
  console.log("✓ clear kill switch does not auto-enable trading; engine stays paused");

  const { pauseEngine } = await import("../src/lib/auto-trade/runtime");
  await pauseEngine();
  rt = await getAutoTradeRuntime();
  assert.equal(rt.runtimeDisabled, true);
  assert.equal(rt.killSwitch, false);
  const resumed = await resumeAutoTrading();
  assert.equal(resumed.resumed, true);
  rt = await getAutoTradeRuntime();
  assert.equal(rt.runtimeDisabled, false);
  assert.equal(getEffectiveRuntimeSettings().executionEnabled, false);
  console.log("✓ pause/resume; pause does not set kill; resume does not force execution ON");

  await activatePanicStop();
  await setExecutionEnabled(false, "emergency_stop");
  await setAutoTradingEnabled(false, "emergency_stop");
  const snap = deriveEngineControlSnapshot({
    executionEnabled: false,
    autoTradingEnabled: false,
    killSwitch: true,
    panicStop: true,
    runtimeDisabled: true,
    marketOpen: true,
    dailyTradesUsed: 0,
    maxDailyTrades: 2,
    monitorRunning: true,
    monitorScanning: false,
  });
  assert.equal(snap.engineState, "EMERGENCY_STOPPED");
  assert.equal(snap.canSubmitOrders, false);
  await clearPanicStop();
  rt = await getAutoTradeRuntime();
  assert.equal(rt.panicStop, false);
  assert.equal(rt.runtimeDisabled, true);
  console.log("✓ emergency stop + clear keeps engine paused");

  const strip = fs.readFileSync(
    path.join(process.cwd(), "src", "components", "ui", "SafetyStrip.tsx"),
    "utf8",
  );
  assert.ok(strip.includes("autoTradingEnabled"));
  assert.ok(strip.includes("engineState"));
  assert.ok(!strip.includes("No automatic trading") || strip.includes("Auto trading"));
  console.log("✓ header badges use backend execution/auto/engine state");

  const drawer = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "auto-trade",
      "TradingSettingsDrawer.tsx",
    ),
    "utf8",
  );
  assert.ok(drawer.includes("Effective watchlist"));
  assert.ok(drawer.includes("watchlistInfo"));
  assert.ok(drawer.includes("asSecondsFromMs"));
  const defaultsMeta = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "lib",
      "auto-trade",
      "runtime-settings",
      "defaults.ts",
    ),
    "utf8",
  );
  assert.ok(defaultsMeta.includes("Open-market scan interval (seconds)"));
  assert.ok(defaultsMeta.includes("Closed-market scan interval (seconds)"));
  console.log("✓ drawer shows effective watchlist and intervals in seconds");

  const soakInfo = describeWatchlistSource({
    ...getEffectiveRuntimeSettings(),
    paperSoakProfile: true,
    watchlist: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"],
  });
  assert.equal(soakInfo.source, "paper_soak");
  assert.ok(soakInfo.effective.length >= 20);
  assert.ok(soakInfo.effective.includes("F") || soakInfo.effective.length === DEFAULT_PAPER_SOAK_WATCHLIST.length);
  console.log("✓ paper-soak watchlist source shown correctly");

  const enabledSoak = await patchRuntimeSettings({
    patch: { paperSoakProfile: true },
    actor: "test",
    reason: "verify_soak",
  });
  assert.equal(enabledSoak.ok, true);
  if (enabledSoak.ok) {
    assert.ok(enabledSoak.settings.watchlist.length >= 20);
  }
  console.log("✓ enabling soak replaces mega-cap watchlist");

  const dailyBlock = deriveEngineControlSnapshot({
    executionEnabled: true,
    autoTradingEnabled: true,
    killSwitch: false,
    panicStop: false,
    runtimeDisabled: false,
    marketOpen: true,
    dailyTradesUsed: 3,
    maxDailyTrades: 2,
    monitorRunning: true,
    monitorScanning: false,
  });
  assert.equal(dailyBlock.engineState, "DAILY_LIMIT_REACHED");
  assert.ok(dailyBlock.blockingReasons.some((r) => /Daily trade limit/i.test(r)));
  console.log("✓ daily trade limit still blocks even when execution+auto ON");

  // Invalid transition: resume while panic
  await activatePanicStop();
  const badResume = await resumeAutoTrading();
  assert.equal(badResume.resumed, false);
  await clearPanicStop();
  console.log("✓ invalid state transitions rejected");

  console.log("verify:auto-trade-controls passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
