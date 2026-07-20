/**
 * Stable Alpaca client_order_id helpers for Version 1 ownership / idempotency.
 * Alpaca limit: 48 characters.
 */

import { getV1LifecycleConfig } from "@/lib/trading/v1-lifecycle/config";

const MAX_LEN = 48;

export function newTradeId(nowMs = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `v1t_${nowMs.toString(36)}_${rand}`;
}

/**
 * Build a stable client order id tied to tradeId + leg.
 * Retries must reuse the same id to avoid duplicate entries.
 */
export function buildClientOrderId(
  tradeId: string,
  leg: "entry" | "exit" | "exit2" = "entry",
): string {
  const prefix = getV1LifecycleConfig().clientOrderIdPrefix;
  const raw = `${prefix}_${tradeId}_${leg}`.replace(/[^a-zA-Z0-9_-]/g, "");
  if (raw.length <= MAX_LEN) return raw;
  // Prefer keeping tradeId uniqueness; truncate middle.
  return raw.slice(0, MAX_LEN);
}

export function isV1ClientOrderId(clientOrderId: string | null | undefined): boolean {
  if (!clientOrderId) return false;
  const prefix = getV1LifecycleConfig().clientOrderIdPrefix;
  return clientOrderId.startsWith(`${prefix}_`) || clientOrderId.startsWith("v1t_");
}

export function tradeIdFromClientOrderId(
  clientOrderId: string | null | undefined,
): string | null {
  if (!clientOrderId) return null;
  // v1_{tradeId}_entry  or  v1_v1t_xxx_entry
  const m = clientOrderId.match(/^v1_(v1t_[a-z0-9]+(?:_[a-z0-9]+)?)_/i);
  if (m) return m[1];
  if (clientOrderId.startsWith("v1t_")) {
    const parts = clientOrderId.split("_");
    // v1t_time_rand[_leg]
    if (parts.length >= 3) return parts.slice(0, 3).join("_");
  }
  return null;
}
