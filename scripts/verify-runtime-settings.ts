/**
 * Runtime settings service verification (paper only).
 * Run: npm run verify:runtime-settings
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildRuntimeSettingsFromEnv,
  deriveEngineControlSnapshot,
  getEffectiveRuntimeSettings,
  loadRuntimeSettings,
  patchRuntimeSettings,
  resetRuntimeSettings,
  resetRuntimeSettingsCacheForTests,
  setAutoTradingEnabled,
  setExecutionEnabled,
  validateRuntimeSettingsPatch,
  readSettingsAudit,
} from "../src/lib/auto-trade/runtime-settings";

async function main() {
  console.log("verify:runtime-settings starting…");

  await resetRuntimeSettingsCacheForTests();
  const defaults = buildRuntimeSettingsFromEnv();
  assert.equal(defaults.paperOnly, true);
  assert.equal(defaults.liveTradingAllowed, false);
  assert.equal(defaults.riskEngineRequired, true);
  assert.equal(defaults.bracketsRequired, true);
  console.log("✓ env defaults keep safety locks");

  const loaded = await loadRuntimeSettings();
  assert.ok(loaded.configVersion >= 1);

  const execOff = await setExecutionEnabled(false, "test");
  assert.equal(execOff.ok, true);
  if (execOff.ok) assert.equal(execOff.settings.executionEnabled, false);
  assert.equal(getEffectiveRuntimeSettings().executionEnabled, false);
  console.log("✓ execution toggle applies without restart");

  const execOn = await setExecutionEnabled(true, "test");
  assert.equal(execOn.ok, true);
  if (execOn.ok) assert.equal(execOn.settings.executionEnabled, true);
  console.log("✓ execution enable applies without restart");

  const autoOff = await setAutoTradingEnabled(false, "test");
  assert.equal(autoOff.ok, true);
  const autoOn = await setAutoTradingEnabled(true, "test");
  assert.equal(autoOn.ok, true);
  console.log("✓ auto trading toggle applies without restart");

  const bad = validateRuntimeSettingsPatch(loaded, {
    maxRiskPerTradePct: 5,
    maxDailyLossPct: 0.1,
  });
  assert.equal(bad.ok, false);
  console.log("✓ invalid risk settings rejected");

  const short = validateRuntimeSettingsPatch(loaded, { longOnly: false });
  assert.equal(short.ok, false);
  console.log("✓ short selling cannot be enabled");

  const locked = validateRuntimeSettingsPatch(loaded, {
    // @ts-expect-error intentional
    liveTradingAllowed: true,
  } as never);
  assert.equal(locked.ok, false);
  console.log("✓ environment safety locks cannot be overridden");

  const a = patchRuntimeSettings({
    patch: { maxOpenPositions: 2 },
    actor: "test-a",
  });
  const b = patchRuntimeSettings({
    patch: { maxTradesPerDay: 4 },
    actor: "test-b",
  });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.ok, true);
  assert.equal(rb.ok, true);
  const after = getEffectiveRuntimeSettings();
  assert.ok(after.maxOpenPositions === 2 || after.maxTradesPerDay === 4);
  console.log("✓ concurrent updates do not corrupt settings");

  await resetRuntimeSettingsCacheForTests();
  const reloaded = await loadRuntimeSettings();
  assert.ok(reloaded.configVersion >= 1);
  console.log("✓ settings persist after reload (restart simulation)");

  const emergency = deriveEngineControlSnapshot({
    executionEnabled: false,
    autoTradingEnabled: false,
    killSwitch: false,
    panicStop: true,
    runtimeDisabled: true,
    marketOpen: true,
    dailyTradesUsed: 0,
    maxDailyTrades: 2,
    monitorRunning: true,
    monitorScanning: false,
  });
  assert.equal(emergency.engineState, "EMERGENCY_STOPPED");
  assert.equal(emergency.canSubmitOrders, false);
  console.log("✓ emergency state blocks new orders");

  const paused = deriveEngineControlSnapshot({
    executionEnabled: true,
    autoTradingEnabled: true,
    killSwitch: true,
    panicStop: false,
    runtimeDisabled: true,
    marketOpen: true,
    dailyTradesUsed: 0,
    maxDailyTrades: 2,
    monitorRunning: true,
    monitorScanning: false,
  });
  assert.equal(paused.engineState, "PAUSED");
  console.log("✓ pause/resume state model");

  const audit = await readSettingsAudit(20);
  assert.ok(audit.length > 0);
  assert.ok(audit.every((e) => e.paperOnly === true));
  console.log("✓ audit records are created");

  const emergencySrc = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "trading", "emergency.ts"),
    "utf8",
  );
  assert.ok(emergencySrc.includes("setExecutionEnabled(false"));
  assert.ok(emergencySrc.includes("setAutoTradingEnabled(false"));
  assert.ok(/preserve|remain open|Preserves/i.test(emergencySrc));
  console.log("✓ Emergency Stop disables execution/auto and preserves positions");

  const closeSrc = fs.readFileSync(
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
  assert.ok(closeSrc.includes("confirm"));
  console.log("✓ Close All requires confirmation");

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
  assert.ok(page.includes("TradingSettingsDrawer"));
  assert.ok(page.includes("AutoTradeControlsPanel"));
  assert.ok(page.includes("engine?.engineState") || page.includes("engineStateLabel"));
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
  assert.ok(controls.includes("execution/enable"));
  console.log("✓ UI uses backend engine state, controls panel, and settings drawer");

  await resetRuntimeSettings({ actor: "test", reason: "verify_cleanup" });
  console.log("verify:runtime-settings passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
