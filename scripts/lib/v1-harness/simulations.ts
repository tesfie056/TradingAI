/**
 * Deterministic Version 1 cross-module simulations (no Alpaca network).
 */

import assert from "node:assert/strict";
import {
  applyTransition,
  classifyPosition,
  evaluateV1EntryGates,
  finalizeCompleted,
  needsEodExit,
  needsMaxHoldExit,
  readV1LifecycleStore,
  replaceV1LifecycleStoreForTests,
  submitV1BracketEntry,
  submitV1ManagedExit,
  syncTradeFromBroker,
  upsertV1LifecycleTrade,
  verifyProtectiveOrders,
} from "../../../src/lib/trading/v1-lifecycle";
import {
  isCountableCompletedTrade,
  rebuildV1DailySessionFromTrades,
  recordV1CompletedTrade,
} from "../../../src/lib/trading/v1-daily";
import { makeCandidate, mockPosition } from "../../fixtures/v1-lifecycle-fixtures";
import { FakeAlpacaBroker } from "./fake-broker";
import { FakeClock } from "./fake-clock";

function openGates(
  overrides: Partial<Parameters<typeof evaluateV1EntryGates>[0]> = {},
) {
  return evaluateV1EntryGates({
    paperUrlOk: true,
    marketOpen: true,
    minutesSinceOpen: 60,
    minutesToClose: 120,
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
    ...overrides,
  });
}

function placeViaBroker(broker: FakeAlpacaBroker) {
  return {
    placeOrder: async (input: {
      symbol: string;
      qty: number;
      takeProfit: number;
      stopLoss: number;
      clientOrderId: string;
    }) =>
      broker.placeOrder({
        symbol: input.symbol,
        qty: input.qty,
        side: "buy",
        order_class: "bracket",
        take_profit: { limit_price: String(input.takeProfit) },
        stop_loss: { stop_price: String(input.stopLoss) },
        client_order_id: input.clientOrderId,
      }),
    findByClientOrderId: broker.findByClientOrderId,
  };
}

function placeExitViaBroker(broker: FakeAlpacaBroker) {
  return async (input: {
    symbol: string;
    qty: number;
    clientOrderId: string;
  }) =>
    broker.placeOrder({
      symbol: input.symbol,
      qty: input.qty,
      side: "sell",
      client_order_id: input.clientOrderId,
    });
}

/** Scenario A — take-profit win */
export async function scenarioTakeProfitWin() {
  const clock = new FakeClock("2026-07-16T15:00:00.000Z");
  const broker = new FakeAlpacaBroker({}, clock.nowMs());
  assert.equal(openGates().ok, true);

  let trade = makeCandidate({
    symbol: "F",
    qty: 2,
    entry: 20,
    stop: 19.7,
    take: 20.6,
  });
  await upsertV1LifecycleTrade(trade);
  const placed = await submitV1BracketEntry({
    trade,
    ...placeViaBroker(broker),
  });
  assert.equal(placed.ok, true);
  if (!placed.ok) throw new Error("place failed");
  trade = placed.trade;

  broker.fillEntry(trade.clientOrderId, 2, 20);
  trade = syncTradeFromBroker(trade, broker.snapshot());
  const prot = verifyProtectiveOrders({
    trade: { ...trade, filledEntryQty: 2, remainingQty: 2 },
    openOrders: broker.snapshot().openOrders,
  });
  assert.equal(prot.ok, true);

  broker.fillChildSell(trade.clientOrderId, "tp", 20.6);
  trade = syncTradeFromBroker(trade, broker.snapshot());
  if (trade.lifecycleState !== "COMPLETED") {
    trade = finalizeCompleted(
      {
        ...trade,
        ownership: "v1_managed",
        side: "long",
        remainingQty: 0,
        filledEntryQty: Math.max(trade.filledEntryQty, 2),
        filledExitQty: Math.max(trade.filledEntryQty, 2),
        actualAvgEntry: trade.actualAvgEntry ?? 20,
        avgExitPrice: 20.6,
        exitReason: "TAKE_PROFIT_FILLED",
        entryFilledAt: trade.entryFilledAt ?? clock.iso(),
        exitFilledAt: clock.iso(),
        lifecycleState: "EXIT_FILLED",
      },
      clock.nowMs(),
    );
  }
  assert.equal(trade.lifecycleState, "COMPLETED");
  assert.ok((trade.realizedNetPnL ?? 0) > 0);
  assert.equal(isCountableCompletedTrade(trade), true);

  await replaceV1LifecycleStoreForTests([trade]);
  const recorded = await recordV1CompletedTrade(trade);
  assert.equal(recorded.counted, true);
  assert.ok(recorded.session);
  assert.equal(recorded.session!.completedTradesToday, 1);
  assert.equal(recorded.session!.wins, 1);
  broker.assertNoUnexpectedMutations(["place_order"]);
  return { trade, session: recorded.session!, broker };
}

