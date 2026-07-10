/**
 * Opportunity scanner — one full watchlist pass.
 * Pulls clock, quotes/bars, news; scores via existing decision engine.
 * Uses Ollama when available for news analysis; falls back safely.
 * Detection only — never submits orders.
 */

import { generateWatchlistDecisions } from "@/lib/ai/decision";
import { getLatestQuotes, getMarketClock } from "@/lib/alpaca/client";
import { getWatchlist } from "@/lib/config";
import { analyzeWatchlistNews } from "@/lib/news/analyze";
import { fetchWatchlistNews } from "@/lib/news";
import {
  fetchMarketCondition,
  fetchMultiTimeframeBars,
} from "@/lib/stocks/fetch-context";
import { appendMonitorLog, pruneMonitorLogs } from "@/lib/monitor/logs";
import { buildScanNotifications } from "@/lib/monitor/notifications";
import { decisionsToOpportunities } from "@/lib/monitor/opportunity";
import {
  appendOpportunities,
  expireStaleOpportunities,
  pickTopOpportunity,
  pruneOpportunities,
  readActiveOpportunities,
} from "@/lib/monitor/queue";
import {
  canStartMonitorScan,
  markMonitorScanStarted,
} from "@/lib/monitor/rate-limit";
import { assertMonitorCannotTrade } from "@/lib/monitor/safety";
import type {
  MonitorNotification,
  MonitorOpportunity,
} from "@/lib/monitor/types";

export type MonitorScanResult = {
  paperOnly: true;
  canPlaceOrders: false;
  scannedAt: string;
  symbols: string[];
  stocksScanned: number;
  opportunities: MonitorOpportunity[];
  opportunitiesFound: number;
  topOpportunity: MonitorOpportunity | null;
  notifications: MonitorNotification[];
  marketOpen: boolean;
  ollamaUsed: boolean;
  ollamaFallback: boolean;
  aiProvider: string;
  rateLimited?: boolean;
  error?: string;
};

export async function runMonitorScan(options?: {
  force?: boolean;
}): Promise<MonitorScanResult> {
  assertMonitorCannotTrade();

  const rate = canStartMonitorScan();
  if (!options?.force && !rate.ok) {
    await appendMonitorLog({
      event: "rate_limited",
      level: "warn",
      message: `Scan rate-limited; retry in ${Math.ceil(rate.retryAfterMs / 1000)}s`,
      meta: { retryAfterMs: rate.retryAfterMs },
    });
    const active = await readActiveOpportunities();
    return {
      paperOnly: true,
      canPlaceOrders: false,
      scannedAt: new Date().toISOString(),
      symbols: getWatchlist(),
      stocksScanned: 0,
      opportunities: active,
      opportunitiesFound: 0,
      topOpportunity: pickTopOpportunity(active),
      notifications: [],
      marketOpen: false,
      ollamaUsed: false,
      ollamaFallback: false,
      aiProvider: "skipped",
      rateLimited: true,
      error: `Rate limited — wait ${Math.ceil(rate.retryAfterMs / 1000)}s`,
    };
  }

  markMonitorScanStarted();
  await appendMonitorLog({
    event: "scan_started",
    message: "Monitor scan started (paper-only, no order placement)",
  });

  try {
    const symbols = getWatchlist();
    const [clock, quotes, multiBars, marketCondition, newsResult] =
      await Promise.all([
        getMarketClock().catch((err) => {
          throw new Error(
            `Alpaca clock failed: ${err instanceof Error ? err.message : "unknown"}`,
          );
        }),
        getLatestQuotes(symbols).catch(() => []),
        fetchMultiTimeframeBars(symbols).catch(() => ({
          bars1Min: {} as Record<string, never>,
          bars5Min: {} as Record<string, never>,
          bars15Min: {} as Record<string, never>,
        })),
        fetchMarketCondition().catch(() => undefined),
        fetchWatchlistNews(symbols).catch(() => ({
          provider: "none",
          items: [],
          status: {
            requestedProvider: "none" as const,
            activeProvider: "none",
            usedFallback: true,
            fallbackReason: "News fetch failed",
            ok: false,
          },
        })),
      ]);

    const { bySymbol: newsBySymbol, aiStatus } = await analyzeWatchlistNews(
      symbols,
      [...(newsResult.items ?? [])],
    );

    const ollamaUsed = aiStatus.activeProvider === "ollama";
    const ollamaFallback =
      aiStatus.requestedProvider === "ollama" &&
      aiStatus.activeProvider !== "ollama";

    if (ollamaFallback) {
      await appendMonitorLog({
        event: "ollama_fallback",
        level: "warn",
        message: "Ollama unavailable — using heuristic news analysis",
        meta: {
          requested: aiStatus.requestedProvider,
          active: aiStatus.activeProvider,
        },
      });
    }

    const decisions = generateWatchlistDecisions({
      symbols,
      quotes: Array.isArray(quotes) ? quotes : [],
      barsBySymbol: multiBars.bars5Min ?? {},
      bars1MinBySymbol: multiBars.bars1Min,
      bars5MinBySymbol: multiBars.bars5Min,
      bars15MinBySymbol: multiBars.bars15Min,
      timeframe: "5Min",
      isMarketOpen: Boolean(clock?.isOpen),
      newsBySymbol,
      marketCondition,
    });

    const opportunities = decisionsToOpportunities(decisions, {
      ollamaUsed,
    });

    await appendOpportunities(opportunities);
    await expireStaleOpportunities();
    await pruneOpportunities();
    await pruneMonitorLogs();

    const notifications = buildScanNotifications(opportunities);
    const active = await readActiveOpportunities();

    await appendMonitorLog({
      event: "scan_completed",
      message: `Scan completed: ${symbols.length} stocks, ${opportunities.length} opportunities`,
      meta: {
        stocksScanned: symbols.length,
        opportunitiesFound: opportunities.length,
        marketOpen: Boolean(clock?.isOpen),
        ollamaUsed,
      },
    });

    return {
      paperOnly: true,
      canPlaceOrders: false,
      scannedAt: new Date().toISOString(),
      symbols,
      stocksScanned: symbols.length,
      opportunities,
      opportunitiesFound: opportunities.length,
      topOpportunity: pickTopOpportunity(active),
      notifications,
      marketOpen: Boolean(clock?.isOpen),
      ollamaUsed,
      ollamaFallback,
      aiProvider: aiStatus.activeProvider,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Monitor scan failed";
    await appendMonitorLog({
      event: "scan_error",
      level: "error",
      message,
    });
    return {
      paperOnly: true,
      canPlaceOrders: false,
      scannedAt: new Date().toISOString(),
      symbols: getWatchlist(),
      stocksScanned: 0,
      opportunities: [],
      opportunitiesFound: 0,
      topOpportunity: null,
      notifications: [],
      marketOpen: false,
      ollamaUsed: false,
      ollamaFallback: false,
      aiProvider: "error",
      error: message,
    };
  }
}
