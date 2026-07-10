import type { AlpacaOrder } from "@/lib/alpaca/types";
import type { TradeRow } from "@/lib/dashboard-types";
import type { OrderMode } from "@/lib/config";

export function inferOrderMode(order: {
  notional?: string | null;
  qty?: string | null;
}): OrderMode {
  const notional = order.notional?.trim();
  if (notional != null && notional !== "" && Number(notional) > 0) {
    return "notional";
  }
  return "quantity";
}

export function mapAlpacaOrderToTradeRow(order: AlpacaOrder): TradeRow {
  const notional = order.notional ?? null;
  return {
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    orderMode: inferOrderMode({ notional, qty: order.qty }),
    notional,
    qty: order.qty,
    filledQty: order.filled_qty,
    filledAvgPrice: order.filled_avg_price,
    status: order.status,
    submittedAt: order.submitted_at,
    filledAt: order.filled_at,
  };
}

export function formatOrderModeLabel(mode: OrderMode): string {
  return mode === "notional" ? "Dollar" : "Shares";
}

export function formatTradeNotional(
  notional: string | number | null | undefined,
): string {
  if (notional == null || notional === "") return "—";
  const n = typeof notional === "number" ? notional : Number(notional);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n % 1 === 0 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
}

export function formatFractionalQty(
  filledQty: string | null | undefined,
  qty: string | null | undefined,
): string {
  const raw = filledQty?.trim() || qty?.trim();
  if (!raw) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/\.?0+$/, "");
}

export function formatFillPrice(price: string | null | undefined): string {
  if (!price) return "—";
  const n = Number(price);
  if (!Number.isFinite(n)) return price;
  return `$${n.toFixed(2)}`;
}