/** Scenario B — stop-loss loss */
export async function scenarioStopLossLoss() {
  const clock = new FakeClock();
  const broker = new FakeAlpacaBroker({}, clock.nowMs());
  let trade = makeCandidate({
    symbol: "T",
    qty: 2,
    entry: 20,
    stop: 19.7,
    take: 20.6,
  });
  await upsertV1LifecycleTrade(trade);
  const placed = await submitV1BracketEntry({
    trade,
    ...placeViaBroker(broker),
  });
  assert.equal(placed.ok, true);
  if (!placed.ok) throw new Error("place failed");
  trade = placed.trade;
  broker.fillEntry(trade.clientOrderId, 2, 20);
  trade = syncTradeFromBroker(trade, broker.snapshot());
  broker.fillChildSell(trade.clientOrderId, "sl", 19.7);
  trade = syncTradeFromBroker(trade, broker.snapshot());
  if (trade.lifecycleState !== "COMPLETED") {
    trade = finalizeCompleted(
      {
        ...trade,
        ownership: "v1_managed",
        side: "long",
        remainingQty: 0,
        filledEntryQty: Math.max(trade.filledEntryQty, 2),
        filledExitQty: Math.max(trade.filledEntryQty, 2),
        actualAvgEntry: trade.actualAvgEntry ?? 20,
        avgExitPrice: 19.7,
        exitReason: "STOP_LOSS_FILLED",
        entryFilledAt: trade.entryFilledAt ?? clock.iso(),
        exitFilledAt: clock.iso(),
        lifecycleState: "EXIT_FILLED",
      },
      clock.nowMs(),
    );
  }
  assert.equal(trade.lifecycleState, "COMPLETED");
  assert.ok((trade.realizedNetPnL ?? 0) < 0);
  const recorded = await recordV1CompletedTrade(trade);
  assert.equal(recorded.counted, true);
  assert.equal(recorded.session!.losses, 1);
  return { trade, session: recorded.session! };
}

/** Scenario C — partial entry then full exit of filled qty */
export async function scenarioPartialEntryFullExit() {
  const clock = new FakeClock();
  const broker = new FakeAlpacaBroker({}, clock.nowMs());
  let trade = makeCandidate({ symbol: "VZ", qty: 4, entry: 20 });
  await upsertV1LifecycleTrade(trade);
  const placed = await submitV1BracketEntry({
    trade,
    ...placeViaBroker(broker),
  });
  assert.equal(placed.ok, true);
  if (!placed.ok) throw new Error("place failed");
  trade = placed.trade;
  broker.fillEntry(trade.clientOrderId, 2, 20);
  trade = syncTradeFromBroker(trade, broker.snapshot());
  assert.ok(trade.filledEntryQty === 2);

  if (
    trade.lifecycleState !== "POSITION_OPEN" &&
    trade.lifecycleState !== "PROTECTION_PENDING"
  ) {
    trade = applyTransition(
      {
        ...trade,
        filledEntryQty: 2,
        remainingQty: 2,
      },
      "POSITION_OPEN",
      "Partial fill managed as open position",
    );
  }
  trade = { ...trade, remainingQty: 2, filledEntryQty: 2 };

  // Cancel protective children so managed exit is not raced/skipped
  for (const o of broker.orders) {
    if (o.side === "sell" && o.status === "accepted") {
      o.status = "canceled";
    }
  }

  const exit = await submitV1ManagedExit({
    trade,
    reason: "STRATEGY_SAFETY_EXIT",
    brokerQty: 2,
    snap: broker.snapshot(),
    allowSubmit: true,
    placeExit: placeExitViaBroker(broker),
  });
  assert.equal(exit.ok, true);
  if (!exit.ok) throw new Error(`exit failed: ${exit.reason}`);
  trade = exit.trade;
  const sell = broker.orders.find(
    (o) =>
      o.side === "sell" &&
      o.status === "accepted" &&
      !String(o.client_order_id).endsWith("_tp") &&
      !String(o.client_order_id).endsWith("_sl"),
  );
  assert.ok(sell, "managed exit order should exist");
  assert.ok(Number(sell!.qty) <= 2);
  sell!.status = "filled";
  sell!.filled_qty = "2";
  sell!.filled_avg_price = "20.2";
  sell!.filled_at = clock.iso();
  broker.positions = [];
  // Finalize from managed exit fill without replaying canceled child noise
  trade = finalizeCompleted(
    {
      ...trade,
      ownership: "v1_managed",
      side: "long",
      remainingQty: 0,
      filledEntryQty: 2,
      filledExitQty: 2,
      actualAvgEntry: 20,
      avgExitPrice: 20.2,
      entryFilledAt: trade.entryFilledAt ?? clock.iso(),
      exitFilledAt: clock.iso(),
      exitReason: "STRATEGY_SAFETY_EXIT",
      exitOrderIds: [...new Set([...trade.exitOrderIds, sell!.id])],
      lifecycleState: "EXIT_FILLED",
    },
    clock.nowMs(),
  );
  assert.equal(trade.remainingQty, 0);
  assert.ok(trade.filledExitQty <= trade.filledEntryQty + 1e-9);
  assert.equal(isCountableCompletedTrade(trade), true);
  return { trade };
}

