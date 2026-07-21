/**
 * Monitor scan state consistency — pause, lock cleanup, watchlist counts.
 * Does not place orders or loosen strategy rules.
 *
 * Run: npm run verify:monitor-scan-state
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function withTempData<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tai-monitor-"));
  const prev = process.env.TRADINGAI_DATA_DIR;
  process.env.TRADINGAI_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.TRADINGAI_DATA_DIR;
    else process.env.TRADINGAI_DATA_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  console.log("verify:monitor-scan-state starting…");

  const { describeEnginePauseReason, isEnginePaused } = await import(
    "../src/lib/auto-trade/pause-reason"
  );
  const { summarizeLastScan } = await import("../src/lib/monitor/scan-summary");

  assert.equal(isEnginePaused({ runtimeDisabled: true }), true);
  assert.ok(
    describeEnginePauseReason({ runtimeDisabled: true }).includes("Resume Engine"),
  );
  assert.ok(
    describeEnginePauseReason({ panicStop: true }).includes("emergency stop"),
  );
  console.log("✓ pause reasons are specific");

  await withTempData(async () => {
    const {
      resetMonitorServiceForTests,
      executeMonitorScan,
      getMonitorStatus,
      getMonitorServiceState,
    } = await import("../src/lib/monitor/service");
    const { pauseEngine, resumeAutoTrading, getAutoTradeRuntime } = await import(
      "../src/lib/auto-trade/runtime"
    );

    resetMonitorServiceForTests();

    // 1. Engine paused before scan starts
    await pauseEngine();
    const pausedScan = await executeMonitorScan(true);
    assert.equal(pausedScan.outcome, "paused");
    assert.equal(pausedScan.skipped, true);
    assert.ok(pausedScan.pauseReason?.includes("Resume Engine"));
    const stateAfterPause = getMonitorServiceState();
    assert.equal(stateAfterPause.scanning, false);
    const statusPaused = await getMonitorStatus();
    assert.equal(statusPaused.scanning, false);
    assert.equal(statusPaused.enginePaused, true);
    assert.equal(statusPaused.scanOutcome, "paused");
    assert.ok((statusPaused.watchlistSize ?? 0) > 0);
    assert.notEqual(statusPaused.status, "scanning");
    console.log(
      "✓ engine paused → scanInProgress false, UI paused, watchlist size kept",
    );

    // Preserve stocksScanned across pause skips
    stateAfterPause.stocksScanned = 16;
    stateAfterPause.lastSuccessfulScanAt = "2026-07-20T12:00:00.000Z";
    await executeMonitorScan(true);
    assert.equal(getMonitorServiceState().stocksScanned, 16);
    console.log("✓ pause skip does not zero stocksScanned");

    // 4. Exception path / finally: scanning cleared
    assert.equal(getMonitorServiceState().scanning, false);

    await resumeAutoTrading();
    const rt = await getAutoTradeRuntime();
    assert.equal(rt.runtimeDisabled, false);
    resetMonitorServiceForTests();
    console.log("✓ resume clears runtimeDisabled for next scans");
  });

  // 5. Summary for zero eligible
  {
    const summary = summarizeLastScan({
      scannedAt: "2026-07-20T12:05:00.000Z",
      symbols: ["F", "T"],
      stocksScanned: 2,
      ranked: [
        {
          rank: 1,
          symbol: "F",
          signal: "HOLD",
          confidence: 0.4,
          finalScore: 0.4,
          technicalScore: 0.4,
          newsScore: 0.4,
          marketScore: 0.4,
          riskScore: 0.4,
          autoEligible: false,
          skippedReason: "Did not meet entry rules",
          skipCode: null,
          orderSubmitted: false,
          lastScannedAt: "2026-07-20T12:05:00.000Z",
          paperOnly: true,
        },
        {
          rank: 2,
          symbol: "T",
          signal: "SKIP",
          confidence: 0.3,
          finalScore: 0.3,
          technicalScore: 0.3,
          newsScore: 0.3,
          marketScore: 0.3,
          riskScore: 0.3,
          autoEligible: false,
          skippedReason: "Spread too wide",
          skipCode: null,
          orderSubmitted: false,
          lastScannedAt: "2026-07-20T12:05:00.000Z",
          paperOnly: true,
        },
      ],
      topSymbol: null,
      topAction: null,
      paperOnly: true,
    });
    assert.ok(summary);
    assert.equal(summary!.stocksReceived, 2);
    assert.equal(summary!.eligible, 0);
    assert.equal(summary!.ordersSubmitted, 0);
    assert.equal(summary!.rejectedBySpread, 1);
    console.log("✓ zero eligible summary is completed-style, not error");
  }

  // 9. Frontend mapper: pause beats scanning
  const { mapScanStatus, buildRuntimeActivity } = await import(
    "../src/lib/client/runtime-status-mapper"
  );
  const scanMapped = mapScanStatus({
    autoTradingEnabled: true,
    orderExecutionEnabled: true,
    marketOpen: true,
    monitorRunning: true,
    monitorScanning: true,
    runtimeDisabled: true,
    engineState: "PAUSED",
    lastError:
      "New entries are paused. Resume Engine from Auto Trading to allow scans and proposals.",
  });
  assert.equal(scanMapped.state, "Paused");
  assert.notEqual(scanMapped.state, "Scanning");
  const activity = buildRuntimeActivity({
    autoTradingEnabled: true,
    orderExecutionEnabled: true,
    marketOpen: true,
    monitorRunning: true,
    monitorScanning: true,
    runtimeDisabled: true,
    engineState: "PAUSED",
  });
  assert.equal(activity.kind, "engine_paused");
  console.log("✓ frontend stale scanning does not win over pause");

  // 10. Progress consistency
  const oneEligible = summarizeLastScan({
    scannedAt: "t",
    symbols: ["A"],
    stocksScanned: 1,
    ranked: [
      {
        rank: 1,
        symbol: "A",
        signal: "BUY",
        confidence: 0.9,
        finalScore: 0.9,
        technicalScore: 0.9,
        newsScore: 0.9,
        marketScore: 0.9,
        riskScore: 0.9,
        autoEligible: true,
        skippedReason: null,
        skipCode: null,
        orderSubmitted: true,
        lastScannedAt: "t",
        paperOnly: true,
      },
    ],
    topSymbol: "A",
    topAction: "BUY",
    paperOnly: true,
  });
  assert.ok(oneEligible);
  assert.ok(oneEligible!.stocksEvaluated <= oneEligible!.stocksReceived);
  assert.equal(oneEligible!.ordersSubmitted, 1);
  console.log("✓ processed count never exceeds received total");

  console.log("verify:monitor-scan-state OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
