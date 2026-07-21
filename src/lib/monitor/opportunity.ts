/**
 * Convert AI decisions into monitor opportunities.
 * Suggested actions: BUY / SELL / HOLD / WATCH.
 * Never places orders.
 */

import type { AiDecision } from "@/lib/alpaca/types";
import type {
  MonitorOpportunity,
  MonitorSuggestedAction,
} from "@/lib/monitor/types";

const OPPORTUNITY_TTL_MS = 30 * 60_000;

function newId(symbol: string): string {
  return `opp_${symbol}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function suggestMonitorAction(
  decision: AiDecision,
): MonitorSuggestedAction {
  if (decision.decisionLabel === "BUY" || decision.decisionLabel === "SELL") {
    return decision.decisionLabel;
  }
  if (decision.decisionLabel === "WATCH") return "WATCH";
  if (decision.action === "BUY" || decision.action === "SELL") {
    return decision.action;
  }

  const final = decision.scores?.finalScore ?? 0.5;
  const tech = decision.scores?.technicalScore ?? 0.5;
  const interesting =
    Math.abs(final - 0.5) >= 0.08 || tech >= 0.58 || tech <= 0.42;

  if (interesting) return "WATCH";
  return "HOLD";
}

export function shouldQueueOpportunity(
  action: MonitorSuggestedAction,
  decision: AiDecision,
): boolean {
  if (action === "BUY" || action === "SELL" || action === "WATCH") return true;
  // HOLD only if blocked for safety reasons (still useful to surface)
  const blocked = decision.tradeBlockReasons?.length ?? 0;
  return blocked > 0 && Math.abs((decision.scores?.finalScore ?? 0.5) - 0.5) >= 0.06;
}

export function decisionToOpportunity(
  decision: AiDecision,
  extras?: { ollamaUsed?: boolean; nowMs?: number },
): MonitorOpportunity | null {
  const action = suggestMonitorAction(decision);
  if (!shouldQueueOpportunity(action, decision)) return null;

  const now = extras?.nowMs ?? Date.now();
  const blocked =
    decision.tradeBlockReasons?.length
      ? decision.tradeBlockReasons
      : decision.riskWarnings?.slice(0, 4) ?? [];

  const newsSummary =
    decision.newsContext?.explanation ??
    decision.explanation?.news ??
    "No news summary.";

  const reason =
    decision.explanation?.summary ??
    decision.reasons?.[0] ??
    `${action} signal for ${decision.symbol}`;

  // Alpaca/dataQuality is source of truth. Free-text must never override an open clock.
  const dqOpen = decision.dataQuality?.isMarketOpen;
  const marketClosed = dqOpen === false;
  const marketUnavailable = dqOpen === null || dqOpen === undefined;
  const marketStatus: MonitorOpportunity["marketStatus"] =
    dqOpen === true
      ? "open"
      : dqOpen === false
        ? "closed"
        : dqOpen === null
          ? "unavailable"
          : "unknown";

  // Signal-ready is not executable while closed or clock unavailable.
  const ready =
    Boolean(decision.readyForManualPaperTrade) &&
    (action === "BUY" || action === "SELL") &&
    !marketClosed &&
    !marketUnavailable;

  const blockedReasons = [...blocked];
  if (
    marketUnavailable &&
    !blockedReasons.some((b) => /market status unavailable/i.test(b))
  ) {
    blockedReasons.unshift(
      "Market status unavailable — broker clock could not be confirmed",
    );
  } else if (
    marketClosed &&
    !blockedReasons.some((b) => /market closed/i.test(b))
  ) {
    blockedReasons.unshift("Market closed — waiting for regular session");
  }
  // Drop stale "market closed" blockers when the broker clock says open.
  const cleanedBlocked =
    dqOpen === true
      ? blockedReasons.filter(
          (b) =>
            !/market closed|market is closed|market status unavailable/i.test(b),
        )
      : blockedReasons;

  return {
    id: newId(decision.symbol),
    symbol: decision.symbol,
    action,
    score: Number((decision.scores?.finalScore ?? 0.5).toFixed(3)),
    confidence: Number((decision.confidence ?? 0).toFixed(3)),
    reason,
    marketStatus,
    newsSummary: newsSummary.slice(0, 280),
    timestamp: new Date(now).toISOString(),
    expiresAt: new Date(now + OPPORTUNITY_TTL_MS).toISOString(),
    paperOnly: true,
    technicalScore: Number((decision.scores?.technicalScore ?? 0.5).toFixed(3)),
    newsScore: Number((decision.scores?.newsScore ?? 0.5).toFixed(3)),
    marketScore: Number((decision.scores?.marketScore ?? 0.5).toFixed(3)),
    riskScore: Number((decision.scores?.riskScore ?? 0.5).toFixed(3)),
    blockedReasons: cleanedBlocked.slice(0, 6),
    readyForPaperPreview: ready,
    ollamaUsed: Boolean(extras?.ollamaUsed),
  };
}

export function decisionsToOpportunities(
  decisions: AiDecision[],
  extras?: { ollamaUsed?: boolean; nowMs?: number },
): MonitorOpportunity[] {
  const out: MonitorOpportunity[] = [];
  for (const d of decisions) {
    const opp = decisionToOpportunity(d, extras);
    if (opp) out.push(opp);
  }
  return out;
}
