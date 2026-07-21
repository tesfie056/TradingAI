/**
 * Display helpers for monitor opportunity cards.
 * Pure / client-safe — no I/O, no order placement.
 */

import type { MonitorOpportunity } from "@/lib/monitor/types";

/** Fine-grained trade readiness for UI (not the same as strategy signal). */
export type MonitorTradeStatus =
  | "Signal ready"
  | "Waiting for market"
  | "Trade eligible"
  | "Not trade-ready"
  | "Expired";

export type MonitorPrimaryBlockReason =
  | "Market closed"
  | "Market status unavailable"
  | "Opening delay"
  | "Entry window closed"
  | "Stale quote"
  | "Wide spread"
  | "High risk"
  | "Execution off"
  | "Engine paused"
  | "Confirmation required"
  | "Not trade-ready"
  | "Proposal expired"
  | null;

export type OpportunityDisplayContext = {
  enginePaused?: boolean;
  marketOpen?: boolean | null;
  nowMs?: number;
};

function sessionClosed(
  o: MonitorOpportunity,
  ctx?: OpportunityDisplayContext,
): boolean {
  if (ctx?.marketOpen === true || o.marketStatus === "open") return false;
  if (ctx?.marketOpen === false || o.marketStatus === "closed") return true;
  return false;
}

function sessionUnavailable(
  o: MonitorOpportunity,
  ctx?: OpportunityDisplayContext,
): boolean {
  if (ctx?.marketOpen === true || o.marketStatus === "open") return false;
  if (o.marketStatus === "unavailable") return true;
  if (ctx?.marketOpen === null && o.marketStatus !== "closed") return true;
  return false;
}

export function isOpportunityExpired(
  o: MonitorOpportunity,
  nowMs = Date.now(),
): boolean {
  const t = Date.parse(o.expiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

export function isOpportunityBlocked(
  o: MonitorOpportunity,
  ctx?: OpportunityDisplayContext,
): boolean {
  if (ctx?.enginePaused) return true;
  if (isOpportunityExpired(o, ctx?.nowMs)) return true;
  if (sessionClosed(o, ctx) || sessionUnavailable(o, ctx)) return true;
  if (o.blockedReasons.length > 0) return true;
  return !o.readyForPaperPreview;
}

/**
 * Trade status for Advanced Monitoring.
 * Never show "Ready" / trade-eligible when the market is closed or the engine is paused.
 */
export function monitorTradeStatus(
  o: MonitorOpportunity,
  ctx?: OpportunityDisplayContext,
): MonitorTradeStatus {
  if (isOpportunityExpired(o, ctx?.nowMs)) return "Expired";
  if (sessionClosed(o, ctx) || sessionUnavailable(o, ctx)) {
    return "Waiting for market";
  }
  if (ctx?.enginePaused) return "Not trade-ready";
  if (o.readyForPaperPreview && o.blockedReasons.length === 0) {
    return "Trade eligible";
  }
  if (o.action === "BUY" || o.action === "SELL") return "Signal ready";
  return "Not trade-ready";
}

export function primaryBlockReason(
  o: MonitorOpportunity,
  ctx?: OpportunityDisplayContext,
): MonitorPrimaryBlockReason {
  if (isOpportunityExpired(o, ctx?.nowMs)) return "Proposal expired";
  if (ctx?.enginePaused) return "Engine paused";

  const joined = o.blockedReasons.join(" ").toLowerCase();

  if (sessionUnavailable(o, ctx) || /market status unavailable/.test(joined)) {
    return "Market status unavailable";
  }
  if (sessionClosed(o, ctx)) {
    return "Market closed";
  }
  if (/opening delay/.test(joined)) {
    return "Opening delay";
  }
  if (/entry window|last.?45|closing window|too close to (the )?close/.test(joined)) {
    return "Entry window closed";
  }

  if (o.readyForPaperPreview && o.blockedReasons.length === 0) return null;

  if (/stale/.test(joined)) return "Stale quote";
  if (/spread/.test(joined)) return "Wide spread";
  if (/risk is high|high risk/.test(joined)) return "High risk";
  if (/execution/.test(joined)) return "Execution off";
  if (/confirm/.test(joined)) return "Confirmation required";
  if (o.blockedReasons[0]) {
    const first = o.blockedReasons[0].replace(/\.$/, "");
    if (/status unavailable/i.test(first)) return "Market status unavailable";
    if (/opening delay/i.test(first)) return "Opening delay";
    if (/entry window|closing window/i.test(first)) return "Entry window closed";
    if (/market closed/i.test(first)) return "Market closed";
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

export function topSignalHeadline(
  o: MonitorOpportunity,
  ctx?: OpportunityDisplayContext,
): string {
  const status = monitorTradeStatus(o, ctx);
  const block = primaryBlockReason(o, ctx);
  if (block === "Market status unavailable") {
    return `${o.symbol} ${o.action} setup found — market status unavailable`;
  }
  if (status === "Waiting for market") {
    return `${o.symbol} ${o.action} setup found — waiting for market open`;
  }
  if (status === "Expired") {
    return `${o.symbol} setup expired — fresh scan required`;
  }
  if (status === "Trade eligible" && !ctx?.enginePaused) {
    return `Top signal: ${o.symbol} — ${o.action} setup eligible for Auto Trading`;
  }
  if (status === "Signal ready") {
    return `Top signal: ${o.symbol} — ${signalSetupLabel(o.action)}`;
  }
  if (ctx?.enginePaused) {
    return `Top signal: ${o.symbol} — ${signalSetupLabel(o.action)} (engine paused)`;
  }
  return `Top signal: ${o.symbol} — ${signalSetupLabel(o.action)}, not trade-ready`;
}

export function opportunityDetailLine(
  o: MonitorOpportunity,
  ctx?: OpportunityDisplayContext,
): string {
  const status = monitorTradeStatus(o, ctx);
  const block = primaryBlockReason(o, ctx);
  if (block === "Market status unavailable") {
    return "Broker clock could not be confirmed. New paper orders stay blocked until market status is available.";
  }
  if (block === "Opening delay") {
    return "Market is open, but the opening-delay window is still active. This is not a closed market.";
  }
  if (block === "Entry window closed") {
    return "Market is open, but new entries are outside the allowed entry window.";
  }
  if (status === "Waiting for market") {
    return "Waiting for market open before paper-order submission. Auto Trading will revalidate after the open.";
  }
  if (ctx?.enginePaused) {
    return "New entries are paused. Resume Engine from Auto Trading before paper orders can be submitted.";
  }
  if (status === "Trade eligible") {
    return "Eligible for Auto Trading when Paper Execution is on and all risk checks pass. Advanced Monitoring does not submit orders itself.";
  }
  if (status === "Expired") {
    return "This proposal expired. Run a fresh scan — stale signals are not submitted.";
  }
  if (block) return `Not submitted yet: ${block}.`;
  return o.reason;
}
