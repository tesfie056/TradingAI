/**
 * Groups 14–15 — Cross-module E2E simulations + failure injection.
 * Deterministic fake broker / temp data — never contacts Alpaca.
 * Run: npm run verify:v1-integration
 */
import assert from "node:assert/strict";
import {
  withTempTradingData,
  scenarioTakeProfitWin,
  scenarioStopLossLoss,
  scenarioPartialEntryFullExit,
  scenarioMaxHoldExit,
  scenarioEodExitLeavesLegacy,
  scenarioBrokerAmbiguity,
  scenarioRestartRecovery,
  scenarioSafetyOverridesDailyGoal,
  scenarioZeroEligibleBlocksAuto,
  scenarioLegacyShortConflict,
  scenarioMorningUnattendedResume,
  FakeAlpacaBroker,
} from "./lib/v1-harness";
import {
  applyTransition,
  canTransition,
  assertTransition,
  evaluateV1EntryGates,
  replaceV1LifecycleStoreForTests,
  submitV1BracketEntry,
  syncTradeFromBroker,
} from "../src/lib/trading/v1-lifecycle";
import { makeCandidate as mk } from "./fixtures/v1-lifecycle-fixtures";
import { assertPaperTradingOnly } from "../src/lib/alpaca/safety";

async function main() {
  console.log("verify:v1-integration starting…");
  const temp = await withTempTradingData();
  let failed = false;
  try {
    console.log("— Scenario A take-profit win");
    await scenarioTakeProfitWin();
    console.log("✓ A take-profit win completes + daily win count");

    console.log("— Scenario B stop-loss loss");
    await scenarioStopLossLoss();
    console.log("✓ B stop-loss loss completes + daily loss count");

    console.log("— Scenario C partial entry full exit");
    await scenarioPartialEntryFullExit();
    console.log("✓ C partial entry then full exit; no short");

    console.log("— Scenario D max-hold exit");
    await scenarioMaxHoldExit();
    console.log("✓ D max-hold at 90m");

    console.log("— Scenario E EOD exit / legacy AAPL");
    const eod = await scenarioEodExitLeavesLegacy();
    assert.equal(eod.aaplQty, -2);
    console.log("✓ E EOD exit; AAPL short untouched");

    console.log("— Scenario F broker ambiguity");
    await scenarioBrokerAmbiguity();
    console.log("✓ F ambiguous response → reconciliation; no blind retry");

    console.log("— Scenario G restart recovery");
    await scenarioRestartRecovery();
    console.log("✓ G restart restores filled state; no duplicate place");

    console.log("— Scenario H safety overrides daily goal");
    await scenarioSafetyOverridesDailyGoal();
    console.log("✓ H daily goal never bypasses safety blocks");

    console.log("— Scenario I zero eligible");
    await scenarioZeroEligibleBlocksAuto();
    console.log("✓ I zero eligible blocks entries");

    console.log("— Scenario J legacy short conflict");
    await scenarioLegacyShortConflict();
    console.log("✓ J AAPL short blocks AAPL; other symbols remain evaluable");

    console.log("— Scenario K morning unattended resume");
    await scenarioMorningUnattendedResume();
    console.log(
      "✓ K overnight→open delay→eligible places once; no duplicate; accepted≠filled",
    );

    // Illegal transitions
    assert.equal(canTransition("CANDIDATE_SELECTED", "COMPLETED"), false);
    assert.equal(canTransition("ENTRY_PENDING", "POSITION_OPEN"), false);
    assert.equal(canTransition("ENTRY_REJECTED", "ENTRY_FILLED"), false);
    assert.equal(canTransition("COMPLETED", "POSITION_OPEN"), false);
    assert.throws(() =>
      assertTransition("CANDIDATE_SELECTED", "COMPLETED"),
    );
    console.log("✓ illegal lifecycle transitions rejected");

    // Failure injection — broker unavailable
    const down = new FakeAlpacaBroker({ unavailable: true });
    const cand = mk({ symbol: "ERIC" });
    const fail = await submitV1BracketEntry({
      trade: cand,
      placeOrder: async (input) =>
        down.placeOrder({
          symbol: input.symbol,
          qty: input.qty,
          side: "buy",
          order_class: "bracket",
          take_profit: { limit_price: String(input.takeProfit) },
          stop_loss: { stop_price: String(input.stopLoss) },
          client_order_id: input.clientOrderId,
        }),
      findByClientOrderId: down.findByClientOrderId,
    });
    assert.equal(fail.ok, false);
    console.log("✓ failure injection: broker unavailable does not leave blind retry");

    // Corrupt / unknown state — applyTransition throws on illegal
    const open = applyTransition(
      applyTransition(
        applyTransition(mk({ symbol: "ITUB" }), "ENTRY_PENDING", "p"),
        "ENTRY_ACCEPTED",
        "a",
      ),
      "ENTRY_FILLED",
      "f",
    );
    assert.throws(() =>
      applyTransition(open, "COMPLETED", "illegal skip"),
    );
    console.log("✓ failure injection: illegal jump to COMPLETED rejected");

    // Accepted ≠ filled regression
    let t = applyTransition(mk({ symbol: "VALE" }), "ENTRY_PENDING", "p");
    t = {
      ...t,
      entryOrderId: "ord_x",
      entrySubmittedAt: "2026-07-16T15:00:00Z",
    };
    t = syncTradeFromBroker(t, {
      positions: [],
      openOrders: [
        {
          id: "ord_x",
          client_order_id: t.clientOrderId,
          created_at: "2026-07-16T15:00:00Z",
          updated_at: "2026-07-16T15:00:00Z",
          submitted_at: "2026-07-16T15:00:00Z",
          filled_at: null,
          expired_at: null,
          canceled_at: null,
          failed_at: null,
          asset_id: "a",
          symbol: "VALE",
          asset_class: "us_equity",
          qty: "2",
          filled_qty: "0",
          filled_avg_price: null,
          order_class: "bracket",
          order_type: "market",
          type: "market",
          side: "buy",
          time_in_force: "day",
          limit_price: null,
          stop_price: null,
          status: "accepted",
          extended_hours: false,
        },
      ],
      recentOrders: [],
    });
    assert.equal(t.lifecycleState, "ENTRY_ACCEPTED");
    assert.equal(t.filledEntryQty, 0);
    console.log("✓ regression: accepted is not treated as filled");

    // Gate: completed < 3 never bypasses block
    const g = evaluateV1EntryGates({
      paperUrlOk: true,
      marketOpen: false,
      minutesSinceOpen: null,
      minutesToClose: null,
      openEntryDelayMinutes: 15,
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
    assert.equal(g.ok, false);
    console.log("✓ fewer than three completed trades never bypasses market-closed");

    assert.throws(() => assertPaperTradingOnly("https://api.alpaca.markets"));
    await replaceV1LifecycleStoreForTests([]);
    console.log("verify:v1-integration passed");
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
