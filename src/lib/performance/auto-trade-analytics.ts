/**
 * Phase 14 — auto-trade performance analytics.
 */

import { readAutoTradeDecisions } from "@/lib/auto-trade/decisions";
import type { AutoTradeSkipCode } from "@/lib/auto-trade/types";
import {
  readSignalTraining,
  type SignalTrainingEntry,
} from "@/lib/training/signal-loop";
import { getStrategyVersion } from "@/lib/strategy/version";

export type SkipReasonBucket = {
  code: AutoTradeSkipCode | "unknown";
  count: number;
};

export type SymbolPerformance = {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  avgPnl: number | null;
  winRate: number | null;
};

export type ConfidenceBucket = {
  range: string;
  count: number;
  goodSignals: number;
  badSignals: number;
  accuracy: number | null;
};

export type AutoTradeAnalytics = {
  paperOnly: true;
  strategyVersion: string;
  winRate: number | null;
  avgGainLoss: number | null;
  autoTradePnL: number;
  totalDecisions: number;
  placed: number;
  skipped: number;
  bestSymbols: SymbolPerformance[];
  worstSymbols: SymbolPerformance[];
  skipReasonBreakdown: SkipReasonBucket[];
  confidenceVsResult: ConfidenceBucket[];
  timeOfDay: { hourEt: number; trades: number; avgPnl: number | null }[];
  recentTraining: SignalTrainingEntry[];
};

function hourEt(iso: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  return Number(fmt.format(new Date(iso)));
}

function symbolStats(
  decisions: Awaited<ReturnType<typeof readAutoTradeDecisions>>,
): SymbolPerformance[] {
  const bySym = new Map<string, { pnl: number[]; wins: number; losses: number }>();
  for (const d of decisions) {
    if (d.status !== "filled" && d.status !== "submitted") continue;
    const sym = d.symbol;
    const bucket = bySym.get(sym) ?? { pnl: [], wins: 0, losses: 0 };
    const pnl = d.estimatedPnL ?? 0;
    bucket.pnl.push(pnl);
    if (pnl > 0) bucket.wins += 1;
    else if (pnl < 0) bucket.losses += 1;
    bySym.set(sym, bucket);
  }
  return [...bySym.entries()].map(([symbol, s]) => {
    const trades = s.pnl.length;
    const avgPnl =
      trades > 0
        ? Number((s.pnl.reduce((a, b) => a + b, 0) / trades).toFixed(4))
        : null;
    const winRate =
      trades > 0 ? Number((s.wins / trades).toFixed(3)) : null;
    return { symbol, trades, wins: s.wins, losses: s.losses, avgPnl, winRate };
  });
}

export async function getAutoTradeAnalytics(): Promise<AutoTradeAnalytics> {
  const [decisions, training] = await Promise.all([
    readAutoTradeDecisions(200),
    readSignalTraining(30),
  ]);

  const placed = decisions.filter(
    (d) => d.status === "filled" || d.status === "submitted",
  );
  const skipped = decisions.filter((d) => d.status === "skipped");
  const pnls = placed
    .map((d) => d.estimatedPnL)
    .filter((n): n is number => n != null);
  const wins = pnls.filter((p) => p > 0).length;
  const winRate =
    pnls.length > 0 ? Number((wins / pnls.length).toFixed(3)) : null;
  const avgGainLoss =
    pnls.length > 0
      ? Number((pnls.reduce((a, b) => a + b, 0) / pnls.length).toFixed(4))
      : null;
  const autoTradePnL = Number(pnls.reduce((a, b) => a + b, 0).toFixed(4));

  const skipMap = new Map<string, number>();
  for (const d of skipped) {
    const code = d.blockers[0]?.code ?? "unknown";
    skipMap.set(code, (skipMap.get(code) ?? 0) + 1);
  }
  const skipReasonBreakdown: SkipReasonBucket[] = [...skipMap.entries()]
    .map(([code, count]) => ({
      code: code as AutoTradeSkipCode | "unknown",
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const symPerf = symbolStats(decisions);
  const bestSymbols = [...symPerf]
    .filter((s) => s.trades > 0)
    .sort((a, b) => (b.avgPnl ?? 0) - (a.avgPnl ?? 0))
    .slice(0, 5);
  const worstSymbols = [...symPerf]
    .filter((s) => s.trades > 0)
    .sort((a, b) => (a.avgPnl ?? 0) - (b.avgPnl ?? 0))
    .slice(0, 5);

  const confBuckets = new Map<string, ConfidenceBucket>();
  for (const t of training) {
    const bucket =
      t.confidence >= 0.8
        ? "80-100%"
        : t.confidence >= 0.65
          ? "65-79%"
          : "0-64%";
    const row =
      confBuckets.get(bucket) ??
      ({ range: bucket, count: 0, goodSignals: 0, badSignals: 0, accuracy: null });
    row.count += 1;
    if (t.signalGood === true) row.goodSignals += 1;
    if (t.signalGood === false) row.badSignals += 1;
    const judged = row.goodSignals + row.badSignals;
    row.accuracy = judged > 0 ? Number((row.goodSignals / judged).toFixed(3)) : null;
    confBuckets.set(bucket, row);
  }

  const todMap = new Map<number, { trades: number; pnl: number[] }>();
  for (const d of placed) {
    const h = hourEt(d.submittedAt ?? d.createdAt);
    const row = todMap.get(h) ?? { trades: 0, pnl: [] };
    row.trades += 1;
    if (d.estimatedPnL != null) row.pnl.push(d.estimatedPnL);
    todMap.set(h, row);
  }
  const timeOfDay = [...todMap.entries()]
    .map(([hourEt, v]) => ({
      hourEt,
      trades: v.trades,
      avgPnl:
        v.pnl.length > 0
          ? Number((v.pnl.reduce((a, b) => a + b, 0) / v.pnl.length).toFixed(4))
          : null,
    }))
    .sort((a, b) => a.hourEt - b.hourEt);

  return {
    paperOnly: true,
    strategyVersion: getStrategyVersion(),
    winRate,
    avgGainLoss,
    autoTradePnL,
    totalDecisions: decisions.length,
    placed: placed.length,
    skipped: skipped.length,
    bestSymbols,
    worstSymbols,
    skipReasonBreakdown,
    confidenceVsResult: [...confBuckets.values()],
    timeOfDay,
    recentTraining: training,
  };
}
