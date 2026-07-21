/**
 * Opportunity scanner — one full watchlist pass.
 * Pulls clock, quotes/bars, news; scores via existing decision engine.
 * When AUTO_PAPER_TRADING_ENABLED=true, delegates to auto-trade module (paper only).
 */

import { generateWatchlistDecisions } from "@/lib/ai/decision";
import { getCachedLatestQuotes } from "@/lib/cache/quote-cache";
import { getFreshBrokerClock } from "@/lib/market/broker-clock";
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

export type MonitorScanOutcome =
  | "completed"
  | "paused"
  | "failed"
  | "rate_limited"
  | "empty_universe";

export type MonitorScanResult = {
  paperOnly: true;
  canPlaceOrders: false;
  scannedAt: string;
  symbols: string[];
  stocksScanned: number;
  /** Watchlist symbols that passed universe hard filters. */
  universeEligible?: number;
  universeRejected?: number;
  /** Configured watchlist size when known (even if scan was skipped). */
  watchlistSize?: number;
  opportunities: MonitorOpportunity[];
  opportunitiesFound: number;
  topOpportunity: MonitorOpportunity | null;
  topSignalLabel: string;
  lastScan: LastScanSnapshot | null;
  notifications: MonitorNotification[];
  /**
   * Alpaca session flag from this scan.
   * null = unknown / unchanged (skip paths must not force closed).
   */
  marketOpen: boolean | null;
  ollamaUsed: boolean;
  ollamaFallback: boolean;
  aiProvider: string;
  rateLimited?: boolean;
  /** True when the scan did not evaluate symbols (pause / rate-limit skip). */
  skipped?: boolean;
  outcome?: MonitorScanOutcome;
  pauseReason?: string;
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
    const watchlist = getWatchlist();
    return {
      paperOnly: true,
      canPlaceOrders: false,
      scannedAt: new Date().toISOString(),
      symbols: watchlist,
      stocksScanned: 0,
      watchlistSize: watchlist.length,
      opportunities: active,
      opportunitiesFound: 0,
      topOpportunity: pickTopOpportunity(active),
      topSignalLabel: "Scan rate-limited — using prior opportunities",
      lastScan: null,
      notifications: [],
      marketOpen: null,
      ollamaUsed: false,
      ollamaFallback: false,
      aiProvider: "skipped",
      rateLimited: true,
      skipped: true,
      outcome: "rate_limited",
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
    const {
      describeEnginePauseReason,
      isEnginePaused,
    } = await import("@/lib/auto-trade/pause-reason");
    const runtime = await getAutoTradeRuntime();
    if (isEnginePaused(runtime)) {
      const pauseReason = describeEnginePauseReason(runtime);
      const watchlistSize = getWatchlist().length;
      await appendMonitorLog({
        event: "scan_completed",
        level: "warn",
        message: `Scan skipped — ${pauseReason}`,
        meta: {
          skipped: true,
          outcome: "paused",
          panicStop: runtime.panicStop,
          killSwitch: runtime.killSwitch,
          runtimeDisabled: runtime.runtimeDisabled,
          watchlistSize,
        },
      });
      return {
        paperOnly: true,
        canPlaceOrders: false,
        scannedAt: new Date().toISOString(),
        stocksScanned: 0,
        symbols: [],
        watchlistSize,
        opportunities: await readActiveOpportunities(),
        opportunitiesFound: 0,
        topOpportunity: null,
        topSignalLabel: "Scanning suspended — engine paused",
        lastScan: null,
        notifications: [],
        marketOpen: null,
        ollamaUsed: false,
        ollamaFallback: false,
        aiProvider: "skipped",
        skipped: true,
        outcome: "paused",
        pauseReason,
        error: pauseReason,
      };
    }

    const watchlist = getWatchlist();
    await appendMonitorLog({
      event: "scan_started",
      message: `Watchlist loaded with ${watchlist.length} stock${watchlist.length === 1 ? "" : "s"}`,
      meta: { watchlistSize: watchlist.length },
    });
    if (watchlist.length === 0) {
      await appendMonitorLog({
        event: "scan_error",
        level: "error",
        message: "Scan could not start — the watchlist could not be loaded.",
      });
      return {
        paperOnly: true,
        canPlaceOrders: false,
        scannedAt: new Date().toISOString(),
        stocksScanned: 0,
        symbols: [],
        watchlistSize: 0,
        opportunities: [],
        opportunitiesFound: 0,
        topOpportunity: null,
        topSignalLabel: "Watchlist unavailable",
        lastScan: null,
        notifications: [],
        marketOpen: null,
        ollamaUsed: false,
        ollamaFallback: false,
        aiProvider: "skipped",
        skipped: true,
        outcome: "failed",
        error: "Scan could not start. The watchlist could not be loaded.",
      };
    }

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
      const watchlistSize = universe.breakdown.watchlistSize || watchlist.length;
      await appendMonitorLog({
        event: "scan_completed",
        message:
          "Scan completed — zero symbols passed universe filters (no silent fallback)",
        meta: {
          watchlistSize,
          rejected: universe.rejected.length,
          outcome: "empty_universe",
        },
      });
      return {
        paperOnly: true,
        canPlaceOrders: false,
        scannedAt: new Date().toISOString(),
        stocksScanned: watchlistSize,
        symbols: watchlist,
        watchlistSize,
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
        marketOpen: null,
        ollamaUsed: false,
        ollamaFallback: false,
        aiProvider: "skipped",
        outcome: "empty_universe",
        error:
          universe.warnings[0] ??
          "Zero eligible symbols after universe filters",
      };
    }

    const [brokerClock, quotes, multiBars, marketCondition, newsResult] =
      await Promise.all([
        getFreshBrokerClock({ force: true }),
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
    const clockOpen = brokerClock.isOpen;
    const sessionOpen = clockOpen === true;

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

    const [
      { getPositions, getOpenOrders },
      { readReconcileState },
      { readRiskRuntime },
    ] = await Promise.all([
      import("@/lib/alpaca/client"),
      import("@/lib/trading/reconcile"),
      import("@/lib/risk/runtime"),
    ]);
    const [positions, openOrders, reconcile, riskRuntime] = await Promise.all([
      getPositions().catch(() => []),
      getOpenOrders(100).catch(() => []),
      readReconcileState().catch(() => null),
      readRiskRuntime().catch(() => null),
    ]);
    const reconciliationComplete =
      riskRuntime?.reconciliationComplete === true ||
      (reconcile != null &&
        reconcile.completedAt != null &&
        !reconcile.inProgress &&
        reconcile.error == null);
    const openPositionSymbols = positions
      .filter((p) => Number(p.qty) !== 0)
      .map((p) => p.symbol.toUpperCase());
    const pendingEntrySymbols = openOrders
      .filter(
        (o) =>
          o.side === "buy" &&
          ["new", "accepted", "pending_new", "partially_filled"].includes(
            o.status,
          ),
      )
      .map((o) => o.symbol.toUpperCase());
    const pendingExitSymbols = openOrders
      .filter(
        (o) =>
          o.side === "sell" &&
          ["new", "accepted", "pending_new", "partially_filled"].includes(
            o.status,
          ),
      )
      .map((o) => o.symbol.toUpperCase());

    const decisions = generateWatchlistDecisions({
      symbols,
      quotes: Array.isArray(quotes) ? quotes : [],
      barsBySymbol: multiBars.bars5Min ?? {},
      bars1MinBySymbol: multiBars.bars1Min,
      bars5MinBySymbol: multiBars.bars5Min,
      bars15MinBySymbol: multiBars.bars15Min,
      timeframe: "5Min",
      isMarketOpen: clockOpen,
      newsBySymbol,
      marketCondition,
      universeEligibleSymbols: symbols,
      openPositionSymbols,
      pendingEntrySymbols,
      pendingExitSymbols,
      reconciliationComplete,
    });

    // Persist Version 1 strategy snapshot (planning only — no orders).
    const scanId = `scan_${Date.now().toString(36)}`;
    try {
      const {
        evaluateV1SimpleLong,
        saveV1StrategyLatest,
        appendV1StrategyDecisions,
        minutesSinceRegularOpen,
        minutesUntilRegularClose,
      } = await import("@/lib/strategy/v1-simple-long");
      const { getRiskTradingConfig } = await import("@/lib/config/risk-config");
      const { assessDataQuality } = await import("@/lib/market/data-quality");
      const riskCfg = getRiskTradingConfig();
      const nowMs = Date.now();
      const quoteMap = new Map(
        (Array.isArray(quotes) ? quotes : []).map((q) => [
          q.symbol.toUpperCase(),
          q,
        ]),
      );
      const v1Results = symbols.map((sym) => {
        const q = quoteMap.get(sym);
        const bars5 = multiBars.bars5Min?.[sym] ?? [];
        const dq = assessDataQuality({
          isMarketOpen: clockOpen,
          quote: q,
          bars: bars5,
          nowMs,
        });
        return evaluateV1SimpleLong({
          symbol: sym,
          quote: q ?? null,
          bars5Min: bars5,
          bars15Min: multiBars.bars15Min?.[sym] ?? [],
          bars1Min: multiBars.bars1Min?.[sym],
          dataQuality: dq,
          context: {
            isMarketOpen: sessionOpen,
            minutesSinceOpen: sessionOpen
              ? minutesSinceRegularOpen(nowMs)
              : null,
            minutesToClose: sessionOpen
              ? minutesUntilRegularClose(nowMs)
              : null,
            hasOpenPosition: openPositionSymbols.includes(sym),
            hasPendingEntry: pendingEntrySymbols.includes(sym),
            hasPendingExit: pendingExitSymbols.includes(sym),
            reconciliationComplete,
            universeEligible: true,
            openEntryDelayMinutes: riskCfg.openEntryDelayMinutes,
            eodEntryCutoffMinutes: riskCfg.eodEntryCutoffMinutes,
            minPrice: riskCfg.minPrice,
            maxPrice: riskCfg.maxPrice,
            maxSpreadPercent: riskCfg.maxSpreadPercent,
            stopLossPct: riskCfg.defaultStopLossPct,
            takeProfitPct: riskCfg.defaultTakeProfitPct,
            nowMs,
            scanId,
          },
        });
      });
      await saveV1StrategyLatest({
        scanId,
        evaluatedAt: new Date().toISOString(),
        marketOpen: sessionOpen,
        results: v1Results,
      });
      await appendV1StrategyDecisions(
        v1Results.map((r) => ({
          ...r,
          scanId,
          dataTimestamp: quoteMap.get(r.symbol)?.timestamp ?? null,
        })),
      );
    } catch {
      // Strategy logging must never break the monitor scan
    }

    const opportunities = decisionsToOpportunities(decisions, {
      ollamaUsed,
    });

    await appendOpportunities(opportunities);
    await expireStaleOpportunities();
    await pruneOpportunities();
    await pruneMonitorLogs();

    const notifications = buildScanNotifications(opportunities);
    const active = await readActiveOpportunities();

    // Version 1 lifecycle monitor (sync fills/protection; gated exits)
    try {
      const { runV1LifecycleScanTick } = await import(
        "@/lib/trading/v1-lifecycle/scan-hook"
      );
      await runV1LifecycleScanTick({ marketOpen: sessionOpen });
    } catch {
      // Lifecycle monitor must not break scans
    }

    const autoTrade = await processAutoTradesForScan({
      opportunities,
      marketOpen: clockOpen,
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
        marketOpen: clockOpen,
        marketSessionStatus: brokerClock.status,
        clockError: brokerClock.error,
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
      watchlistSize: watchlist.length,
      universeEligible: symbols.length,
      universeRejected: universe.rejected.length,
      opportunities,
      opportunitiesFound: opportunities.length,
      topOpportunity: pickTopOpportunity(active),
      topSignalLabel: formatTopSignalLabel(lastScan),
      lastScan,
      notifications,
      marketOpen: clockOpen,
      ollamaUsed,
      ollamaFallback,
      aiProvider: aiStatus.activeProvider,
      outcome: "completed",
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
    const watchlist = getWatchlist();
    return {
      paperOnly: true,
      canPlaceOrders: false,
      scannedAt: new Date().toISOString(),
      symbols: watchlist,
      stocksScanned: 0,
      watchlistSize: watchlist.length,
      outcome: "failed",
      opportunities: [],
      opportunitiesFound: 0,
      topOpportunity: null,
      topSignalLabel: "Scan failed",
      lastScan: null,
      notifications: [],
      marketOpen: null,
      ollamaUsed: false,
      ollamaFallback: false,
      aiProvider: "error",
      error: message,
    };
  }
}
