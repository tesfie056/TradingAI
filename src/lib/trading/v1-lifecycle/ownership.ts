/**
 * Classify broker positions vs Version 1 ownership.
 * Never auto-adopts unknown/legacy positions as V1-managed.
 * Never auto-modifies the existing AAPL short.
 */

import type { AlpacaOrder, AlpacaPosition } from "@/lib/alpaca/types";
import type { V1LifecycleTrade } from "@/lib/trading/v1-lifecycle/types";
import type { V1PositionClassification } from "@/lib/trading/v1-lifecycle/types";
import { isV1ClientOrderId } from "@/lib/trading/v1-lifecycle/client-order-id";
import { isOpenManagedState } from "@/lib/trading/v1-lifecycle/transitions";

export function classifyPosition(input: {
  position: AlpacaPosition;
  v1Trades: V1LifecycleTrade[];
  openOrders: AlpacaOrder[];
  recentOrders?: AlpacaOrder[];
}): V1PositionClassification {
  const symbol = input.position.symbol.toUpperCase();
  const qty = Number(input.position.qty);
  const avgEntry = Number(input.position.avg_entry_price);
  const side: "long" | "short" | "flat" =
    qty > 0 ? "long" : qty < 0 ? "short" : "flat";

  const isLegacyAaplShort = symbol === "AAPL" && qty < 0;

  const managed = input.v1Trades.find(
    (t) =>
      t.symbol === symbol &&
      t.ownership === "v1_managed" &&
      isOpenManagedState(t.lifecycleState) &&
      t.remainingQty > 0,
  );

  const hasProtective = hasProtectiveOrders(
    symbol,
    input.openOrders,
    input.recentOrders ?? [],
  );

  if (isLegacyAaplShort) {
    return {
      symbol,
      qty,
      side,
      avgEntry: Number.isFinite(avgEntry) ? avgEntry : null,
      ownership: "legacy",
      tradeId: null,
      protectionStatus: hasProtective ? "active" : "missing",
      blocksV1Buy: true,
      reason:
        "Existing AAPL short is a legacy paper position outside Version 1. Do not auto-close or add to it.",
      isLegacyAaplShort: true,
    };
  }

  if (managed) {
    return {
      symbol,
      qty,
      side,
      avgEntry: Number.isFinite(avgEntry) ? avgEntry : null,
      ownership: "v1_managed",
      tradeId: managed.tradeId,
      protectionStatus:
        managed.protectionStatus === "active"
          ? "active"
          : managed.protectionStatus === "missing"
            ? "missing"
            : hasProtective
              ? "active"
              : "missing",
      blocksV1Buy: true,
      reason: `Version 1-managed trade ${managed.tradeId} (${managed.lifecycleState}).`,
      isLegacyAaplShort: false,
    };
  }

  // Broker order with V1 client id but no local open trade → unknown / reconcile
  const v1Order = [...input.openOrders, ...(input.recentOrders ?? [])].find(
    (o) =>
      o.symbol.toUpperCase() === symbol && isV1ClientOrderId(o.client_order_id),
  );
  if (v1Order && !managed) {
    return {
      symbol,
      qty,
      side,
      avgEntry: Number.isFinite(avgEntry) ? avgEntry : null,
      ownership: "unknown",
      tradeId: null,
      protectionStatus: hasProtective ? "active" : "missing",
      blocksV1Buy: true,
      reason:
        "Broker shows a Version 1 client order id but no matching local open trade — reconciliation required. Not auto-adopted.",
      isLegacyAaplShort: false,
    };
  }

  if (qty !== 0 && !hasProtective) {
    return {
      symbol,
      qty,
      side,
      avgEntry: Number.isFinite(avgEntry) ? avgEntry : null,
      ownership: "orphaned",
      tradeId: null,
      protectionStatus: "missing",
      blocksV1Buy: true,
      reason:
        "External/orphaned position without protective orders — not Version 1-managed; operator action required.",
      isLegacyAaplShort: false,
    };
  }

  if (qty !== 0) {
    return {
      symbol,
      qty,
      side,
      avgEntry: Number.isFinite(avgEntry) ? avgEntry : null,
      ownership: "external",
      tradeId: null,
      protectionStatus: hasProtective ? "active" : "missing",
      blocksV1Buy: true,
      reason:
        "External broker position not opened by Version 1 — will not be auto-managed or liquidated.",
      isLegacyAaplShort: false,
    };
  }

  return {
    symbol,
    qty: 0,
    side: "flat",
    avgEntry: null,
    ownership: "external",
    tradeId: null,
    protectionStatus: "n/a",
    blocksV1Buy: false,
    reason: "No open position.",
    isLegacyAaplShort: false,
  };
}

export function hasProtectiveOrders(
  symbol: string,
  openOrders: AlpacaOrder[],
  recentOrders: AlpacaOrder[] = [],
): boolean {
  const sym = symbol.toUpperCase();
  const pool = [...openOrders, ...recentOrders];
  for (const o of pool) {
    if (o.symbol.toUpperCase() !== sym) continue;
    const status = (o.status ?? "").toLowerCase();
    if (["canceled", "expired", "rejected", "filled"].includes(status)) {
      // filled children already exited; open stop/limit still matter
      if (status === "filled") continue;
    }
    const t = (o.type ?? o.order_type ?? "").toLowerCase();
    if (
      t.includes("stop") ||
      (t === "limit" && o.side === "sell") ||
      o.order_class === "bracket" ||
      Boolean(o.stop_price) ||
      (Boolean(o.limit_price) && o.side === "sell")
    ) {
      if (["new", "accepted", "pending_new", "partially_filled", "held"].includes(status) ||
          o.order_class === "bracket") {
        return true;
      }
    }
  }
  // Parent bracket filled often leaves open legs with order_class != bracket
  return openOrders.some((o) => {
    if (o.symbol.toUpperCase() !== sym) return false;
    const status = (o.status ?? "").toLowerCase();
    if (!["new", "accepted", "pending_new", "partially_filled", "held"].includes(status)) {
      return false;
    }
    return o.side === "sell";
  });
}

/** True when any short or non-V1 position should block a V1 BUY on symbol. */
export function blocksV1BuyForSymbol(
  classifications: V1PositionClassification[],
  symbol: string,
): boolean {
  const c = classifications.find((x) => x.symbol === symbol.toUpperCase());
  return Boolean(c?.blocksV1Buy);
}

export function aaplShortBlocksV1Buy(
  classifications: V1PositionClassification[],
): boolean {
  return classifications.some((c) => c.isLegacyAaplShort);
}
