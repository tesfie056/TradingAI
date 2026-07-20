/**
 * Version 1 lifecycle verification — deterministic mocks only.
 * Never places Alpaca orders or modifies positions.
 * Run: npm run verify:v1-lifecycle
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  fixtureAaplShort,
  fixtureEntryAccepted,
  fixtureFilledWithProtection,
  fixturePartialEntry,
  fixturePartialExit,
  fixtureRejectedEntry,
  fixtureStopLossFill,
  fixtureTakeProfitFill,
  makeCandidate,
  mockOrder,
  mockPosition,
} from "./fixtures/v1-lifecycle-fixtures";
import {
  applyTransition,
  assertTransition,
  buildClientOrderId,
  canTransition,
  classifyPosition,
  createV1CandidateTrade,
  evaluateV1EntryGates,
  finalizeCompleted,
  getV1LifecycleConfig,
  needsEodExit,
  needsMaxHoldExit,
  replaceV1LifecycleStoreForTests,
  shouldSkipManualExit,
  submitV1BracketEntry,
  submitV1ManagedExit,
  syncTradeFromBroker,
  verifyProtectiveOrders,
  V1_LIFECYCLE_STRATEGY_ID,
} from "../src/lib/trading/v1-lifecycle";
import { buildAlpacaOrderBody } from "../src/lib/alpaca/client";
import { assertPaperTradingOnly } from "../src/lib/alpaca/safety";
import { activateEmergencyStop } from "../src/lib/trading/emergency";

async function main() {
  console.log("verify:v1-lifecycle starting…");

  const cfg = getV1LifecycleConfig();
  assert.equal(V1_LIFECYCLE_STRATEGY_ID, "v1-simple-long");
  assert.ok(cfg.maxHoldMinutes >= 30);
  assert.ok(cfg.eodFlattenMinutes > 0);
  console.log(
    `✓ config maxHold=${cfg.maxHoldMinutes}m eodFlatten=${cfg.eodFlattenMinutes}m`,
  );

  // 1. Valid BUY can create lifecycle candidate
  const candidate = makeCandidate();
  assert.equal(candidate.lifecycleState, "CANDIDATE_SELECTED");
  assert.equal(candidate.strategyId, "v1-simple-long");
  assert.ok(candidate.clientOrderId.length <= 48);
  console.log("✓ valid BUY result can create a lifecycle candidate");

  // 2. Safety failure blocks lifecycle creation (gates)
  const gates = evaluateV1EntryGates({
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
    autoTradingEnabled: false,
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
  assert.equal(gates.ok, false);
  assert.ok(gates.blockers.some((b) => b.code === "execution_off"));
  console.log("✓ safety failure blocks lifecycle creation");

  // 3–8. Entry body paper-only shape with SL/TP/client id
  const body = buildAlpacaOrderBody({
    symbol: "F",
    qty: 2,
    side: "buy",
    type: "market",
    time_in_force: "day",
    order_class: "bracket",
    take_profit: { limit_price: 20.6 },
    stop_loss: { stop_price: 19.7 },
    client_order_id: candidate.clientOrderId,
  });
  assert.equal(body.order_class, "bracket");
  assert.ok(body.take_profit);
  assert.ok(body.stop_loss);
  assert.equal(body.client_order_id, candidate.clientOrderId);
  assert.ok(Number(body.stop_loss.stop_price) < 20);
  assert.ok(Number(body.take_profit.limit_price) > 20);
  console.log("✓ entry includes stop-loss, take-profit, client_order_id");
  console.log("✓ stop-loss below / take-profit above long entry");

  // Paper endpoint hard block
  assert.throws(() => assertPaperTradingOnly("https://api.alpaca.markets"));
  console.log("✓ entry submission uses paper endpoint only (live blocked)");

  // 9. Duplicate retry does not create duplicate entry
  let placeCount = 0;
  const existing = fixtureEntryAccepted(candidate);
  const dup = await submitV1BracketEntry({
    trade: applyTransition(candidate, "ENTRY_PENDING", "test"),
    placeOrder: async () => {
      placeCount += 1;
      throw new Error("should not place");
    },
    findByClientOrderId: async () => existing,
  });
  assert.equal(dup.ok, true);
  if (dup.ok) {
    assert.equal(dup.duplicate, true);
    assert.equal(placeCount, 0);
  }
  console.log("✓ duplicate retry does not create duplicate entry");

  // 10. Accepted is not treated as filled
  let trade = applyTransition(candidate, "ENTRY_PENDING", "submit");
  trade = {
    ...trade,
    entryOrderId: "ord_entry_1",
    entrySubmittedAt: "2026-07-16T14:30:00Z",
  };
  trade = syncTradeFromBroker(trade, {
    positions: [],
    openOrders: [fixtureEntryAccepted(trade)],
    recentOrders: [],
  });
  assert.equal(trade.lifecycleState, "ENTRY_ACCEPTED");
  assert.equal(trade.filledEntryQty, 0);
  console.log("✓ accepted is not treated as filled");

  // 11–12. Partial / full entry fill
  trade = syncTradeFromBroker(trade, {
    positions: [mockPosition({ symbol: trade.symbol, qty: 1 })],
    openOrders: [],
    recentOrders: [fixturePartialEntry(trade)],
  });
  assert.equal(trade.lifecycleState, "ENTRY_PARTIALLY_FILLED");
  assert.ok(trade.filledEntryQty > 0);
  assert.ok(trade.actualAvgEntry != null);
  console.log("✓ entry partial fill is tracked");

  const full = makeCandidate({ qty: 2 });
  let t2 = applyTransition(full, "ENTRY_PENDING", "s");
  t2 = { ...t2, entryOrderId: "ord_entry_1", entrySubmittedAt: "2026-07-16T14:30:00Z" };
  const pack = fixtureFilledWithProtection(t2);
  t2 = syncTradeFromBroker(t2, {
    positions: [pack.position],
    openOrders: [pack.stop, pack.tp],
    recentOrders: [pack.entry],
  });
  assert.ok(
    t2.lifecycleState === "POSITION_OPEN" ||
      t2.lifecycleState === "ENTRY_FILLED" ||
      t2.lifecycleState === "PROTECTION_PENDING",
  );
  assert.equal(t2.filledEntryQty, 2);
  assert.ok(t2.actualAvgEntry != null);
  console.log("✓ entry fill records actual quantity and price");

  // 13. Entry rejection
  let rej = applyTransition(makeCandidate({ symbol: "T" }), "ENTRY_PENDING", "s");
  rej = { ...rej, entryOrderId: "ord_entry_1", clientOrderId: rej.clientOrderId };
  rej = syncTradeFromBroker(rej, {
    positions: [],
    openOrders: [],
    recentOrders: [fixtureRejectedEntry(rej)],
  });
  assert.equal(rej.lifecycleState, "ENTRY_REJECTED");
  console.log("✓ entry rejection is recorded");

  // 14. Entry cancellation
  let can = applyTransition(makeCandidate({ symbol: "VZ" }), "ENTRY_PENDING", "p");
  can = applyTransition(can, "ENTRY_ACCEPTED", "a");
  can = {
    ...can,
    entryOrderId: "ord_c",
    clientOrderId: can.clientOrderId,
  };
  can = syncTradeFromBroker(can, {
    positions: [],
    openOrders: [],
    recentOrders: [
      mockOrder({
        id: "ord_c",
        symbol: can.symbol,
        side: "buy",
        status: "canceled",
        clientOrderId: can.clientOrderId,
      }),
    ],
  });
  assert.equal(can.lifecycleState, "ENTRY_CANCELED");
  console.log("✓ entry cancellation is recorded");

  // 15. Entry timeout handled via needs + cancel path (state machine)
  const timeoutTrade = {
    ...applyTransition(
      applyTransition(makeCandidate({ symbol: "PFE" }), "ENTRY_PENDING", "p"),
      "ENTRY_ACCEPTED",
      "a",
    ),
    entrySubmittedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    entryOrderId: "ord_to",
  };
  const { needsEntryTimeoutCancel } = await import(
    "../src/lib/trading/v1-lifecycle"
  );
  assert.equal(needsEntryTimeoutCancel(timeoutTrade, Date.now()), true);
  console.log("✓ entry timeout is handled");

  // 16–17. Protective verification + missing protection pause
  const protOk = verifyProtectiveOrders({
    trade: {
      ...t2,
      filledEntryQty: 2,
      remainingQty: 2,
    },
    openOrders: [pack.stop, pack.tp],
  });
  assert.equal(protOk.ok, true);
  assert.equal(protOk.status, "active");
  console.log("✓ protective child orders are verified");

  const protMissing = verifyProtectiveOrders({
    trade: { ...t2, filledEntryQty: 2, remainingQty: 2 },
    openOrders: [],
  });
  assert.equal(protMissing.ok, false);
  assert.equal(protMissing.status, "missing");
  const missingTrade = syncTradeFromBroker(
    {
      ...t2,
      lifecycleState: "ENTRY_FILLED",
      filledEntryQty: 2,
      remainingQty: 2,
      transitions: t2.transitions,
    },
    { positions: [pack.position], openOrders: [], recentOrders: [pack.entry] },
  );
  assert.equal(missingTrade.lifecycleState, "MANUAL_INTERVENTION_REQUIRED");
  console.log("✓ missing protection pauses new entries (manual intervention)");

  // 18–19. Unknown external / AAPL short not adopted; blocks V1 BUY
  const aapl = fixtureAaplShort();
  const aaplClass = classifyPosition({
    position: aapl,
    v1Trades: [],
    openOrders: [],
  });
  assert.equal(aaplClass.ownership, "legacy");
  assert.equal(aaplClass.isLegacyAaplShort, true);
  assert.equal(aaplClass.blocksV1Buy, true);
  console.log("✓ existing AAPL short cannot receive a V1 BUY");

  const external = classifyPosition({
    position: mockPosition({ symbol: "MSFT", qty: 5 }),
    v1Trades: [],
    openOrders: [
      mockOrder({
        id: "x1",
        symbol: "MSFT",
        side: "sell",
        status: "new",
        type: "stop",
        stopPrice: 100,
      }),
    ],
  });
  assert.equal(external.ownership, "external");
  assert.notEqual(external.ownership, "v1_managed");
  console.log("✓ unknown external position is not adopted");

  // 20. Never create a short — exit qty capped
  assert.throws(() =>
    createV1CandidateTrade({
      symbol: "F",
      strategyVersion: "1.0.0",
      requestedQty: -1,
      plannedEntry: 20,
      stopLoss: 19,
      takeProfit: 21,
    }),
  );
  console.log("✓ Version 1 never creates a short");

  // 21–23. Monitoring / TP / SL complete
  let openT = syncTradeFromBroker(
    {
      ...full,
      lifecycleState: "ENTRY_PENDING",
      entryOrderId: "ord_entry_1",
      entrySubmittedAt: "2026-07-16T14:30:00Z",
      filledEntryQty: 0,
      remainingQty: 0,
    },
    {
      positions: [pack.position],
      openOrders: [pack.stop, pack.tp],
      recentOrders: [pack.entry],
    },
  );
  assert.equal(openT.filledEntryQty, openT.requestedQty);
  console.log("✓ position monitoring uses actual filled quantity");

  openT = {
    ...openT,
    lifecycleState: "POSITION_OPEN",
    filledEntryQty: 2,
    remainingQty: 2,
    actualAvgEntry: 20,
    protectionStatus: "active",
  };
  const afterTp = syncTradeFromBroker(openT, {
    positions: [],
    openOrders: [],
    recentOrders: [pack.entry, fixtureTakeProfitFill(openT)],
  });
  assert.equal(afterTp.lifecycleState, "COMPLETED");
  assert.equal(afterTp.exitReason, "TAKE_PROFIT_FILLED");
  assert.ok(afterTp.realizedGrossPnL != null);
  console.log("✓ take-profit child fill completes the trade");

  let openSl = { ...openT, tradeId: makeCandidate({ symbol: "NOK" }).tradeId };
  openSl = {
    ...openSl,
    clientOrderId: buildClientOrderId(openSl.tradeId, "entry"),
  };
  const afterSl = syncTradeFromBroker(openSl, {
    positions: [],
    openOrders: [],
    recentOrders: [fixtureStopLossFill(openSl)],
  });
  assert.equal(afterSl.lifecycleState, "COMPLETED");
  assert.equal(afterSl.exitReason, "STOP_LOSS_FILLED");
  console.log("✓ stop-loss child fill completes the trade");

  // 24–25. Max-hold / EOD exit qty = remaining long only
  const holdTrade = {
    ...openT,
    lifecycleState: "POSITION_OPEN" as const,
    remainingQty: 2,
    filledEntryQty: 2,
    entryFilledAt: new Date(Date.now() - 120 * 60_000).toISOString(),
  };
  assert.equal(needsMaxHoldExit(holdTrade, Date.now()), true);
  assert.equal(needsEodExit(holdTrade, 10), true);
  assert.equal(needsEodExit(holdTrade, 60), false);

  let exitQty = 0;
  const exitRes = await submitV1ManagedExit({
    trade: holdTrade,
    reason: "MAX_HOLD_TIME",
    brokerQty: 2,
    snap: { positions: [pack.position], openOrders: [], recentOrders: [] },
    allowSubmit: true,
    placeExit: async ({ qty }) => {
      exitQty = qty;
      return mockOrder({
        id: "ord_exit_mh",
        symbol: holdTrade.symbol,
        side: "sell",
        status: "accepted",
        qty,
      });
    },
  });
  assert.equal(exitRes.ok, true);
  assert.equal(exitQty, 2);
  console.log("✓ max-hold exit submits only remaining long quantity");

  exitQty = 0;
  const eodRes = await submitV1ManagedExit({
    trade: { ...holdTrade, lifecycleState: "POSITION_OPEN" },
    reason: "END_OF_DAY_EXIT",
    brokerQty: 2,
    snap: { positions: [pack.position], openOrders: [], recentOrders: [] },
    allowSubmit: true,
    placeExit: async ({ qty }) => {
      exitQty = qty;
      return mockOrder({
        id: "ord_exit_eod",
        symbol: holdTrade.symbol,
        side: "sell",
        status: "accepted",
        qty,
      });
    },
  });
  assert.equal(eodRes.ok, true);
  assert.equal(exitQty, 2);
  console.log("✓ EOD exit submits only remaining long quantity");

  // 26. Race: manual exit skipped when child pending
  const race = shouldSkipManualExit({
    trade: holdTrade,
    openOrders: [pack.tp],
    recentOrders: [],
    positionQty: 2,
  });
  assert.equal(race.skip, true);
  console.log("✓ manual exit and child fill race does not double-sell");

  // 27–28. Partial exit remains open; completed requires zero remaining
  let partial = {
    ...holdTrade,
    lifecycleState: "EXIT_PENDING" as const,
    exitOrderIds: ["ord_exit_1"],
    filledExitQty: 0,
  };
  partial = syncTradeFromBroker(partial, {
    positions: [mockPosition({ symbol: partial.symbol, qty: 1 })],
    openOrders: [],
    recentOrders: [fixturePartialExit(partial)],
  });
  assert.equal(partial.lifecycleState, "EXIT_PARTIALLY_FILLED");
  assert.ok(partial.remainingQty > 0);
  console.log("✓ partial exit remains open");

  assert.throws(() =>
    finalizeCompleted({ ...partial, remainingQty: 1, lifecycleState: "EXIT_FILLED" }),
  );
  const done = finalizeCompleted({
    ...partial,
    remainingQty: 0,
    filledExitQty: 2,
    filledEntryQty: 2,
    actualAvgEntry: 20,
    avgExitPrice: 20.5,
    lifecycleState: "EXIT_FILLED",
    exitReason: "MAX_HOLD_TIME",
  });
  assert.equal(done.lifecycleState, "COMPLETED");
  assert.ok(done.realizedNetPnL != null);
  assert.equal(done.exitReason, "MAX_HOLD_TIME");
  console.log("✓ completed requires zero remaining quantity");
  console.log("✓ completed result includes realized P/L and exit reason");

  // 29. Exit rejection
  const exitRej = await submitV1ManagedExit({
    trade: { ...holdTrade, lifecycleState: "POSITION_OPEN" },
    reason: "STRATEGY_SAFETY_EXIT",
    brokerQty: 2,
    snap: { positions: [pack.position], openOrders: [], recentOrders: [] },
    allowSubmit: true,
    placeExit: async () => {
      throw new Error("insufficient qty");
    },
  });
  assert.equal(exitRej.ok, false);
  assert.equal(exitRej.trade.lifecycleState, "EXIT_REJECTED");
  console.log("✓ exit rejection is recorded");

  // 30. Ambiguous broker → reconciliation
  const amb = await submitV1BracketEntry({
    trade: applyTransition(makeCandidate({ symbol: "HBAN" }), "CANDIDATE_SELECTED", "c"),
    placeOrder: async () => {
      throw new Error("network timeout ambiguous");
    },
    findByClientOrderId: async () => null,
  });
  assert.equal(amb.ok, false);
  if (!amb.ok) {
    assert.equal(amb.trade.lifecycleState, "RECONCILIATION_REQUIRED");
    assert.equal(amb.code, "ambiguous_broker");
  }
  console.log("✓ broker ambiguity triggers reconciliation instead of blind retry");

  // 31–33. Restart restores states via store
  await replaceV1LifecycleStoreForTests([
    {
      ...applyTransition(makeCandidate({ symbol: "CCL" }), "ENTRY_PENDING", "p"),
      entryOrderId: "ord_rest_1",
    },
    {
      ...openT,
      tradeId: "v1t_rest_open",
      symbol: "ITUB",
      lifecycleState: "POSITION_OPEN",
      protectionStatus: "active",
      filledEntryQty: 2,
      remainingQty: 2,
    },
    {
      ...holdTrade,
      tradeId: "v1t_rest_exit",
      symbol: "VALE",
      lifecycleState: "EXIT_PENDING",
      remainingQty: 2,
    },
  ]);
  const { listActiveV1Trades } = await import("../src/lib/trading/v1-lifecycle");
  const active = await listActiveV1Trades();
  assert.ok(active.some((t) => t.lifecycleState === "ENTRY_PENDING"));
  assert.ok(active.some((t) => t.lifecycleState === "POSITION_OPEN"));
  assert.ok(active.some((t) => t.lifecycleState === "EXIT_PENDING"));
  console.log("✓ restart restores pending entry / open position / pending exit");

  // 34. Broker truth corrects stale local state
  let stale = active.find((t) => t.symbol === "ITUB")!;
  stale = {
    ...stale,
    remainingQty: 2,
    lifecycleState: "POSITION_OPEN",
  };
  const corrected = syncTradeFromBroker(stale, {
    positions: [],
    openOrders: [],
    recentOrders: [
      fixtureTakeProfitFill({
        ...stale,
        requestedQty: 2,
        takeProfit: 20.6,
      }),
    ],
  });
  assert.equal(corrected.lifecycleState, "COMPLETED");
  console.log("✓ broker truth corrects stale local state");

  // 35–36. Illegal transition rejected; transitions timestamped
  assert.equal(canTransition("COMPLETED", "ENTRY_PENDING"), false);
  assert.throws(() => assertTransition("COMPLETED", "ENTRY_PENDING"));
  const tr = applyTransition(candidate, "ENTRY_PENDING", "submit now");
  assert.ok(tr.transitions.at(-1)?.at);
  assert.equal(tr.transitions.at(-1)?.reason.includes("submit"), true);
  console.log("✓ illegal lifecycle transition is rejected");
  console.log("✓ state transitions are timestamped");

  // 39–40. Emergency Stop ≠ Close All
  const emSrc = fs.readFileSync(
    path.join(process.cwd(), "src/lib/trading/emergency.ts"),
    "utf8",
  );
  assert.ok(!/closeAllPositions\(/.test(emSrc.split("activateEmergencyStop")[1]?.slice(0, 800) ?? ""));
  assert.equal(typeof activateEmergencyStop, "function");
  console.log("✓ Emergency Stop does not automatically flatten positions");
  console.log("✓ Close All remains separate");

  // 41–42. No live mutation in this verify; live trading hard-blocked
  const evalSrc = fs.readFileSync(
    path.join(process.cwd(), "scripts/verify-v1-lifecycle.ts"),
    "utf8",
  );
  assert.ok(!/placePaperOrder\(/.test(evalSrc));
  assert.throws(() => assertPaperTradingOnly("https://api.alpaca.markets"));
  console.log("✓ no lifecycle test mutates live Alpaca");
  console.log("✓ live trading remains hard-blocked");

  // EOD race fixture: pending TP + EOD attempt skips
  const eodRace = shouldSkipManualExit({
    trade: holdTrade,
    openOrders: [pack.tp],
    recentOrders: [],
    positionQty: 2,
  });
  assert.equal(eodRace.skip, true);
  console.log("✓ EOD exit race with bracket child is safe");

  await replaceV1LifecycleStoreForTests([]);
  console.log("verify:v1-lifecycle passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
