/**
 * Display helpers for monitor opportunity cards.
 * Pure / client-safe — no I/O, no order placement.
 */

import type { MonitorOpportunity } from "@/lib/monitor/types";

export type MonitorTradeStatus = "Ready" | "Blocked";

export type MonitorPrimaryBlockReason =
  | "Market closed"
  | "Stale quote"
  | "Wide spread"
  | "High risk"
  | "Execution off"
  | "Confirmation required"
  | "Not trade-ready"
  | null;

export function isOpportunityBlocked(o: MonitorOpportunity): boolean {
  if (o.marketStatus === "closed") return true;
  if (o.blockedReasons.length > 0) return true;
  return !o.readyForPaperPreview;
}

export function monitorTradeStatus(o: MonitorOpportunity): MonitorTradeStatus {
  return o.readyForPaperPreview && o.marketStatus !== "closed"
    ? "Ready"
    : "Blocked";
}

export function primaryBlockReason(
  o: MonitorOpportunity,
): MonitorPrimaryBlockReason {
  if (o.readyForPaperPreview && o.blockedReasons.length === 0) return null;

  const joined = o.blockedReasons.join(" ").toLowerCase();
  if (
    o.marketStatus === "closed" ||
    /market is closed|market closed/.test(joined)
  ) {
    return "Market closed";
  }
  if (/stale/.test(joined)) return "Stale quote";
  if (/spread/.test(joined)) return "Wide spread";
  if (/risk is high|high risk/.test(joined)) return "High risk";
  if (/execution/.test(joined)) return "Execution off";
  if (/confirm/.test(joined)) return "Confirmation required";
  if (o.blockedReasons[0]) {
    const first = o.blockedReasons[0].replace(/\.$/, "");
    if (/market/i.test(first)) return "Market closed";
    if (/stale/i.test(first)) return "Stale quote";
    if (/spread/i.test(first)) return "Wide spread";
    if (/risk/i.test(first)) return "High risk";
  }
  return "Not trade-ready";
}

export function signalSetupLabel(action: MonitorOpportunity["action"]): string {
  if (action === "BUY") return "BUY setup detected";
  if (action === "SELL") return "SELL setup detected";
  if (action === "WATCH") return "WATCH setup detected";
  return "HOLD — no strong setup";
}

export function topSignalHeadline(o: MonitorOpportunity): string {
  const blocked = isOpportunityBlocked(o);
  if (!blocked && o.readyForPaperPreview) {
    return `Top signal: ${o.symbol} — ${o.action} setup ready for paper preview`;
  }
  if (blocked) {
    return `Top signal: ${o.symbol} — ${signalSetupLabel(o.action)}, but blocked`;
  }
  return `Top signal: ${o.symbol} — ${signalSetupLabel(o.action)}`;
}
