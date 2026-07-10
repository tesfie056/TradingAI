/**
 * Client-side watchlist filter / sort helpers.
 */

import type { AiDecision } from "@/lib/alpaca/types";
import { canShowPreparePaperTrade } from "@/lib/trades/gates";
import { uniqueBlockLabels } from "@/lib/client/block-reasons";

export type DecisionFilter = "ALL" | "BUY" | "SELL" | "HOLD";
export type RiskFilter = "ALL" | "low" | "medium" | "high";
export type SentimentFilter = "ALL" | "positive" | "negative" | "neutral";
export type TradableFilter = "ALL" | "tradable" | "blocked";

export type WatchlistSortKey =
  | "symbol"
  | "confidence"
  | "finalScore"
  | "decision"
  | "risk";

export type WatchlistFilters = {
  decision: DecisionFilter;
  risk: RiskFilter;
  sentiment: SentimentFilter;
  tradable: TradableFilter;
  sortKey: WatchlistSortKey;
  sortDir: "asc" | "desc";
  query: string;
};

export const DEFAULT_WATCHLIST_FILTERS: WatchlistFilters = {
  decision: "ALL",
  risk: "ALL",
  sentiment: "ALL",
  tradable: "ALL",
  sortKey: "symbol",
  sortDir: "asc",
  query: "",
};

export type WatchlistViewRow = {
  symbol: string;
  last: number | null;
  mid: number | null;
  decision: AiDecision | null;
  blockReasons: string[];
  tradable: boolean;
};

function riskRank(d: AiDecision | null): number {
  const r = d?.riskLevel ?? d?.riskStatus ?? "unknown";
  if (r === "high") return 3;
  if (r === "medium" || r === "elevated") return 2;
  if (r === "low") return 1;
  return 0;
}

function decisionRank(action: string | undefined): number {
  if (action === "BUY") return 3;
  if (action === "SELL") return 2;
  if (action === "HOLD") return 1;
  return 0;
}

export function filterAndSortWatchlist(
  rows: WatchlistViewRow[],
  filters: WatchlistFilters,
): WatchlistViewRow[] {
  const q = filters.query.trim().toUpperCase();
  let out = rows.filter((row) => {
    if (q && !row.symbol.includes(q)) return false;
    const d = row.decision;
    if (filters.decision !== "ALL" && d?.action !== filters.decision) {
      return false;
    }
    if (filters.risk !== "ALL") {
      const risk = (d?.riskLevel ?? d?.riskStatus ?? "").toLowerCase();
      const normalized = risk === "elevated" ? "medium" : risk;
      if (normalized !== filters.risk) return false;
    }
    if (filters.sentiment !== "ALL") {
      const s = d?.newsContext?.overallSentiment ?? "neutral";
      if (s !== filters.sentiment) return false;
    }
    if (filters.tradable === "tradable" && !row.tradable) return false;
    if (filters.tradable === "blocked" && row.tradable) return false;
    return true;
  });

  const dir = filters.sortDir === "asc" ? 1 : -1;
  out = [...out].sort((a, b) => {
    const da = a.decision;
    const db = b.decision;
    switch (filters.sortKey) {
      case "confidence":
        return ((da?.confidence ?? 0) - (db?.confidence ?? 0)) * dir;
      case "finalScore":
        return (
          ((da?.scores?.finalScore ?? 0) - (db?.scores?.finalScore ?? 0)) * dir
        );
      case "decision":
        return (decisionRank(da?.action) - decisionRank(db?.action)) * dir;
      case "risk":
        return (riskRank(da) - riskRank(db)) * dir;
      case "symbol":
      default:
        return a.symbol.localeCompare(b.symbol) * dir;
    }
  });

  return out;
}

export function rowIsTradable(
  d: AiDecision | null,
  orderExecutionEnabled: boolean,
): boolean {
  if (!d) return false;
  if (!canShowPreparePaperTrade(d)) return false;
  // Tradable for preview even if execution off — submit still blocked.
  void orderExecutionEnabled;
  return true;
}

export function collectRowBlockReasons(
  d: AiDecision | null,
  orderExecutionEnabled: boolean,
): string[] {
  const raw: string[] = [];
  if (!orderExecutionEnabled) raw.push("Order execution off");
  if (d?.tradeBlockReasons?.length) raw.push(...d.tradeBlockReasons);
  if (d?.dataQuality && !d.dataQuality.isMarketOpen) raw.push("Market closed");
  if (d?.dataQuality?.isQuoteStale) raw.push("Stale quote");
  if (
    d?.dataQuality?.spreadPercent != null &&
    d.dataQuality.spreadPercent >= 0.01
  ) {
    raw.push("Wide spread");
  }
  if (d?.riskStatus === "high" || d?.riskLevel === "high") {
    raw.push("High risk");
  }
  if (d?.action === "HOLD") raw.push("HOLD — not tradeable");
  return uniqueBlockLabels(raw);
}
