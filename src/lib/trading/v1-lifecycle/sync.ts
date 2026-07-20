/**
 * Pure broker → local lifecycle sync for one Version 1 trade.
 * No network calls. Broker truth overrides stale local assumptions.
 */

import type { AlpacaOrder, AlpacaPosition } from "@/lib/alpaca/types";
import {
  isFillStatus,
  isTerminalFailure,
  mapAlpacaOrderStatus,
} from "@/lib/trading/v1-lifecycle/broker-status";
import { verifyProtectiveOrders } from "@/lib/trading/v1-lifecycle/protection";
import { applyTransition } from "@/lib/trading/v1-lifecycle/transitions";
import type {
  V1ExitReason,
  V1LifecycleTrade,
} from "@/lib/trading/v1-lifecycle/types";

export type BrokerSnapshot = {
  positions: AlpacaPosition[];
  openOrders: AlpacaOrder[];
  recentOrders: AlpacaOrder[];
  nowMs?: number;
};

function findEntryOrder(
  trade: V1LifecycleTrade,
  snap: BrokerSnapshot,
): AlpacaOrder | undefined {
  const pool = [...snap.openOrders, ...snap.recentOrders];
  return pool.find(
    (o) =>
      o.id === trade.entryOrderId ||
      o.client_order_id === trade.clientOrderId,
  );
}

function findExitOrders(
  trade: V1LifecycleTrade,
  snap: BrokerSnapshot,
): AlpacaOrder[] {
  const pool = [...snap.openOrders, ...snap.recentOrders];
  const ids = new Set(trade.exitOrderIds);
  return pool.filter(
    (o) =>
      ids.has(o.id) ||
      (o.side === "sell" &&
        o.symbol.toUpperCase() === trade.symbol &&
        o.client_order_id?.includes(trade.tradeId)),
  );
}

function positionQty(snap: BrokerSnapshot, symbol: string): number {
  const p = snap.positions.find((x) => x.symbol.toUpperCase() === symbol);
  return p ? Number(p.qty) : 0;
}

/**
 * Sync one trade from broker snapshot. Never creates shorts.
 * Does not submit orders.
 */
