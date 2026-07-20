/**
 * Deterministic lifecycle fixtures for Version 1 daily-target tests.
 */

import type { V1LifecycleTrade } from "../../src/lib/trading/v1-lifecycle/types";
import { createV1CandidateTrade } from "../../src/lib/trading/v1-lifecycle/factory";
import { applyTransition } from "../../src/lib/trading/v1-lifecycle/transitions";

export function completedRoundTrip(input: {
  tradeId?: string;
  symbol?: string;
  exitFilledAt: string;
  entryFilledAt?: string;
  grossPnL: number;
  netPnL?: number;
  fees?: number | null;
  exitReason?: V1LifecycleTrade["exitReason"];
}): V1LifecycleTrade {
  const base = createV1CandidateTrade({
    symbol: input.symbol ?? "F",
    strategyVersion: "1.0.0",
    requestedQty: 2,
    plannedEntry: 20,
    stopLoss: 19.7,
    takeProfit: 20.6,
    rewardToRisk: 2,
    nowIso: input.entryFilledAt ?? "2026-07-16T14:30:00.000Z",
  });

  let t: V1LifecycleTrade = {
    ...base,
    tradeId: input.tradeId ?? base.tradeId,
    clientOrderId: `v1_${input.tradeId ?? base.tradeId}_entry`.slice(0, 48),
    filledEntryQty: 2,
    filledExitQty: 2,
    remainingQty: 0,
    actualAvgEntry: 20,
    avgExitPrice: 20 + input.grossPnL / 2,
    entryFilledAt: input.entryFilledAt ?? "2026-07-16T14:31:00.000Z",
    exitFilledAt: input.exitFilledAt,
    realizedGrossPnL: input.grossPnL,
    realizedNetPnL: input.netPnL ?? input.grossPnL,
    fees: input.fees ?? null,
    exitReason: input.exitReason ?? "TAKE_PROFIT_FILLED",
    protectionStatus: "active",
    completedAt: input.exitFilledAt,
  };
  t = applyTransition(t, "ENTRY_PENDING", "f");
  t = applyTransition(t, "ENTRY_FILLED", "f");
  t = applyTransition(t, "POSITION_OPEN", "f");
  t = applyTransition(t, "EXIT_FILLED", "f");
  t = applyTransition(t, "COMPLETED", "fixture complete");
  return t;
}

export function openManagedTrade(symbol = "T"): V1LifecycleTrade {
  const base = createV1CandidateTrade({
    symbol,
    strategyVersion: "1.0.0",
    requestedQty: 1,
    plannedEntry: 20,
    stopLoss: 19.7,
    takeProfit: 20.6,
    rewardToRisk: 2,
  });
  let t: V1LifecycleTrade = {
    ...base,
    filledEntryQty: 1,
    remainingQty: 1,
    actualAvgEntry: 20,
    entryFilledAt: "2026-07-16T14:31:00.000Z",
    protectionStatus: "active",
  };
  t = applyTransition(t, "ENTRY_PENDING", "f");
  t = applyTransition(t, "ENTRY_FILLED", "f");
  t = applyTransition(t, "POSITION_OPEN", "open");
  return t;
}

export function acceptedUnfilled(symbol = "VZ"): V1LifecycleTrade {
  const base = createV1CandidateTrade({
    symbol,
    strategyVersion: "1.0.0",
    requestedQty: 1,
    plannedEntry: 20,
    stopLoss: 19.7,
    takeProfit: 20.6,
    rewardToRisk: 2,
  });
  return applyTransition(
    applyTransition(base, "ENTRY_PENDING", "p"),
    "ENTRY_ACCEPTED",
    "accepted only",
  );
}

export function partialExitTrade(symbol = "PFE"): V1LifecycleTrade {
  const base = createV1CandidateTrade({
    symbol,
    strategyVersion: "1.0.0",
    requestedQty: 2,
    plannedEntry: 20,
    stopLoss: 19.7,
    takeProfit: 20.6,
    rewardToRisk: 2,
  });
  let t: V1LifecycleTrade = {
    ...base,
    filledEntryQty: 2,
    filledExitQty: 1,
    remainingQty: 1,
    actualAvgEntry: 20,
    avgExitPrice: 20.3,
    entryFilledAt: "2026-07-16T14:31:00.000Z",
    exitFilledAt: "2026-07-16T15:00:00.000Z",
    protectionStatus: "active",
  };
  t = applyTransition(t, "ENTRY_PENDING", "f");
  t = applyTransition(t, "ENTRY_FILLED", "f");
  t = applyTransition(t, "POSITION_OPEN", "f");
  t = applyTransition(t, "EXIT_PARTIALLY_FILLED", "partial");
  return t;
}
