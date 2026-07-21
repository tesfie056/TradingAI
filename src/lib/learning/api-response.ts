/**
 * Learning API responses — locked paper-only safety fields.
 * Always place locks AFTER any spreads so clients/registry/baseline cannot override.
 */

import { monitorSafetyFlags } from "@/lib/monitor/safety";

type AnyRecord = Record<string, unknown>;

const STRIP_KEYS = ["paperOnly", "liveTradingAllowed", "ok"] as const;

function withoutLockedKeys(obj: AnyRecord): AnyRecord {
  const out: AnyRecord = { ...obj };
  for (const key of STRIP_KEYS) {
    delete out[key];
  }
  return out;
}

/**
 * Build a JSON-safe learning API body with locked safety invariants.
 * Strips duplicate ok/paperOnly/liveTradingAllowed from payload and flags,
 * then sets them once at the end.
 */
export function learningApiJson<T extends AnyRecord>(
  payload: T,
): T & {
  ok: true;
  paperOnly: true;
  liveTradingAllowed: false;
} {
  const safePayload = withoutLockedKeys(payload as AnyRecord);
  const safeFlags = withoutLockedKeys(
    monitorSafetyFlags() as unknown as AnyRecord,
  );

  return {
    ...(safePayload as T),
    ...safeFlags,
    ok: true,
    paperOnly: true,
    liveTradingAllowed: false,
  };
}

/** Force nested baseline/report objects to keep locked safety fields. */
export function lockNestedSafety<
  T extends { paperOnly?: unknown; liveTradingAllowed?: unknown },
>(obj: T): T & { paperOnly: true; liveTradingAllowed: false } {
  return {
    ...obj,
    paperOnly: true,
    liveTradingAllowed: false,
  };
}