export function syncTradeFromBroker(
  trade: V1LifecycleTrade,
  snap: BrokerSnapshot,
): V1LifecycleTrade {
  if (
    trade.lifecycleState === "COMPLETED" ||
    trade.lifecycleState === "ENTRY_REJECTED"
  ) {
    return trade;
  }

  let next: V1LifecycleTrade = {
    ...trade,
    lastBrokerUpdateAt: new Date(snap.nowMs ?? Date.now()).toISOString(),
    lastReconciledAt: new Date(snap.nowMs ?? Date.now()).toISOString(),
  };

  const entry = findEntryOrder(next, snap);
  if (entry) {
    next.entryOrderId = entry.id;
    const phase = mapAlpacaOrderStatus(entry.status);
    const filledQty = Number(entry.filled_qty ?? 0);
    const avg = entry.filled_avg_price ? Number(entry.filled_avg_price) : null;

    if (
      next.lifecycleState === "ENTRY_PENDING" ||
      next.lifecycleState === "CANDIDATE_SELECTED"
    ) {
      if (phase === "accepted" || phase === "new" || phase === "submitted") {
        next = applyTransition(next, "ENTRY_ACCEPTED", `Broker status ${entry.status}`);
      }
    }

    const inEntryPhase = [
      "CANDIDATE_SELECTED",
      "ENTRY_PENDING",
      "ENTRY_ACCEPTED",
      "ENTRY_PARTIALLY_FILLED",
    ].includes(next.lifecycleState);

    if (isFillStatus(phase) && filledQty > 0) {
      next.filledEntryQty = filledQty;
      next.actualAvgEntry = avg;
      next.remainingQty = Math.max(0, filledQty - next.filledExitQty);
      next.entryFilledAt = entry.filled_at ?? next.entryFilledAt ?? next.lastBrokerUpdateAt;

      if (inEntryPhase) {
        if (phase === "partially_filled") {
          next = applyTransition(
            next,
            "ENTRY_PARTIALLY_FILLED",
            `Partial entry fill qty=${filledQty}`,
          );
        } else if (phase === "filled") {
          next = applyTransition(next, "ENTRY_FILLED", `Entry filled qty=${filledQty}`);
        }
      }
    }

    if (inEntryPhase && isTerminalFailure(phase) && filledQty <= 0) {
      next.entryRejectionReason = `Entry ${phase}`;
      next = applyTransition(
        next,
        phase === "rejected" ? "ENTRY_REJECTED" : "ENTRY_CANCELED",
        `Entry order ${phase}`,
      );
      return next;
    }

    // Partial then canceled — keep filled qty open
    if (inEntryPhase && isTerminalFailure(phase) && filledQty > 0) {
      next.filledEntryQty = filledQty;
      next.actualAvgEntry = avg;
      next.remainingQty = Math.max(0, filledQty - next.filledExitQty);
      next = applyTransition(
        next,
        "ENTRY_PARTIALLY_FILLED",
        `Entry ${phase} after partial fill — managing filled qty`,
      );
    }
  }

  // Ambiguous: submitted locally but no broker order found after reconcile window
  if (
    next.lifecycleState === "ENTRY_PENDING" &&
    next.entryOrderId &&
    !entry
  ) {
    next = applyTransition(
      next,
      "RECONCILIATION_REQUIRED",
      "Entry order id set but broker order not found — do not resubmit blindly",
    );
    next.criticalWarnings = [
      ...next.criticalWarnings,
      "Broker ambiguity on entry — reconcile before retry",
    ];
    return next;
  }

  if (
    next.lifecycleState === "ENTRY_PARTIALLY_FILLED" &&
    next.filledEntryQty > 0
  ) {
    next.protectionStatus = "pending";
  }

  // Child TP/SL fills and manual exits first — a filled TP/SL means
  // protective legs are gone by design and must not look like "missing protection".
  next = syncBracketChildFills(next, snap);
  next = syncExitOrders(next, snap);

  // Protection after entry is fully filled (not while exiting / completed).
  if (
    ["ENTRY_FILLED", "PROTECTION_PENDING", "POSITION_OPEN"].includes(
      next.lifecycleState,
    ) &&
    next.filledEntryQty > 0 &&
    next.remainingQty > 1e-9
  ) {
    const prot = verifyProtectiveOrders({
      trade: next,
      openOrders: snap.openOrders,
      recentOrders: snap.recentOrders,
    });
    next.protectionStatus = prot.status;
    next.stopOrderId = prot.stopOrderId ?? next.stopOrderId;
    next.takeProfitOrderId = prot.takeProfitOrderId ?? next.takeProfitOrderId;

    if (prot.ok) {
      next = applyTransition(next, "POSITION_OPEN", "Protective bracket legs confirmed");
      next.criticalWarnings = next.criticalWarnings.filter(
        (w) => !/missing protection/i.test(w),
      );
    } else if (prot.status === "missing" || prot.status === "partial") {
      next = applyTransition(
        next,
        "MANUAL_INTERVENTION_REQUIRED",
        prot.warnings[0] ?? "Missing protection",
      );
      next.criticalWarnings = [
        ...new Set([
          ...next.criticalWarnings,
          "Missing protection — new entries paused until resolved",
          ...prot.warnings,
        ]),
      ];
    } else {
      next = applyTransition(next, "PROTECTION_PENDING", "Awaiting protective legs");
    }
  }

  // Also allow exit completion from MANUAL_INTERVENTION when children filled
  if (
    next.lifecycleState === "MANUAL_INTERVENTION_REQUIRED" &&
    next.remainingQty <= 1e-9 &&
    next.filledExitQty > 0
  ) {
    next = applyTransition(next, "EXIT_FILLED", "Exit confirmed while in intervention");
  }

  // Broker position flat while we thought open → force reconcile / complete path
  const qty = positionQty(snap, next.symbol);
  if (
    qty === 0 &&
    next.filledEntryQty > 0 &&
    next.remainingQty > 0 &&
    ["POSITION_OPEN", "PROTECTION_PENDING", "MANUAL_INTERVENTION_REQUIRED"].includes(
      next.lifecycleState,
    )
  ) {
    // Likely exited via child without us seeing — mark reconciliation
    next = applyTransition(
      next,
      "RECONCILIATION_REQUIRED",
      "Broker position flat but local remaining qty > 0",
    );
  }

  // Complete when remaining is zero and exit filled
  if (
    next.lifecycleState === "EXIT_FILLED" &&
    next.remainingQty <= 1e-9 &&
    next.filledExitQty > 0
  ) {
    next = finalizeCompleted(next, snap.nowMs);
  }

  return next;
}

