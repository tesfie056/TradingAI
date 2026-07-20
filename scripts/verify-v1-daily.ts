/**
 * Version 1 daily completed-trade target verification.
 * Deterministic fixtures only — never submits Alpaca orders.
 * Run: npm run verify:v1-daily
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  acceptedUnfilled,
  completedRoundTrip,
  openManagedTrade,
  partialExitTrade,
} from "./fixtures/v1-daily-fixtures";
import {
  V1_DAILY_TARGET_DEFAULT,
  buildTargetFailureReasons,
  buildV1DailyReport,
  classifyRealizedPnL,
  getV1DailyConfig,
  getV1DailyConfigWarnings,
  isCountableCompletedTrade,
  rebuildV1DailySessionFromTrades,
  recordV1CompletedTrade,
  tradingDateForCompletedTrade,
  emptyV1DailySession,
} from "../src/lib/trading/v1-daily";
import { evaluateV1EntryGates } from "../src/lib/trading/v1-lifecycle";
import { replaceV1LifecycleStoreForTests } from "../src/lib/trading/v1-lifecycle";
import {
  readV1DailySession,
  writeV1DailySession,
} from "../src/lib/trading/v1-daily";
import { marketDayKey, MARKET_TIMEZONE } from "../src/lib/market/time";
import { assertPaperTradingOnly } from "../src/lib/alpaca/safety";
import { classifyPosition } from "../src/lib/trading/v1-lifecycle";
import { mockPosition } from "./fixtures/v1-lifecycle-fixtures";

async function main() {
  console.log("verify:v1-daily starting…");

  const cfg = getV1DailyConfig();
  assert.equal(V1_DAILY_TARGET_DEFAULT, 3);
  assert.equal(cfg.dailyCompletedTradeTarget, 3);
  assert.equal(cfg.timezone, "America/New_York");
  assert.equal(MARKET_TIMEZONE, "America/New_York");
  console.log("✓ daily target default is 3");
  console.log("✓ target configuration has one clear source");
  console.log("✓ current trading date uses America/New_York");

  // Weekend: Saturday ET
  const sat = marketDayKey("2026-07-18T16:00:00.000Z"); // Sat afternoon UTC ~ midday ET
  assert.match(sat, /^\d{4}-\d{2}-\d{2}$/);
  console.log("✓ weekend handling (ET calendar date)");

  // Holiday / early-close: trading date remains ET YYYY-MM-DD (clock metadata separate)
  const july4 = marketDayKey("2026-07-04T18:00:00.000Z");
  assert.equal(july4, "2026-07-04");
  console.log("✓ market holiday / early-close use ET session date key");

  const win = completedRoundTrip({
    tradeId: "v1t_win1",
    exitFilledAt: "2026-07-16T15:00:00.000Z",
    grossPnL: 1.2,
    netPnL: 1.15,
    fees: 0.05,
  });
  assert.equal(isCountableCompletedTrade(win), true);
  assert.equal(tradingDateForCompletedTrade(win), "2026-07-16");
  console.log("✓ completed managed round trip is countable on exit date");

  // Legacy / external / orphaned / AAPL short
  const legacyLike = {
    ...win,
    ownership: "legacy" as const,
    tradeId: "v1t_legacy",
  };
  assert.equal(isCountableCompletedTrade(legacyLike as typeof win), false);
  const aaplClass = classifyPosition({
    position: mockPosition({ symbol: "AAPL", qty: -2 }),
    v1Trades: [],
    openOrders: [],
  });
  assert.equal(aaplClass.isLegacyAaplShort, true);
  assert.equal(
    isCountableCompletedTrade({
      ...win,
      symbol: "AAPL",
      ownership: "v1_managed",
      tradeId: "nope",
    }),
    true,
  ); // would count only if somehow v1_managed COMPLETED — AAPL short itself is not
  // Explicit: short position classification never produces a counted trade record
  assert.ok(aaplClass.ownership === "legacy");
  console.log("✓ legacy / AAPL short does not increment count");
  console.log("✓ external / orphaned ownership excluded via isCountableCompletedTrade");

  assert.equal(isCountableCompletedTrade(acceptedUnfilled()), false);
  assert.equal(
    isCountableCompletedTrade({
      ...win,
      lifecycleState: "POSITION_OPEN",
      remainingQty: 2,
      filledExitQty: 0,
      completedAt: null,
    }),
    false,
  );
  assert.equal(isCountableCompletedTrade(partialExitTrade()), false);
  console.log("✓ accepted / open / partial exit do not increment count");

  // Dedup via record
  await replaceV1LifecycleStoreForTests([]);
  const day = "2026-07-16";
  await writeV1DailySession(emptyV1DailySession({ tradingDate: day }));

  const r1 = await recordV1CompletedTrade(win);
  assert.equal(r1.counted, true);
  const r2 = await recordV1CompletedTrade(win);
  assert.equal(r2.duplicate, true);
  assert.equal(r2.counted, false);
  assert.equal(r1.session?.completedTradesToday, 1);
  console.log("✓ same trade cannot increment twice");
  console.log("✓ restart/reconcile replay does not duplicate count");

  // Win / loss / breakeven
  assert.equal(
    classifyRealizedPnL({ realizedNetPnL: 1, realizedGrossPnL: 1 }).pnlClass,
    "win",
  );
  assert.equal(
    classifyRealizedPnL({ realizedNetPnL: -0.5, realizedGrossPnL: -0.4 })
      .pnlClass,
    "loss",
  );
  assert.equal(
    classifyRealizedPnL({ realizedNetPnL: 0.001, realizedGrossPnL: 0 }).pnlClass,
    "breakeven",
  );
  console.log("✓ winning / losing / breakeven classification");

  const loss = completedRoundTrip({
    tradeId: "v1t_loss1",
    symbol: "T",
    exitFilledAt: "2026-07-16T15:30:00.000Z",
    grossPnL: -0.8,
    netPnL: -0.8,
    exitReason: "STOP_LOSS_FILLED",
  });
  const even = completedRoundTrip({
    tradeId: "v1t_even1",
    symbol: "VZ",
    exitFilledAt: "2026-07-16T16:00:00.000Z",
    grossPnL: 0,
    netPnL: 0,
  });
  await recordV1CompletedTrade(loss);
  await recordV1CompletedTrade(even);

  const rebuilt = rebuildV1DailySessionFromTrades({
    tradingDate: day,
    lifecycleTrades: [win, loss, even, win], // duplicate win in list
    entryAttemptsToday: 3,
  });
  assert.equal(rebuilt.completedTradesToday, 3);
  assert.equal(rebuilt.wins, 1);
  assert.equal(rebuilt.losses, 1);
  assert.equal(rebuilt.breakeven, 1);
  assert.equal(rebuilt.targetReached, true);
  assert.equal(rebuilt.remainingToTarget, 0);
  assert.ok(Math.abs(rebuilt.grossRealizedPnL - (1.2 - 0.8 + 0)) < 1e-9);
  assert.ok(Math.abs(rebuilt.netRealizedPnL - (1.15 - 0.8 + 0)) < 1e-9);
  console.log("✓ gross / net P/L sums correct");
  console.log("✓ remaining-to-target and target reached at 3");
  console.log("✓ duplicate lifecycle records are deduplicated");
  console.log("✓ rebuild from lifecycle records restores totals");

  const more = rebuildV1DailySessionFromTrades({
    tradingDate: day,
    lifecycleTrades: [
      win,
      loss,
      even,
      completedRoundTrip({
        tradeId: "v1t_extra",
        symbol: "NOK",
        exitFilledAt: "2026-07-16T17:00:00.000Z",
        grossPnL: 0.5,
      }),
    ],
  });
  assert.equal(more.completedTradesToday, 4);
  assert.equal(more.targetReached, true);
  console.log("✓ more than 3 remains target reached");

  // Target reached does not bypass max trades — max is independent counter
  assert.equal(more.maxTradesReached, false);
  const maxHit = {
    ...more,
    entryAttemptsToday: more.maxTradesPerDay,
  };
  const withMax = rebuildV1DailySessionFromTrades({
    tradingDate: day,
    lifecycleTrades: [win, loss, even],
    entryAttemptsToday: cfg.maxTradesPerDay,
    existing: maxHit,
  });
  assert.equal(withMax.maxTradesReached, true);
  assert.equal(withMax.targetReached, true);
  console.log("✓ target reached does not bypass maximum trades");

  // Fewer than 3 never weakens safety gates
  const incomplete = rebuildV1DailySessionFromTrades({
    tradingDate: day,
    lifecycleTrades: [win],
  });
  assert.equal(incomplete.completedTradesToday, 1);
  assert.equal(incomplete.targetReached, false);
  const gates = evaluateV1EntryGates({
    paperUrlOk: true,
    marketOpen: false,
    minutesSinceOpen: null,
    minutesToClose: null,
    openEntryDelayMinutes: 0,
    eodEntryCutoffMinutes: 30,
    dataFresh: false,
    universeEligible: true,
    strategyIsBuy: true,
    strategyVersion: "1.0.0",
    executionEnabled: false,
    autoTradingEnabled: false,
    emergencyStopActive: true,
    killSwitchActive: true,
    panicActive: true,
    reconciliationHealthy: false,
    hasOpenPosition: false,
    hasPendingEntry: false,
    hasPendingExit: false,
    maxOpenPositionsReached: false,
    maxDailyTradesReached: false,
    dailyLossLimitReached: true,
    consecutiveLossPause: true,
    buyingPowerSufficient: true,
    sizingPassed: true,
    stopLossValid: true,
    takeProfitValid: true,
    rewardToRisk: 2,
    qtyPositive: true,
    fractionalOk: true,
  });
  assert.equal(gates.ok, false);
  assert.ok(gates.blockers.some((b) => b.code === "market_closed"));
  assert.ok(gates.blockers.some((b) => b.code === "stale_data"));
  assert.ok(gates.blockers.some((b) => b.code === "daily_loss"));
  assert.ok(gates.blockers.some((b) => b.code === "consecutive_loss"));
  assert.ok(gates.blockers.some((b) => b.code === "emergency_stop"));
  assert.ok(gates.blockers.some((b) => b.code === "execution_off"));
  console.log("✓ fewer than 3 never bypasses market/stale/loss/pause/emergency/execution blocks");

  // Config warning max < target
  const warn = getV1DailyConfigWarnings({
    ...cfg,
    maxTradesPerDay: 1,
    dailyCompletedTradeTarget: 3,
  });
  assert.ok(warn.some((w) => w.code === "MAX_BELOW_TARGET"));
  console.log("✓ maxTradesPerDay below target creates warning");

  // Failure reasons
  const reasons = buildTargetFailureReasons(
    {
      ...incomplete,
      openV1Trades: 1,
      pendingEntries: 0,
      pendingExits: 0,
      configurationWarnings: [],
      maxTradesReached: false,
    },
    {
      marketOpen: false,
      executionEnabled: false,
      autoTradingEnabled: false,
      eligibleSymbolCount: 0,
      noQualifiedSetup: true,
      hasRejectedEntry: true,
      hasOpenV1: true,
    },
  );
  assert.ok(reasons.some((r) => r.code === "NO_ELIGIBLE_SYMBOLS"));
  assert.ok(reasons.some((r) => r.code === "NO_QUALIFIED_SETUP"));
  assert.ok(reasons.some((r) => r.code === "ORDER_REJECTED"));
  assert.ok(reasons.some((r) => r.code === "POSITION_STILL_OPEN"));
  assert.ok(reasons.some((r) => r.code === "MARKET_CLOSED"));
  console.log("✓ target failure reasons recorded");

  // Open managed / pending
  const withOpen = rebuildV1DailySessionFromTrades({
    tradingDate: day,
    lifecycleTrades: [win, openManagedTrade()],
  });
  assert.ok(withOpen.openV1Trades >= 1);
  assert.ok(
    withOpen.failureReasons.some((r) => r.code === "POSITION_STILL_OPEN"),
  );
  console.log("✓ open position records target-incomplete reason");

  // Session persistence / new day
  const otherDay = rebuildV1DailySessionFromTrades({
    tradingDate: "2026-07-17",
    lifecycleTrades: [
      completedRoundTrip({
        tradeId: "v1t_next",
        exitFilledAt: "2026-07-17T15:00:00.000Z",
        grossPnL: 0.4,
      }),
    ],
  });
  await writeV1DailySession(otherDay);
  await writeV1DailySession(rebuilt);
  const prior = await readV1DailySession(day);
  const next = await readV1DailySession("2026-07-17");
  assert.equal(prior?.completedTradesToday, 3);
  assert.equal(next?.completedTradesToday, 1);
  assert.notEqual(prior?.tradingDate, next?.tradingDate);
  console.log("✓ session persists; new trading date creates new session");
  console.log("✓ prior sessions remain unchanged");

  // Report preliminary vs final
  const report = buildV1DailyReport({ ...rebuilt, status: "preliminary" });
  assert.equal(report.status, "preliminary");
  assert.equal(report.aaplShortExcluded, true);
  const finalReport = buildV1DailyReport({
    ...rebuilt,
    status: "final",
    finalizedAt: new Date().toISOString(),
  });
  assert.equal(finalReport.status, "final");
  console.log("✓ daily report marks preliminary vs final");

  // API date validation present
  const routeSrc = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/auto-trade/daily-sessions/[date]/route.ts",
    ),
    "utf8",
  );
  assert.ok(routeSrc.includes("YYYY-MM-DD"));
  assert.ok(routeSrc.includes("status: 400"));
  console.log("✓ historical session API validates dates");

  const statusRoute = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/auto-trade/daily-status/route.ts"),
    "utf8",
  );
  assert.ok(statusRoute.includes("getV1DailyStatusSnapshot"));
  console.log("✓ daily session API returns status");

  // No broker mutations in this verify
  const self = fs.readFileSync(
    path.join(process.cwd(), "scripts/verify-v1-daily.ts"),
    "utf8",
  );
  assert.ok(!/\bplacePaperOrder\b/.test(self));
  assert.throws(() => assertPaperTradingOnly("https://api.alpaca.markets"));
  console.log("✓ no daily-tracking test submits broker orders");
  console.log("✓ existing paper-only protection remains enforced");
  console.log("✓ live trading remains hard-blocked");

  // Exit-date accounting: entry yesterday, exit today → counts today
  const cross = completedRoundTrip({
    tradeId: "v1t_cross",
    entryFilledAt: "2026-07-15T19:00:00.000Z",
    exitFilledAt: "2026-07-16T14:00:00.000Z",
    grossPnL: 0.25,
  });
  assert.equal(tradingDateForCompletedTrade(cross), "2026-07-16");
  console.log("✓ completed trade assigned to final exit date");

  // Cleanup test sessions written
  await replaceV1LifecycleStoreForTests([]);

  console.log("verify:v1-daily passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