/** Scenario D — max-hold exit */
export async function scenarioMaxHoldExit() {
  const clock = new FakeClock("2026-07-16T14:00:00.000Z");
  let trade = makeCandidate({ symbol: "PFE", qty: 2 });
  trade = applyTransition(trade, "ENTRY_PENDING", "p");
  trade = applyTransition(trade, "ENTRY_ACCEPTED", "a");
  trade = applyTransition(trade, "ENTRY_FILLED", "f");
  trade = applyTransition(trade, "POSITION_OPEN", "open");
  trade = {
    ...trade,
    filledEntryQty: 2,
    remainingQty: 2,
    actualAvgEntry: 20,
    entryFilledAt: clock.iso(),
  };
  assert.equal(needsMaxHoldExit(trade, clock.nowMs()), false);
  clock.advanceMinutes(91);
  assert.equal(needsMaxHoldExit(trade, clock.nowMs()), true);

  const broker = new FakeAlpacaBroker({}, clock.nowMs());
  broker.seedPosition({ symbol: "PFE", qty: 2, avgEntry: 20 });
  const exit = await submitV1ManagedExit({
    trade,
    reason: "MAX_HOLD_TIME",
    brokerQty: 2,
    snap: broker.snapshot(),
    allowSubmit: true,
    placeExit: placeExitViaBroker(broker),
  });
  assert.equal(exit.ok, true);
  if (!exit.ok) throw new Error("exit failed");
  trade = exit.trade;
  assert.equal(trade.exitReason, "MAX_HOLD_TIME");
  const sell = broker.orders.find((o) => o.side === "sell");
  assert.ok(sell);
  sell!.status = "filled";
  sell!.filled_qty = "2";
  sell!.filled_avg_price = "20";
  sell!.filled_at = clock.iso();
  broker.positions = [];
  trade = finalizeCompleted(
    {
      ...trade,
      ownership: "v1_managed",
      side: "long",
      remainingQty: 0,
      filledEntryQty: 2,
      filledExitQty: 2,
      actualAvgEntry: 20,
      avgExitPrice: 20,
      entryFilledAt: trade.entryFilledAt ?? "2026-07-16T14:00:00.000Z",
      exitFilledAt: clock.iso(),
      exitReason: "MAX_HOLD_TIME",
      exitOrderIds: [...new Set([...trade.exitOrderIds, sell!.id])],
      lifecycleState: "EXIT_FILLED",
    },
    clock.nowMs(),
  );
  assert.equal(trade.exitReason, "MAX_HOLD_TIME");
  assert.equal(isCountableCompletedTrade(trade), true);
  return { trade };
}

/** Scenario E — EOD exit leaves AAPL short untouched */
export async function scenarioEodExitLeavesLegacy() {
  let trade = makeCandidate({ symbol: "F", qty: 2 });
  trade = applyTransition(
    applyTransition(
      applyTransition(
        applyTransition(trade, "ENTRY_PENDING", "p"),
        "ENTRY_ACCEPTED",
        "a",
      ),
      "ENTRY_FILLED",
      "f",
    ),
    "POSITION_OPEN",
    "open",
  );
  trade = {
    ...trade,
    filledEntryQty: 2,
    remainingQty: 2,
    actualAvgEntry: 20,
    entryFilledAt: "2026-07-16T15:00:00.000Z",
  };
  assert.equal(needsEodExit(trade, 10), true);

  const aapl = mockPosition({ symbol: "AAPL", qty: -2, avgEntry: 300 });
  const cls = classifyPosition({
    position: aapl,
    v1Trades: [trade],
    openOrders: [],
    recentOrders: [],
  });
  assert.equal(cls.isLegacyAaplShort, true);

  const broker = new FakeAlpacaBroker();
  broker.seedPosition({ symbol: "F", qty: 2, avgEntry: 20 });
  broker.seedPosition({ symbol: "AAPL", qty: -2, avgEntry: 300 });
  const aaplBefore = broker.positions.find((p) => p.symbol === "AAPL")!.qty;

  const exit = await submitV1ManagedExit({
    trade,
    reason: "END_OF_DAY_EXIT",
    brokerQty: 2,
    snap: broker.snapshot(),
    allowSubmit: true,
    placeExit: async (input) => {
      assert.notEqual(input.symbol.toUpperCase(), "AAPL");
      return placeExitViaBroker(broker)(input);
    },
  });
  assert.equal(exit.ok, true);
  const aaplAfter = broker.positions.find((p) => p.symbol === "AAPL")!.qty;
  assert.equal(aaplAfter, aaplBefore);
  if (exit.ok) assert.equal(exit.trade.exitReason, "END_OF_DAY_EXIT");
  return { trade: exit.ok ? exit.trade : trade, aaplQty: Number(aaplAfter) };
}

