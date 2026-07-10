import type { AiDecision } from "@/lib/alpaca/types";
import type { DecisionPerformanceEntry } from "@/lib/performance/types";
import {
  overallFromHorizons,
  pendingHorizon,
} from "@/lib/performance/score";

function makeId(symbol: string, timestamp: string): string {
  return `${symbol}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Convert a live AI decision into a performance history row (no secrets).
 */
export function decisionToPerformanceEntry(
  decision: AiDecision,
  extras?: { aiProvider?: "heuristic" | "ollama" | "unknown" },
): DecisionPerformanceEntry {
  const priceAtDecision =
    decision.metrics?.last ?? decision.metrics?.mid ?? null;

  const inferredProvider: "heuristic" | "ollama" | "unknown" =
    extras?.aiProvider ??
    (decision.newsContext?.explanation?.toLowerCase().includes("ollama")
      ? "ollama"
      : decision.reasons.some((r) => /heuristic/i.test(r))
        ? "heuristic"
        : "unknown");

  return {
    id: makeId(decision.symbol, decision.timestamp),
    symbol: decision.symbol,
    action: decision.action,
    confidence: decision.confidence,
    priceAtDecision,
    marketOpen: decision.dataQuality?.isMarketOpen ?? false,
    newsSentiment: decision.newsContext?.overallSentiment ?? null,
    aiProvider: inferredProvider,
    reasons: decision.reasons.slice(0, 8),
    riskWarnings: decision.riskWarnings.slice(0, 6),
    timestamp: decision.timestamp,
    paperOnly: true,
    orderExecuted: false,
    outcomes: {
      m15: pendingHorizon("m15"),
      h1: pendingHorizon("h1"),
      nextClose: pendingHorizon("nextClose"),
    },
    overallLabel: "pending",
  };
}

export function refreshOverall(
  entry: DecisionPerformanceEntry,
): DecisionPerformanceEntry {
  return {
    ...entry,
    overallLabel: overallFromHorizons(entry.outcomes),
  };
}
