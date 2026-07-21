/**
 * Compact last-scan tally for Advanced Monitoring (truthful fields only).
 */

import type { LastScanSnapshot } from "@/lib/monitor/scan-snapshot";

export type MonitorScanSummary = {
  stocksReceived: number;
  stocksEvaluated: number;
  missingData: number;
  rejectedBySignal: number;
  rejectedBySpread: number;
  rejectedBySafety: number;
  alreadyHeld: number;
  eligible: number;
  ordersSubmitted: number;
  completedAt: string;
};

function reasonMatches(reason: string | null | undefined, ...parts: string[]): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return parts.some((p) => r.includes(p));
}

export function summarizeLastScan(
  snapshot: LastScanSnapshot | null | undefined,
): MonitorScanSummary | null {
  if (!snapshot) return null;
  const stocksScanned = snapshot.stocksScanned ?? 0;
  if (!snapshot.ranked?.length && !(stocksScanned > 0)) {
    return null;
  }
  const ranked = snapshot.ranked ?? [];
  let missingData = 0;
  let rejectedBySpread = 0;
  let rejectedBySafety = 0;
  let alreadyHeld = 0;
  let rejectedBySignal = 0;
  let eligible = 0;
  let ordersSubmitted = 0;

  for (const row of ranked) {
    if (row.orderSubmitted) ordersSubmitted += 1;
    if (row.autoEligible) {
      eligible += 1;
      continue;
    }
    const reason = row.skippedReason ?? "";
    if (reasonMatches(reason, "quote", "stale", "data", "bar", "unavailable")) {
      missingData += 1;
    } else if (reasonMatches(reason, "spread")) {
      rejectedBySpread += 1;
    } else if (
      reasonMatches(reason, "safety", "risk", "daily", "kill", "panic", "reconcile")
    ) {
      rejectedBySafety += 1;
    } else if (
      reasonMatches(reason, "already", "open position", "held", "position")
    ) {
      alreadyHeld += 1;
    } else {
      rejectedBySignal += 1;
    }
  }

  return {
    stocksReceived: stocksScanned || ranked.length,
    stocksEvaluated: ranked.length,
    missingData,
    rejectedBySignal,
    rejectedBySpread,
    rejectedBySafety,
    alreadyHeld,
    eligible,
    ordersSubmitted,
    completedAt: snapshot.scannedAt,
  };
}