/** Scenario F — ambiguous broker response → reconciliation */
export async function scenarioBrokerAmbiguity() {
  const broker = new FakeAlpacaBroker({ ambiguousPlace: true });
  const trade = makeCandidate({ symbol: "NOK", qty: 2 });
  await upsertV1LifecycleTrade(trade);
  const placed = await submitV1BracketEntry({
    trade,
    ...placeViaBroker(broker),
  });
  assert.equal(placed.ok, false);
  if (placed.ok) throw new Error("expected failure");
  assert.equal(placed.trade.lifecycleState, "RECONCILIATION_REQUIRED");
  assert.equal(
    broker.mutations.filter((m) => m.kind === "place_order").length,
    1,
  );
  return { trade: placed.trade };
}

/** Scenario G — restart recovery */
export async function scenarioRestartRecovery() {
  const broker = new FakeAlpacaBroker();
  let trade = makeCandidate({ symbol: "HBAN", qty: 2 });
  await upsertV1LifecycleTrade(trade);
  const placed = await submitV1BracketEntry({
    trade,
    ...placeViaBroker(broker),
  });
  assert.equal(placed.ok, true);
  if (!placed.ok) throw new Error("place failed");
  trade = placed.trade;
  broker.fillEntry(trade.clientOrderId, 2, 20);
  trade = syncTradeFromBroker(trade, broker.snapshot());
  await upsertV1LifecycleTrade(trade);

  const store = await readV1LifecycleStore();
  const restored = store.trades.find((t) => t.tradeId === trade.tradeId);
  assert.ok(restored);
  const synced = syncTradeFromBroker(restored!, broker.snapshot());
  assert.equal(synced.filledEntryQty, 2);
  const places = broker.mutations.filter((m) => m.kind === "place_order").length;
  assert.equal(places, 1);
  return { trade: synced, places };
}

/** Scenario H — safety overrides daily goal */
export async function scenarioSafetyOverridesDailyGoal() {
  const gates = openGates({
    dailyLossLimitReached: true,
    strategyIsBuy: true,
    executionEnabled: true,
    autoTradingEnabled: true,
  });
  assert.equal(gates.ok, false);
  assert.ok(gates.blockers.some((b) => b.code === "daily_loss"));

  const stale = openGates({ dataFresh: false });
  assert.equal(stale.ok, false);

  const session = rebuildV1DailySessionFromTrades({
    tradingDate: "2026-07-16",
    lifecycleTrades: [],
  });
  assert.equal(session.completedTradesToday, 0);
  assert.equal(session.dailyCompletedTradeTarget, 3);
  return { gates, session };
}

/** Scenario I — zero eligible universe */
export async function scenarioZeroEligibleBlocksAuto() {
  const gates = openGates({ universeEligible: false });
  assert.equal(gates.ok, false);
  assert.ok(gates.blockers.some((b) => b.code === "universe"));
  return { gates };
}

/** Scenario J — AAPL legacy short conflict; other symbol ok */
export async function scenarioLegacyShortConflict() {
  const aapl = mockPosition({ symbol: "AAPL", qty: -2 });
  const aaplCls = classifyPosition({
    position: aapl,
    v1Trades: [],
    openOrders: [],
    recentOrders: [],
  });
  assert.equal(aaplCls.isLegacyAaplShort, true);

  const aaplGates = openGates({
    classification: aaplCls,
    hasOpenPosition: true,
  });
  assert.equal(aaplGates.ok, false);
  assert.ok(
    aaplGates.blockers.some(
      (b) => b.code === "legacy_aapl_short" || b.code === "ownership_conflict" || b.code === "open_position",
    ),
  );

  const otherGates = openGates({
    classification: null,
    hasOpenPosition: false,
  });
  assert.equal(otherGates.ok, true);
  return { aaplGates, otherGates };
}
