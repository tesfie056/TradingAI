/**
 * Baseline report for Paper Intelligence v1 (champion).
 */

import { getLearningDatasetSummary, readTradeReviews } from "@/lib/learning/dataset";
import { regimeLabel, type MarketRegime } from "@/lib/learning/regime";
import { getAutoTradeAnalytics } from "@/lib/performance/auto-trade-analytics";
import { getChampionStrategy } from "@/lib/strategy/registry";
import { readLatestSessionReport } from "@/lib/trading/session-report";

export type BaselineReport = {
  paperOnly: true;
  liveTradingAllowed: false;
  champion: {
    strategyId: string;
    name: string;
    version: string;
    status: string;
    activeSince: string;
  };
  dataset: {
    eventCount: number;
    snapshotCount: number;
    reviewCount: number;
  };
  performance: {
    totalPaperTrades: number;
    winRate: number | null;
    profitFactor: number | null;
    expectancy: number | null;
    maxDrawdownHint: number | null;
    avgWinner: number | null;
    avgLoser: number | null;
    autoTradePnL: number;
  };
  regimes: { regime: string; label: string; count: number }[];
  reviews: {
    good_profitable: number;
    good_losing: number;
    bad_profitable: number;
    bad_losing: number;
    insufficient_data: number;
  };
  session: {
    date: string | null;
    trades: number | null;
    note: string;
  };
  generatedAt: string;
};

export async function buildBaselineReport(): Promise<BaselineReport> {
  const [champion, summary, analytics, reviews, session] = await Promise.all([
    getChampionStrategy(),
    getLearningDatasetSummary(),
    getAutoTradeAnalytics(),
    readTradeReviews(2000),
    readLatestSessionReport().catch(() => null),
  ]);

  const reviewBuckets = {
    good_profitable: 0,
    good_losing: 0,
    bad_profitable: 0,
    bad_losing: 0,
    insufficient_data: 0,
  };
  for (const r of reviews) {
    reviewBuckets[r.classification] += 1;
  }

  const regimeRows = Object.entries(summary.regimes).map(([regime, count]) => ({
    regime,
    label: regimeLabel(regime as MarketRegime),
    count,
  }));

  // Approximate expectancy from analytics avgGainLoss when available
  const expectancy = analytics.avgGainLoss;
  const totalTrades = Math.max(
    analytics.placed,
    session?.tradesToday ?? 0,
  );

  return {
    paperOnly: true,
    liveTradingAllowed: false,
    champion: {
      strategyId: champion.strategyId,
      name: champion.name,
      version: champion.version,
      status: champion.status,
      activeSince: champion.createdAt,
    },
    dataset: {
      eventCount: summary.eventCount,
      snapshotCount: summary.snapshotCount,
      reviewCount: summary.reviewCount,
    },
    performance: {
      totalPaperTrades: totalTrades,
      winRate: session?.winRate ?? analytics.winRate,
      profitFactor: session?.profitFactor ?? null,
      expectancy,
      maxDrawdownHint: session?.maximumDrawdownPct ?? null,
      avgWinner: session?.averageWinner ?? null,
      avgLoser: session?.averageLoser ?? null,
      autoTradePnL: analytics.autoTradePnL,
    },
    regimes: regimeRows.sort((a, b) => b.count - a.count),
    reviews: reviewBuckets,
    session: {
      date: session?.sessionDate ?? null,
      trades: session?.tradesToday ?? null,
      note: "Baseline from learning dataset + auto-trade analytics. Champion scoring unchanged.",
    },
    generatedAt: new Date().toISOString(),
  };
}
