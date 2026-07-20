/**
 * Verify bracket protective legs for a Version 1-managed position.
 */

import type { AlpacaOrder } from "@/lib/alpaca/types";
import type { V1LifecycleTrade } from "@/lib/trading/v1-lifecycle/types";

export type ProtectionCheck = {
  ok: boolean;
  status: V1LifecycleTrade["protectionStatus"];
  stopOrderId: string | null;
  takeProfitOrderId: string | null;
  warnings: string[];
};

/**
 * After entry fill, confirm stop-loss and take-profit sell legs exist
 * for the filled long quantity (or parent bracket still tracks them).
 */
export function verifyProtectiveOrders(input: {
  trade: V1LifecycleTrade;
  openOrders: AlpacaOrder[];
  recentOrders?: AlpacaOrder[];
}): ProtectionCheck {
  const sym = input.trade.symbol.toUpperCase();
  const filled = input.trade.filledEntryQty;
  const warnings: string[] = [];
  const pool = [...input.openOrders, ...(input.recentOrders ?? [])];

  const openSells = input.openOrders.filter(
    (o) =>
      o.symbol.toUpperCase() === sym &&
      o.side === "sell" &&
      ["new", "accepted", "pending_new", "partially_filled", "held"].includes(
        (o.status ?? "").toLowerCase(),
      ),
  );

  let stop: AlpacaOrder | undefined;
  let tp: AlpacaOrder | undefined;

  for (const o of openSells) {
    const t = (o.type ?? o.order_type ?? "").toLowerCase();
    if (t.includes("stop") || o.stop_price) {
      stop = o;
    } else if (t === "limit" || o.limit_price) {
      tp = o;
    }
  }

  // Also accept legs referenced on parent bracket in recent orders
  if (!stop || !tp) {
    const parent = pool.find(
      (o) =>
        o.id === input.trade.entryOrderId ||
        o.client_order_id === input.trade.clientOrderId,
    );
    if (parent?.order_class === "bracket") {
      // Legs may not yet appear separately — treat as pending if parent not filled
      if ((parent.status ?? "").toLowerCase() !== "filled" && filled <= 0) {
        return {
          ok: false,
          status: "pending",
          stopOrderId: stop?.id ?? null,
          takeProfitOrderId: tp?.id ?? null,
          warnings: ["Bracket parent accepted; protective legs not confirmed yet."],
        };
      }
    }
  }

  if (filled > 0 && openSells.length === 0) {
    warnings.push("Missing protective sell orders after entry fill.");
    return {
      ok: false,
      status: "missing",
      stopOrderId: null,
      takeProfitOrderId: null,
      warnings,
    };
  }

  if (filled > 0 && (!stop || !tp)) {
    warnings.push(
      "Protection incomplete — need both stop-loss and take-profit sell legs.",
    );
    return {
      ok: false,
      status: "partial",
      stopOrderId: stop?.id ?? null,
      takeProfitOrderId: tp?.id ?? null,
      warnings,
    };
  }

  // Quantity sanity: sell legs should not exceed filled long qty
  for (const o of openSells) {
    const q = Number(o.qty ?? o.filled_qty ?? 0);
    if (Number.isFinite(q) && filled > 0 && q > filled + 1e-6) {
      warnings.push(
        "Protective order quantity exceeds filled long quantity — manual review.",
      );
      return {
        ok: false,
        status: "partial",
        stopOrderId: stop?.id ?? null,
        takeProfitOrderId: tp?.id ?? null,
        warnings,
      };
    }
    if (o.side !== "sell") {
      warnings.push("Protective leg is not a sell — refuses reverse exposure.");
      return {
        ok: false,
        status: "missing",
        stopOrderId: stop?.id ?? null,
        takeProfitOrderId: tp?.id ?? null,
        warnings,
      };
    }
  }

  if (filled <= 0) {
    return {
      ok: false,
      status: "pending",
      stopOrderId: stop?.id ?? null,
      takeProfitOrderId: tp?.id ?? null,
      warnings: ["Entry not filled yet — protection pending."],
    };
  }

  return {
    ok: true,
    status: "active",
    stopOrderId: stop?.id ?? null,
    takeProfitOrderId: tp?.id ?? null,
    warnings: [],
  };
}
