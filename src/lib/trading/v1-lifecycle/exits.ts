/**
 * Version 1 automatic exits — max hold, EOD, safety.
 * Only manages v1_managed longs. Never flattens AAPL short or external positions.
 */

import type { AlpacaOrder } from "@/lib/alpaca/types";
import { getV1LifecycleConfig } from "@/lib/trading/v1-lifecycle/config";
import {
  shouldSkipManualExit,
  type BrokerSnapshot,
} from "@/lib/trading/v1-lifecycle/sync";
import { applyTransition } from "@/lib/trading/v1-lifecycle/transitions";
import { buildClientOrderId } from "@/lib/trading/v1-lifecycle/client-order-id";
import type {
  V1ExitReason,
  V1LifecycleTrade,
} from "@/lib/trading/v1-lifecycle/types";

export type PlaceExitFn = (input: {
  symbol: string;
  qty: number;
  clientOrderId: string;
}) => Promise<AlpacaOrder>;

export type CancelOrderFn = (orderId: string) => Promise<void>;

export function holdingMinutes(trade: V1LifecycleTrade, nowMs: number): number {
  const start = trade.entryFilledAt
    ? Date.parse(trade.entryFilledAt)
    : Date.parse(trade.createdAt);
  return (nowMs - start) / 60_000;
}

export function needsMaxHoldExit(
  trade: V1LifecycleTrade,
  nowMs: number,
): boolean {
  if (trade.remainingQty <= 0) return false;
  if (!["POSITION_OPEN", "PROTECTION_PENDING", "MANUAL_INTERVENTION_REQUIRED"].includes(
    trade.lifecycleState,
  )) {
    return false;
  }
  return holdingMinutes(trade, nowMs) >= getV1LifecycleConfig().maxHoldMinutes;
}

export function needsEodExit(
  trade: V1LifecycleTrade,
  minutesToClose: number | null,
): boolean {
  if (trade.remainingQty <= 0) return false;
  if (minutesToClose == null) return false;
  if (!["POSITION_OPEN", "PROTECTION_PENDING", "ENTRY_PARTIALLY_FILLED"].includes(
    trade.lifecycleState,
  ) && trade.lifecycleState !== "MANUAL_INTERVENTION_REQUIRED") {
    return false;
  }
  return minutesToClose <= getV1LifecycleConfig().eodFlattenMinutes;
}

export function isEodFlattenWindow(minutesToClose: number | null): boolean {
  if (minutesToClose == null) return false;
  return minutesToClose <= getV1LifecycleConfig().eodFlattenMinutes;
}

/**
 * Submit a market sell for remaining V1 long qty only.
 * Revalidates broker qty; skips if child exit already pending/filled.
 */
export async function submitV1ManagedExit(input: {
  trade: V1LifecycleTrade;
  reason: V1ExitReason;
  brokerQty: number;
  snap: BrokerSnapshot;
  placeExit: PlaceExitFn;
  /** When true, cancels open protective sells first (Alpaca often requires this). */
  cancelOpenSells?: CancelOrderFn;
  allowSubmit: boolean;
}): Promise<
  | { ok: true; trade: V1LifecycleTrade; order: AlpacaOrder | null; skipped: boolean; skipReason?: string }
  | { ok: false; trade: V1LifecycleTrade; code: string; reason: string }
> {
  let trade = input.trade;

  if (trade.ownership !== "v1_managed") {
    return {
      ok: false,
      trade,
      code: "not_v1_managed",
      reason: "Refusing to exit non-Version-1 position",
    };
  }
  if (trade.symbol === "AAPL" && input.brokerQty < 0) {
    return {
      ok: false,
      trade,
      code: "legacy_aapl_short",
      reason: "Refusing to modify legacy AAPL short",
    };
  }

  const race = shouldSkipManualExit({
    trade,
    openOrders: input.snap.openOrders,
    recentOrders: input.snap.recentOrders,
    positionQty: input.brokerQty,
  });
  if (race.skip) {
    return {
      ok: true,
      trade,
      order: null,
      skipped: true,
      skipReason: race.reason,
    };
  }

  const qty = Math.min(trade.remainingQty, input.brokerQty);
  if (!(qty > 0)) {
    return {
      ok: false,
      trade,
      code: "no_qty",
      reason: "No remaining long quantity to exit",
    };
  }
  // Never sell more than broker long qty
  if (input.brokerQty <= 0) {
    return {
      ok: false,
      trade,
      code: "not_long",
      reason: "Broker position is not a long — refuse short creation",
    };
  }

  if (!input.allowSubmit) {
    trade = {
      ...trade,
      criticalWarnings: [
        ...trade.criticalWarnings,
        `Exit needed (${input.reason}) but execution/auto disabled — operator action required`,
      ],
    };
    trade = applyTransition(
      trade,
      "MANUAL_INTERVENTION_REQUIRED",
      `Exit ${input.reason} blocked — execution off`,
    );
    return {
      ok: false,
      trade,
      code: "execution_disabled",
      reason: "Execution/auto trading disabled — exit not submitted",
    };
  }

  // Cancel open protective sells so we can flatten remaining qty
  if (input.cancelOpenSells) {
    for (const o of input.snap.openOrders) {
      if (
        o.symbol.toUpperCase() === trade.symbol &&
        o.side === "sell" &&
        ["new", "accepted", "pending_new", "partially_filled", "held"].includes(
          (o.status ?? "").toLowerCase(),
        )
      ) {
        try {
          await input.cancelOpenSells(o.id);
        } catch {
          // Race with child fill — continue to recheck
        }
      }
    }
  }

  const clientOrderId = buildClientOrderId(trade.tradeId, "exit");
  trade = {
    ...trade,
    exitReason: input.reason,
    exitSubmittedAt: new Date().toISOString(),
  };
  trade = applyTransition(
    trade,
    "EXIT_PENDING",
    `Submitting ${input.reason} market sell qty=${qty}`,
  );

  try {
    const order = await input.placeExit({
      symbol: trade.symbol,
      qty,
      clientOrderId,
    });
    trade = {
      ...trade,
      exitOrderIds: [...new Set([...trade.exitOrderIds, order.id])],
    };
    trade = applyTransition(
      trade,
      "EXIT_ACCEPTED",
      `Exit accepted ${order.id} (status=${order.status})`,
    );
    return { ok: true, trade, order, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Exit rejected";
    if (/timeout|ECONN|ambiguous|network/i.test(message)) {
      trade = applyTransition(
        {
          ...trade,
          criticalWarnings: [
            ...trade.criticalWarnings,
            "Ambiguous exit response — reconcile before retry",
          ],
        },
        "RECONCILIATION_REQUIRED",
        message,
      );
      return { ok: false, trade, code: "ambiguous_broker", reason: message };
    }
    trade = applyTransition(
      { ...trade, exitRejectionReason: message },
      "EXIT_REJECTED",
      message,
    );
    return { ok: false, trade, code: "exit_rejected", reason: message };
  }
}

export function needsEntryTimeoutCancel(
  trade: V1LifecycleTrade,
  nowMs: number,
): boolean {
  if (
    !["ENTRY_PENDING", "ENTRY_ACCEPTED"].includes(trade.lifecycleState)
  ) {
    return false;
  }
  if (trade.filledEntryQty > 0) return false;
  const start = trade.entrySubmittedAt
    ? Date.parse(trade.entrySubmittedAt)
    : Date.parse(trade.createdAt);
  const mins = (nowMs - start) / 60_000;
  return mins >= getV1LifecycleConfig().entryOrderTimeoutMinutes;
}
