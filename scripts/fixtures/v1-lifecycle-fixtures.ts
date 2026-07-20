/**
 * Deterministic broker fixtures for Version 1 lifecycle unit tests.
 * No live Alpaca calls.
 */

import type { AlpacaOrder, AlpacaPosition } from "@/lib/alpaca/types";
import { createV1CandidateTrade } from "../../src/lib/trading/v1-lifecycle/factory";
import type { V1LifecycleTrade } from "../../src/lib/trading/v1-lifecycle/types";

export function mockPosition(input: {
  symbol: string;
  qty: number;
  avgEntry?: number;
  current?: number;
}): AlpacaPosition {
  return {
    asset_id: "a",
    symbol: input.symbol.toUpperCase(),
    qty: String(input.qty),
    side: input.qty < 0 ? "short" : "long",
    market_value: String(Math.abs(input.qty) * (input.current ?? input.avgEntry ?? 20)),
    avg_entry_price: String(input.avgEntry ?? 20),
    current_price: String(input.current ?? input.avgEntry ?? 20),
    unrealized_pl: "0",
  };
}

export function mockOrder(input: {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  status: string;
  qty?: number;
  filledQty?: number;
  filledAvg?: number | null;
  clientOrderId?: string;
  type?: string;
  orderClass?: string;
  stopPrice?: number | null;
  limitPrice?: number | null;
  filledAt?: string | null;
}): AlpacaOrder {
  return {
    id: input.id,
    client_order_id: input.clientOrderId ?? input.id,
    created_at: "2026-07-16T14:00:00Z",
    updated_at: "2026-07-16T14:00:01Z",
    submitted_at: "2026-07-16T14:00:00Z",
    filled_at: input.filledAt ?? null,
    expired_at: null,
    canceled_at: null,
    failed_at: null,
    asset_id: "a",
    symbol: input.symbol.toUpperCase(),
    asset_class: "us_equity",
    qty: String(input.qty ?? 1),
    filled_qty: String(input.filledQty ?? 0),
    filled_avg_price:
      input.filledAvg != null ? String(input.filledAvg) : null,
    order_class: input.orderClass ?? "simple",
    order_type: input.type ?? "market",
    type: input.type ?? "market",
    side: input.side,
    time_in_force: "day",
    limit_price: input.limitPrice != null ? String(input.limitPrice) : null,
    stop_price: input.stopPrice != null ? String(input.stopPrice) : null,
    status: input.status,
    extended_hours: false,
  };
}

export function makeCandidate(overrides: Partial<{
  symbol: string;
  qty: number;
  entry: number;
  stop: number;
  take: number;
}> = {}): V1LifecycleTrade {
  const entry = overrides.entry ?? 20;
  return createV1CandidateTrade({
    symbol: overrides.symbol ?? "F",
    strategyVersion: "1.0.0",
    scanId: "scan_test",
    decisionId: "dec_test",
    requestedQty: overrides.qty ?? 2,
    plannedEntry: entry,
    stopLoss: overrides.stop ?? entry * 0.985,
    takeProfit: overrides.take ?? entry * 1.03,
    expectedRisk: entry * 0.015 * (overrides.qty ?? 2),
    rewardToRisk: 2,
    nowIso: "2026-07-16T14:30:00.000Z",
  });
}

/** Entry accepted but unfilled. */
export function fixtureEntryAccepted(trade: V1LifecycleTrade) {
  return mockOrder({
    id: "ord_entry_1",
    symbol: trade.symbol,
    side: "buy",
    status: "accepted",
    qty: trade.requestedQty,
    clientOrderId: trade.clientOrderId,
    orderClass: "bracket",
  });
}

/** Partial entry fill. */
export function fixturePartialEntry(trade: V1LifecycleTrade) {
  return mockOrder({
    id: "ord_entry_1",
    symbol: trade.symbol,
    side: "buy",
    status: "partially_filled",
    qty: trade.requestedQty,
    filledQty: trade.requestedQty / 2,
    filledAvg: trade.plannedEntry ?? 20,
    clientOrderId: trade.clientOrderId,
    orderClass: "bracket",
    filledAt: "2026-07-16T14:31:00Z",
  });
}

/** Full entry fill + active bracket children. */
export function fixtureFilledWithProtection(trade: V1LifecycleTrade) {
  const entry = mockOrder({
    id: "ord_entry_1",
    symbol: trade.symbol,
    side: "buy",
    status: "filled",
    qty: trade.requestedQty,
    filledQty: trade.requestedQty,
    filledAvg: trade.plannedEntry ?? 20,
    clientOrderId: trade.clientOrderId,
    orderClass: "bracket",
    filledAt: "2026-07-16T14:31:00Z",
  });
  const stop = mockOrder({
    id: "ord_stop_1",
    symbol: trade.symbol,
    side: "sell",
    status: "new",
    qty: trade.requestedQty,
    type: "stop",
    stopPrice: trade.stopLoss,
  });
  const tp = mockOrder({
    id: "ord_tp_1",
    symbol: trade.symbol,
    side: "sell",
    status: "new",
    qty: trade.requestedQty,
    type: "limit",
    limitPrice: trade.takeProfit,
  });
  const position = mockPosition({
    symbol: trade.symbol,
    qty: trade.requestedQty,
    avgEntry: trade.plannedEntry ?? 20,
  });
  return { entry, stop, tp, position };
}

export function fixtureTakeProfitFill(trade: V1LifecycleTrade) {
  return mockOrder({
    id: "ord_tp_1",
    symbol: trade.symbol,
    side: "sell",
    status: "filled",
    qty: trade.requestedQty,
    filledQty: trade.requestedQty,
    filledAvg: trade.takeProfit ?? 20.6,
    type: "limit",
    limitPrice: trade.takeProfit,
    filledAt: "2026-07-16T15:00:00Z",
  });
}

export function fixtureStopLossFill(trade: V1LifecycleTrade) {
  return mockOrder({
    id: "ord_stop_1",
    symbol: trade.symbol,
    side: "sell",
    status: "filled",
    qty: trade.requestedQty,
    filledQty: trade.requestedQty,
    filledAvg: trade.stopLoss ?? 19.7,
    type: "stop",
    stopPrice: trade.stopLoss,
    filledAt: "2026-07-16T15:00:00Z",
  });
}

export function fixturePartialExit(trade: V1LifecycleTrade) {
  return mockOrder({
    id: "ord_exit_1",
    symbol: trade.symbol,
    side: "sell",
    status: "partially_filled",
    qty: trade.remainingQty || trade.requestedQty,
    filledQty: 1,
    filledAvg: 20.4,
    clientOrderId: `v1_${trade.tradeId}_exit`,
    filledAt: "2026-07-16T15:10:00Z",
  });
}

export function fixtureRejectedEntry(trade: V1LifecycleTrade) {
  return mockOrder({
    id: "ord_entry_1",
    symbol: trade.symbol,
    side: "buy",
    status: "rejected",
    qty: trade.requestedQty,
    clientOrderId: trade.clientOrderId,
  });
}

export function fixtureAaplShort(): AlpacaPosition {
  return mockPosition({ symbol: "AAPL", qty: -2, avgEntry: 190 });
}
