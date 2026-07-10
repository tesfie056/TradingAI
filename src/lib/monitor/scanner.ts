/**
 * Opportunity scanner — one full watchlist pass.
 * Pulls clock, quotes/bars, news; scores via existing decision engine.
 * When AUTO_PAPER_TRADING_ENABLED=true, delegates to auto-trade module (paper only).
 */

import { generateWatchlistDecisions } from "@/lib/ai/decision";
import { getMarketClock } from "@/lib/alpaca/client";
import { getCachedLatestQuotes } from "@/lib/cache/quote-cache";
import { getCachedWatchlistNews } from "@/lib/cache/news-cache";
import { getWatchlist } from "@/lib/config";
import { resolveEligibleUniverse } from "@/lib/universe/service";
import { analyzeWatchlistNews } from "@/lib/news/analyze";
import {
  fetchMarketCondition,
  fetchMultiTimeframeBars,
} from "@/lib/stocks/fetch-context";
import { processAutoTradesForScan } from "@/lib/auto-trade/service";
import { appendAutoTradeLog } from "@/lib/auto-trade/logs";
import { updateSignalOutcomes } from "@/lib/training/signal-loop";
import { appendMonitorLog, pruneMonitorLogs } from "@/lib/monitor/logs";
import { buildScanNotifications } from "@/lib/monitor/notifications";
import { decisionsToOpportunities } from "@/lib/monitor/opportunity";
import {
  buildLastScanSnapshot,
  formatTopSignalLabel,
  saveLastScanSnapshot,
  type LastScanSnapshot,
} from "@/lib/monitor/scan-snapshot";
import { persistRankedCandidates } from "@/lib/trading/build-candidates";
import { pruneDecisionLog } from "@/lib/trading/decision-log";
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
import { assertMonitorPaperOnly } from "@/lib/monitor/safety";
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
  /** Watchlist symbols that passed universe hard filters. */
  universeEligible?: number;
  universeRejected?: number;
  opportunities: MonitorOpportunity[];
  opportunitiesFound: number;
  topOpportunity: MonitorOpportunity | null;
  topSignalLabel: string;
  lastScan: LastScanSnapshot | null;
  notifications: MonitorNotification[];
  marketOpen: boolean;
  ollamaUsed: boolean;
  ollamaFallback: boolean;
  aiProvider: string;
  rateLimited?: boolean;
  error?: string;
  autoTrade?: {
    processed: number;
    submitted: number;
    skipped: number;
  };
};