function syncBracketChildFills(
  trade: V1LifecycleTrade,
  snap: BrokerSnapshot,
): V1LifecycleTrade {
  if (trade.filledEntryQty <= 0) return trade;
  let next = trade;
  const sells = [...snap.openOrders, ...snap.recentOrders].filter(
    (o) =>
      o.symbol.toUpperCase() === next.symbol &&
      o.side === "sell" &&
      mapAlpacaOrderStatus(o.status) === "filled",
  );

  for (const o of sells) {
    const filled = Number(o.filled_qty ?? o.qty ?? 0);
    if (!(filled > 0)) continue;
    // Skip if already counted
    if (next.exitOrderIds.includes(o.id) && next.lifecycleState === "COMPLETED") {
      continue;
    }

    const isStop =
      (o.type ?? o.order_type ?? "").toLowerCase().includes("stop") ||
      Boolean(o.stop_price);
    const reason: V1ExitReason = isStop
      ? "STOP_LOSS_FILLED"
      : "TAKE_PROFIT_FILLED";

    const avg = o.filled_avg_price ? Number(o.filled_avg_price) : null;
    next = applyExitFill(next, {
      exitOrderId: o.id,
      filledQty: filled,
      avgExitPrice: avg,
      reason,
      at: o.filled_at ?? next.lastBrokerUpdateAt ?? new Date().toISOString(),
    });
  }
  return next;
}

function syncExitOrders(
  trade: V1LifecycleTrade,
  snap: BrokerSnapshot,
): V1LifecycleTrade {
  const exits = findExitOrders(trade, snap);
  if (exits.length === 0) return trade;
  let next = trade;

  for (const o of exits) {
    const phase = mapAlpacaOrderStatus(o.status);
    if (
      next.lifecycleState === "EXIT_PENDING" &&
      (phase === "accepted" || phase === "new" || phase === "submitted")
    ) {
      next = applyTransition(next, "EXIT_ACCEPTED", `Exit broker status ${o.status}`);
    }
    if (phase === "partially_filled") {
      const filled = Number(o.filled_qty ?? 0);
      next = applyExitFill(next, {
        exitOrderId: o.id,
        filledQty: filled,
        avgExitPrice: o.filled_avg_price ? Number(o.filled_avg_price) : null,
        reason: next.exitReason ?? "STRATEGY_SAFETY_EXIT",
        at: o.filled_at ?? new Date().toISOString(),
        partial: true,
      });
    }
    if (phase === "filled") {
      const filled = Number(o.filled_qty ?? o.qty ?? 0);
      next = applyExitFill(next, {
        exitOrderId: o.id,
        filledQty: filled,
        avgExitPrice: o.filled_avg_price ? Number(o.filled_avg_price) : null,
        reason: next.exitReason ?? "STRATEGY_SAFETY_EXIT",
        at: o.filled_at ?? new Date().toISOString(),
      });
    }
    if (phase === "rejected") {
      next.exitRejectionReason = `Exit rejected (${o.status})`;
      next = applyTransition(next, "EXIT_REJECTED", next.exitRejectionReason);
    }
    if (phase === "canceled" && Number(o.filled_qty ?? 0) <= 0) {
      next = applyTransition(next, "EXIT_CANCELED", "Exit canceled unfilled");
      // Return to open if position remains
      if (next.remainingQty > 0) {
        next = applyTransition(next, "POSITION_OPEN", "Resume monitoring after exit cancel");
      }
    }
  }
  return next;
}

