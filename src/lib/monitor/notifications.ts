/**
 * Build dashboard notifications from a scan result.
 */

import type { MonitorNotification, MonitorOpportunity } from "@/lib/monitor/types";

function newId(): string {
  return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function buildScanNotifications(
  opportunities: MonitorOpportunity[],
): MonitorNotification[] {
  const notes: MonitorNotification[] = [];
  const now = new Date().toISOString();

  for (const o of opportunities.slice(0, 8)) {
    if (o.readyForPaperPreview && (o.action === "BUY" || o.action === "SELL")) {
      notes.push({
        id: newId(),
        kind: "ready_for_preview",
        title: "Opportunity ready for paper preview",
        detail: `${o.action} ${o.symbol} · score ${o.score.toFixed(2)} · confirm manually — no auto trade`,
        symbol: o.symbol,
        timestamp: now,
        paperOnly: true,
      });
      continue;
    }

    const closed = o.blockedReasons.some((r) =>
      /market is closed/i.test(r),
    );
    const stale = o.blockedReasons.some((r) => /stale/i.test(r));

    if (closed) {
      notes.push({
        id: newId(),
        kind: "blocked_market_closed",
        title: "Opportunity blocked: market closed",
        detail: `${o.symbol} — ${o.action} setup detected, but blocked (Market closed). Monitoring continues; trading waits until market opens.`,
        symbol: o.symbol,
        timestamp: now,
        paperOnly: true,
      });
    } else if (stale) {
      notes.push({
        id: newId(),
        kind: "blocked_stale_quote",
        title: "Opportunity blocked: stale quote",
        detail: `${o.symbol} — ${o.action} setup detected, but blocked (Stale quote).`,
        symbol: o.symbol,
        timestamp: now,
        paperOnly: true,
      });
    } else if (!o.readyForPaperPreview) {
      notes.push({
        id: newId(),
        kind: "new_opportunity",
        title: "New setup detected (not trade-ready)",
        detail: `${o.symbol} — ${o.action} setup · score ${o.score.toFixed(2)} · blocked until checks pass`,
        symbol: o.symbol,
        timestamp: now,
        paperOnly: true,
      });
    } else {
      notes.push({
        id: newId(),
        kind: "new_opportunity",
        title: "New opportunity detected",
        detail: `${o.action} ${o.symbol} · score ${o.score.toFixed(2)} · ${o.reason.slice(0, 120)}`,
        symbol: o.symbol,
        timestamp: now,
        paperOnly: true,
      });
    }
  }

  // Dedupe by kind+symbol keeping first
  const seen = new Set<string>();
  return notes.filter((n) => {
    const key = `${n.kind}:${n.symbol ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