export async function runMonitorScan(options?: {
  force?: boolean;
}): Promise<MonitorScanResult> {
  assertMonitorPaperOnly();

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
      topSignalLabel: "Scan rate-limited — using prior opportunities",
      lastScan: null,
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
    const { getAutoTradeRuntime } = await import("@/lib/auto-trade/runtime");
    const runtime = await getAutoTradeRuntime();
    if (runtime.killSwitch || runtime.panicStop || runtime.runtimeDisabled) {
      await appendMonitorLog({
        event: "scan_completed",
        message:
          "Scan skipped — engine paused or emergency stopped (no new proposals)",
      });
      return {
        paperOnly: true,
        canPlaceOrders: false,
        scannedAt: new Date().toISOString(),
        stocksScanned: 0,
        symbols: [],
        opportunities: await readActiveOpportunities(),
        opportunitiesFound: 0,
        topOpportunity: null,
        topSignalLabel: "Engine paused — scanning suspended",
        lastScan: null,
        notifications: [],
        marketOpen: false,
        ollamaUsed: false,
        ollamaFallback: false,
        aiProvider: "skipped",
        error: "Engine paused — no new scans or proposals",
      };
    }

    const watchlist = getWatchlist();
    const universe = await resolveEligibleUniverse({ symbols: watchlist });
    if (universe.warnings.length > 0) {
      const { logUniverseWarnings } = await import("@/lib/universe/service");
      logUniverseWarnings(universe.warnings);
      for (const w of universe.warnings) {
        await appendMonitorLog({
          event: "scan_started",
          message: `Universe warning: ${w}`,
          meta: { universeWarning: true },
        }).catch(() => undefined);
      }
    }

    // Never fall back to the raw watchlist when filters reject everything.
    const symbols = universe.eligibleSymbols;
    if (symbols.length === 0) {
      await appendMonitorLog({
        event: "scan_completed",
        message:
          "Scan aborted — zero symbols passed universe filters (no silent fallback)",
        meta: {
          watchlistSize: universe.breakdown.watchlistSize,
          rejected: universe.rejected.length,
        },
      });
      return {
        paperOnly: true,
        canPlaceOrders: false,
        scannedAt: new Date().toISOString(),
        stocksScanned: 0,
        symbols: [],
        universeEligible: 0,
        universeRejected: universe.rejected.length,
        opportunities: [],
        opportunitiesFound: 0,
        topOpportunity: null,
        topSignalLabel: "No eligible universe — check price/liquidity filters",
        lastScan: null,
        notifications: universe.warnings.map((w, i) => ({
          id: `univ_${Date.now()}_${i}`,
          kind: "blocked_stale_quote" as const,
          title: "Universe filter warning",
          detail: w,
          timestamp: new Date().toISOString(),
          paperOnly: true as const,
        })),
        marketOpen: false,
        ollamaUsed: false,
        ollamaFallback: false,
        aiProvider: "skipped",
        error:
          universe.warnings[0] ??
          "Zero eligible symbols after universe filters",
      };
    }

    const [clock, quotes, multiBars, marketCondition, newsResult] =
      await Promise.all([
        getMarketClock().catch((err) => {
          throw new Error(
            `Alpaca clock failed: ${err instanceof Error ? err.message : "unknown"}`,
          );
        }),
        getCachedLatestQuotes(symbols).catch(() => []),
        fetchMultiTimeframeBars(symbols).catch(() => ({
          bars1Min: {} as Record<string, never>,
          bars5Min: {} as Record<string, never>,
          bars15Min: {} as Record<string, never>,
        })),
        fetchMarketCondition().catch(() => undefined),
        getCachedWatchlistNews(symbols).catch(() => ({
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

    const autoTrade = await processAutoTradesForScan({
      opportunities,
      marketOpen: Boolean(clock?.isOpen),
    });

    const scannedAt = new Date().toISOString();
    const lastScan = buildLastScanSnapshot({
      symbols,
      decisions,
      autoDecisions: autoTrade.decisions,
      scannedAt,
    });
    await saveLastScanSnapshot(lastScan);

    await persistRankedCandidates({
      decisions,
      scannedAt,
      universeRejected: universe.rejected.map((r) => ({
        symbol: r.symbol,
        reasons: r.reasons,
      })),
    });
    void pruneDecisionLog().catch(() => undefined);
    void import("@/lib/trading/session-report")
      .then((m) => m.buildAndPersistSessionReport())
      .catch(() => undefined);

    for (const row of lastScan.ranked) {
      await appendMonitorLog({
        event: "symbol_scanned",
        message: `${row.symbol} ${row.signal} conf=${row.confidence} eligible=${row.autoEligible ? "yes" : "no"}${row.orderSubmitted ? " submitted" : ""}`,
        meta: {
          symbol: row.symbol,
          signal: row.signal,
          confidence: row.confidence,
          finalScore: row.finalScore,
          technicalScore: row.technicalScore,
          newsScore: row.newsScore,
          marketScore: row.marketScore,
          riskScore: row.riskScore,
          autoEligible: row.autoEligible,
          orderSubmitted: row.orderSubmitted,
          skippedReason: row.skippedReason,
          skipCode: row.skipCode,
        },
      });
      await appendAutoTradeLog({
        event: "symbol_scanned",
        level: row.orderSubmitted ? "info" : "info",
        message: `${row.symbol}: ${row.signal} · eligible=${row.autoEligible ? "yes" : "no"}${row.skippedReason ? ` · ${row.skippedReason}` : ""}${row.orderSubmitted ? " · order submitted" : ""}`,
        symbol: row.symbol,
        skipCode: row.skipCode ?? undefined,
        meta: {
          signal: row.signal,
          confidence: row.confidence,
          finalScore: row.finalScore,
          technicalScore: row.technicalScore,
          newsScore: row.newsScore,
          marketScore: row.marketScore,
          riskScore: row.riskScore,
          autoEligible: row.autoEligible,
          orderSubmitted: row.orderSubmitted,
          skippedReason: row.skippedReason,
        },
      });
    }

    void updateSignalOutcomes(40).catch(() => {
      // non-fatal — training loop must not block scans
    });

    await appendMonitorLog({
      event: "scan_completed",
      message: `Scan completed: ${watchlist.length} watchlist, ${symbols.length} universe-eligible, ${opportunities.length} opportunities · ${formatTopSignalLabel(lastScan)}`,
      meta: {
        stocksScanned: watchlist.length,
        universeEligible: symbols.length,
        universeRejected: universe.rejected.length,
        opportunitiesFound: opportunities.length,
        marketOpen: Boolean(clock?.isOpen),
        ollamaUsed,
        autoSubmitted: autoTrade.submitted,
        autoSkipped: autoTrade.skipped,
        scannedSymbols: symbols.join(","),
        topSymbol: lastScan.topSymbol,
      },
    });

    return {
      paperOnly: true,
      canPlaceOrders: false,
      scannedAt,
      symbols: watchlist,
      stocksScanned: watchlist.length,
      universeEligible: symbols.length,
      universeRejected: universe.rejected.length,
      opportunities,
      opportunitiesFound: opportunities.length,
      topOpportunity: pickTopOpportunity(active),
      topSignalLabel: formatTopSignalLabel(lastScan),
      lastScan,
      notifications,
      marketOpen: Boolean(clock?.isOpen),
      ollamaUsed,
      ollamaFallback,
      aiProvider: aiStatus.activeProvider,
      autoTrade: {
        processed: autoTrade.processed,
        submitted: autoTrade.submitted,
        skipped: autoTrade.skipped,
      },
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
      topSignalLabel: "Scan failed",
      lastScan: null,
      notifications: [],
      marketOpen: false,
      ollamaUsed: false,
      ollamaFallback: false,
      aiProvider: "error",
      error: message,
    };
  }
}