export function applyExitFill(
  trade: V1LifecycleTrade,
  input: {
    exitOrderId: string;
    filledQty: number;
    avgExitPrice: number | null;
    reason: V1ExitReason;
    at: string;
    partial?: boolean;
  },
): V1LifecycleTrade {
  if (trade.lifecycleState === "COMPLETED") return trade;

  let next = trade;
  if (!next.exitOrderIds.includes(input.exitOrderId)) {
    next = {
      ...next,
      exitOrderIds: [...next.exitOrderIds, input.exitOrderId],
    };
  }

  // Cap exit qty to remaining long — never create a short
  const addable = Math.min(
    input.filledQty,
    Math.max(0, next.filledEntryQty - next.filledExitQty),
  );
  if (addable <= 0 && next.remainingQty <= 0) {
    if (next.lifecycleState === "EXIT_FILLED") {
      return finalizeCompleted(next);
    }
    if (next.filledExitQty > 0) {
      next = applyTransition(next, "EXIT_FILLED", "Exit already complete");
      return finalizeCompleted(next);
    }
    return next;
  }

  const prevExitQty = next.filledExitQty;
  const newExitQty = prevExitQty + addable;
  // Weighted average exit
  let avgExit = next.avgExitPrice;
  if (input.avgExitPrice != null && addable > 0) {
    if (avgExit == null || prevExitQty <= 0) avgExit = input.avgExitPrice;
    else {
      avgExit =
        (avgExit * prevExitQty + input.avgExitPrice * addable) / newExitQty;
    }
  }

  next = {
    ...next,
    filledExitQty: newExitQty,
    remainingQty: Math.max(0, next.filledEntryQty - newExitQty),
    avgExitPrice: avgExit,
    exitReason: input.reason,
    exitFilledAt: input.at,
  };

  if (input.partial || next.remainingQty > 1e-9) {
    next = applyTransition(
      next,
      "EXIT_PARTIALLY_FILLED",
      `Partial exit fill +${addable}; remaining ${next.remainingQty}`,
    );
    return next;
  }

  next = applyTransition(next, "EXIT_FILLED", `Exit filled; reason ${input.reason}`);
  return finalizeCompleted(next);
}

export function finalizeCompleted(
  trade: V1LifecycleTrade,
  nowMs = Date.now(),
): V1LifecycleTrade {
  if (trade.remainingQty > 1e-9) {
    throw new Error("Cannot complete Version 1 trade while remaining qty > 0");
  }
  let next = trade;
  if (next.lifecycleState !== "EXIT_FILLED" && next.lifecycleState !== "COMPLETED") {
    next = applyTransition(next, "EXIT_FILLED", "Preparing completion");
  }
  const entry = next.actualAvgEntry ?? next.plannedEntry ?? 0;
  const exit = next.avgExitPrice ?? 0;
  const qty = next.filledExitQty;
  const gross = Number(((exit - entry) * qty).toFixed(4));
  const fees = next.fees ?? 0;
  const net = Number((gross - fees).toFixed(4));
  const holdStart = next.entryFilledAt
    ? Date.parse(next.entryFilledAt)
    : Date.parse(next.createdAt);
  const holdEnd = next.exitFilledAt
    ? Date.parse(next.exitFilledAt)
    : nowMs;

  next = {
    ...next,
    realizedGrossPnL: gross,
    realizedNetPnL: net,
    holdingDurationMs: Math.max(0, holdEnd - holdStart),
    completedAt: new Date(nowMs).toISOString(),
  };
  next = applyTransition(next, "COMPLETED", `Round trip complete; net P/L ${net}`);
  return next;
}

/** Detect race: do not submit another sell if child already filled/pending. */
export function shouldSkipManualExit(input: {
  trade: V1LifecycleTrade;
  openOrders: AlpacaOrder[];
  recentOrders: AlpacaOrder[];
  positionQty: number;
}): { skip: boolean; reason: string } {
  if (input.positionQty <= 0) {
    return { skip: true, reason: "No long position remaining at broker" };
  }
  if (input.trade.remainingQty <= 0) {
    return { skip: true, reason: "Local remaining qty is zero" };
  }
  const pendingSell = input.openOrders.find(
    (o) =>
      o.symbol.toUpperCase() === input.trade.symbol &&
      o.side === "sell" &&
      ["new", "accepted", "pending_new", "partially_filled", "held"].includes(
        (o.status ?? "").toLowerCase(),
      ),
  );
  if (pendingSell) {
    return {
      skip: true,
      reason: `Exit already pending at broker (${pendingSell.id})`,
    };
  }
  const justFilled = input.recentOrders.find(
    (o) =>
      o.symbol.toUpperCase() === input.trade.symbol &&
      o.side === "sell" &&
      mapAlpacaOrderStatus(o.status) === "filled" &&
      Date.parse(o.filled_at ?? o.updated_at) > Date.now() - 60_000,
  );
  if (justFilled) {
    return {
      skip: true,
      reason: `Recent sell fill detected (${justFilled.id}) — sync instead of double-sell`,
    };
  }
  return { skip: false, reason: "" };
}
