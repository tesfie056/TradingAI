/**
 * Runtime status mapper verification — presentation only.
 * Ensures engine/scan lights do not treat benign notes as errors.
 *
 * Run: npx tsx scripts/verify-runtime-status.ts
 */
import assert from "node:assert/strict";
import {
  buildRuntimeActivity,
  isBenignMonitorNote,
  isRealScanFailure,
  mapEngineHealth,
  mapScanStatus,
  plainOpportunitySummary,
  resolveOverviewPrimaryBanner,
} from "../src/lib/client/runtime-status-mapper";
import { buildSystemStatusItems } from "../src/lib/client/status-state-mapper";

function base(overrides: Record<string, unknown> = {}) {
  return {
    autoTradingEnabled: true,
    orderExecutionEnabled: true,
    marketOpen: true,
    monitorRunning: true,
    monitorScanning: false,
    monitorConnected: true,
    lastScanAt: new Date(Date.now() - 60_000).toISOString(),
    nextScanAt: new Date(Date.now() + 180_000).toISOString(),
    stocksScanned: 30,
    lastError: null as string | null,
    heartbeatAt: new Date().toISOString(),
    engineState: "AUTO_TRADING",
    runtimeDisabled: false,
    safetyOk: true,
    ...overrides,
  };
}

async function main() {
  console.log("verify:runtime-status starting…");

  // 1. Between scans — waiting, engine healthy
  {
    const input = base();
    const activity = buildRuntimeActivity(input);
    assert.equal(activity.kind, "waiting_next_scan");
    assert.equal(activity.tone, "ok");
    const engine = mapEngineHealth(input);
    assert.equal(engine.tone, "ok");
    assert.equal(engine.state, "Healthy");
    assert.equal(engine.critical, false);
    console.log("✓ idle between scans → waiting + engine healthy");
  }

  // 2. Active scan
  {
    const input = base({
      monitorScanning: true,
      lastEvaluatedSymbol: "F",
    });
    const activity = buildRuntimeActivity(input);
    assert.equal(activity.kind, "scan_active");
    assert.ok(activity.title.toLowerCase().includes("scanning"));
    const scan = mapScanStatus(input);
    assert.equal(scan.state, "Scanning");
    assert.equal(scan.tone, "ok");
    console.log("✓ active scan → scan-in-progress");
  }

  // 3. Zero eligible trades is not an engine error
  {
    const input = base({
      lastError: "No eligible trades this scan",
      stocksScanned: 30,
    });
    assert.equal(isBenignMonitorNote(input.lastError), true);
    assert.equal(isRealScanFailure(input.lastError), false);
    const engine = mapEngineHealth(input);
    assert.notEqual(engine.tone, "bad");
    const banner = resolveOverviewPrimaryBanner(buildRuntimeActivity(input));
    assert.notEqual(banner.tone, "bad");
    console.log("✓ zero eligible → not engine error");
  }

  // 4. Market closed — waiting, engine healthy
  {
    const input = base({ marketOpen: false });
    const activity = buildRuntimeActivity(input);
    assert.equal(activity.kind, "market_closed");
    assert.equal(activity.tone, "warn");
    const engine = mapEngineHealth(input);
    assert.equal(engine.tone, "ok");
    console.log("✓ market closed → waiting, engine healthy");
  }

  // 5. Paper execution off — not engine error
  {
    const input = base({ orderExecutionEnabled: false });
    const activity = buildRuntimeActivity(input);
    assert.equal(activity.kind, "execution_off");
    assert.equal(activity.tone, "warn");
    const engine = mapEngineHealth(input);
    assert.notEqual(engine.tone, "bad");
    console.log("✓ execution off → not engine error");
  }

  // 6. Safety block — amber, engine separate
  {
    const input = base({
      safetyOk: false,
      safetyLabel: "Maximum open positions reached",
    });
    const activity = buildRuntimeActivity(input);
    assert.equal(activity.kind, "safety_block");
    assert.equal(activity.tone, "warn");
    const engine = mapEngineHealth(input);
    assert.equal(engine.tone, "ok");
    console.log("✓ safety block → amber, engine healthy");
  }

  // 7. Real scan exception → red
  {
    const input = base({
      lastError: "Unhandled exception while loading market data for F",
    });
    assert.equal(isRealScanFailure(input.lastError), true);
    const engine = mapEngineHealth(input);
    assert.equal(engine.tone, "bad");
    assert.equal(engine.critical, true);
    const activity = buildRuntimeActivity(input);
    assert.ok(
      activity.kind === "critical_failure" || activity.kind === "scan_failed",
    );
    console.log("✓ real exception → engine/scan error");
  }

  // 8. Stale heartbeat → warn before error
  {
    const input = base({
      heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
    });
    const engine = mapEngineHealth(input);
    assert.equal(engine.tone, "warn");
    assert.equal(engine.state, "Update delayed");
    assert.equal(engine.critical, false);
    console.log("✓ stale heartbeat → warning");
  }

  // 9. Recovery after temporary failure
  {
    const failed = mapEngineHealth(
      base({ lastError: "Broker timeout failed" }),
    );
    assert.equal(failed.tone, "bad");
    const recovered = mapEngineHealth(base({ lastError: null }));
    assert.equal(recovered.tone, "ok");
    console.log("✓ recovery clears error after successful state");
  }

  // 10. Benign "Engine paused" must not light Errors red
  {
    const items = buildSystemStatusItems({
      safetyOk: true,
      marketOpen: true,
      orderExecutionEnabled: true,
      autoTradingEnabled: true,
      agentConnected: true,
      agentRunning: true,
      agentScanning: false,
      agentHeartbeatAt: new Date().toISOString(),
      brokerConnected: true,
      monitorLastError: "Engine paused — no new scans or proposals",
      monitorLastScanAt: new Date().toISOString(),
      monitorNextScanAt: new Date(Date.now() + 60_000).toISOString(),
      monitorStocksScanned: 30,
      engineState: "PAUSED",
      runtimeDisabled: true,
      checkedAt: new Date().toISOString(),
    });
    const engine = items.find((i) => i.key === "engine");
    const monitor = items.find((i) => i.key === "monitor");
    const errors = items.find((i) => i.key === "errors");
    assert.ok(engine);
    assert.notEqual(engine!.tone, "bad");
    assert.ok(monitor);
    assert.notEqual(monitor!.tone, "bad");
    assert.equal(errors, undefined);
    console.log("✓ pause note → no Errors icon, engine not red");
  }

  // Opportunity plain language
  {
    const plain = plainOpportunitySummary({
      symbol: "MO",
      action: "SKIP",
      summary:
        "SKIP MO: blocked this scan. Bid/ask spread acceptable; Price inside Version 1 range.",
    });
    assert.equal(plain.headline, "MO is not ready to trade");
    assert.ok(!plain.detail.includes("SKIP MO"));
    console.log("✓ opportunity text cleaned");
  }

  // Consistency: Overview banner matches activity title
  {
    const activity = buildRuntimeActivity(base());
    const banner = resolveOverviewPrimaryBanner(activity);
    assert.equal(banner.message, activity.title);
    console.log("✓ Overview banner uses shared activity mapper");
  }

  console.log("verify:runtime-status OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
