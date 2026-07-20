/**
 * Version 1 daily session orchestration.
 * Lifecycle records are the trade truth; sessions are derived caches/reports.
 */

import { todayMarketDayKey } from "@/lib/market/time";
import {
  getV1DailyConfig,
  getV1DailyConfigWarnings,
} from "@/lib/trading/v1-daily/config";
import {
  isCountableCompletedTrade,
  tradingDateForCompletedTrade,
} from "@/lib/trading/v1-daily/count";
import { classifyRealizedPnL } from "@/lib/trading/v1-daily/classify";
import {
  applyProgressFields,
  partitionActiveTrades,
  summarizeCountedTrades,
} from "@/lib/trading/v1-daily/metrics";
import { buildTargetFailureReasons } from "@/lib/trading/v1-daily/failure-reasons";
import {
  emptyV1DailySession,
  loadEntryAttemptsToday,
  rebuildV1DailySessionFromTrades,
} from "@/lib/trading/v1-daily/rebuild";
import {
  listV1DailySessionDates,
  readV1DailySession,
  writeV1DailySession,
} from "@/lib/trading/v1-daily/store";
import type {
  V1CountedTradeSummary,
  V1DailySession,
} from "@/lib/trading/v1-daily/types";
import type { V1LifecycleTrade } from "@/lib/trading/v1-lifecycle/types";
import {
  listActiveV1Trades,
  listCompletedV1Trades,
  readV1LifecycleStore,
} from "@/lib/trading/v1-lifecycle/store";

async function allLifecycleTrades(): Promise<V1LifecycleTrade[]> {
  const store = await readV1LifecycleStore();
  return store.trades;
}

/**
 * Ensure a session exists for the trading date (default: today ET).
 * Creating a new date does not modify prior session files.
 */
export async function getOrCreateV1DailySession(
  tradingDate = todayMarketDayKey(),
): Promise<V1DailySession> {
  const existing = await readV1DailySession(tradingDate);
  if (existing) {
    const cfg = getV1DailyConfig();
    const warnings = getV1DailyConfigWarnings(cfg).map((w) => w.message);
    let next = {
      ...existing,
      configurationWarnings: warnings,
      dailyCompletedTradeTarget: cfg.dailyCompletedTradeTarget,
      maxTradesPerDay: cfg.maxTradesPerDay,
    };
    next = applyProgressFields(
      next,
      cfg.dailyCompletedTradeTarget,
      cfg.maxTradesPerDay,
    );
    return next;
  }

  const entries = await loadEntryAttemptsToday(tradingDate);
  const created = emptyV1DailySession({
    tradingDate,
    entryAttemptsToday: entries,
  });
  return writeV1DailySession(created);
}

/**
 * Idempotently count a completed lifecycle trade into its exit-date session.
 * Same tradeId never increments twice.
 */
export async function recordV1CompletedTrade(
  trade: V1LifecycleTrade,
): Promise<{
  counted: boolean;
  duplicate: boolean;
  session: V1DailySession | null;
  reason?: string;
}> {
  if (!isCountableCompletedTrade(trade)) {
    return {
      counted: false,
      duplicate: false,
      session: null,
      reason: "Trade is not a countable Version 1 completed round trip",
    };
  }
  const tradingDate = tradingDateForCompletedTrade(trade);
  if (!tradingDate) {
    return {
      counted: false,
      duplicate: false,
      session: null,
      reason: "Missing exit fill date",
    };
  }

  let session = await getOrCreateV1DailySession(tradingDate);
  if (session.countedTradeIds.includes(trade.tradeId)) {
    session = {
      ...session,
      audit: [
        ...session.audit,
        {
          at: new Date().toISOString(),
          event: "duplicate_count_ignored",
          detail: `Trade ${trade.tradeId} already counted`,
          tradeId: trade.tradeId,
        },
      ],
    };
    await writeV1DailySession(session);
    return { counted: false, duplicate: true, session };
  }

  const { pnlClass } = classifyRealizedPnL({
    realizedNetPnL: trade.realizedNetPnL,
    realizedGrossPnL: trade.realizedGrossPnL,
  });
  const now = new Date().toISOString();
  const summary: V1CountedTradeSummary = {
    tradeId: trade.tradeId,
    symbol: trade.symbol,
    strategyVersion: trade.strategyVersion,
    exitReason: trade.exitReason,
    pnlClass,
    realizedGrossPnL: trade.realizedGrossPnL,
    realizedNetPnL: trade.realizedNetPnL,
    fees: trade.fees,
    entryFilledAt: trade.entryFilledAt!,
    exitFilledAt: trade.exitFilledAt!,
    countedAt: now,
  };

  const countedTrades = [...session.countedTrades, summary];
  const metrics = summarizeCountedTrades(countedTrades);
  const cfg = getV1DailyConfig();
  const wasTarget = session.targetReached;

  session = {
    ...session,
    countedTradeIds: [...session.countedTradeIds, trade.tradeId],
    countedTrades,
    completedTradesToday: countedTrades.length,
    wins: metrics.wins,
    losses: metrics.losses,
    breakeven: metrics.breakeven,
    grossRealizedPnL: metrics.grossRealizedPnL,
    fees: metrics.fees,
    netRealizedPnL: metrics.netRealizedPnL,
    averageProfitPerCompletedTrade: metrics.averageProfitPerCompletedTrade,
    averageLossPerLosingTrade: metrics.averageLossPerLosingTrade,
    largestWinningTrade: metrics.largestWinningTrade,
    largestLosingTrade: metrics.largestLosingTrade,
    consecutiveWins: metrics.consecutiveWins,
    consecutiveLosses: metrics.consecutiveLosses,
    lastCompletedTradeAt: metrics.lastCompletedTradeAt,
    audit: [
      ...session.audit,
      {
        at: now,
        event: "trade_counted",
        detail: `Counted ${trade.symbol} as ${pnlClass}`,
        tradeId: trade.tradeId,
      },
      {
        at: now,
        event: "win_loss_classified",
        detail: `${pnlClass} for ${trade.tradeId}`,
        tradeId: trade.tradeId,
      },
    ],
  };
  session = applyProgressFields(
    session,
    cfg.dailyCompletedTradeTarget,
    cfg.maxTradesPerDay,
  );

  if (session.targetReached && !wasTarget) {
    session = {
      ...session,
      audit: [
        ...session.audit,
        {
          at: now,
          event: "target_reached",
          detail: `Daily completed-trade target ${cfg.dailyCompletedTradeTarget} reached`,
        },
      ],
    };
  }

  session.failureReasons = buildTargetFailureReasons(session, {
    configConflict: session.configurationWarnings.length > 0,
    maxTradesReached: session.maxTradesReached,
    hasOpenV1: session.openV1Trades > 0,
    hasPendingEntry: session.pendingEntries > 0,
    hasPendingExit: session.pendingExits > 0,
  });

  session = await writeV1DailySession(session);
  return { counted: true, duplicate: false, session };
}

/**
 * Refresh open/pending counters and entry attempts from live lifecycle + log.
 * Does not recount completed trades (use rebuild for full recalculation).
 */
export async function refreshV1DailySessionLiveState(
  tradingDate = todayMarketDayKey(),
  opts?: {
    marketOpen?: boolean | null;
    failureContext?: Parameters<typeof buildTargetFailureReasons>[1];
  },
): Promise<V1DailySession> {
  let session = await getOrCreateV1DailySession(tradingDate);
  const [active, entries] = await Promise.all([
    listActiveV1Trades(),
    loadEntryAttemptsToday(tradingDate),
  ]);
  const part = partitionActiveTrades(active);
  const cfg = getV1DailyConfig();
  const warnings = getV1DailyConfigWarnings(cfg).map((w) => w.message);

  session = {
    ...session,
    entryAttemptsToday: entries,
    filledEntriesToday: part.filledEntriesToday,
    openV1Trades: part.openV1Trades,
    pendingEntries: part.pendingEntries,
    pendingExits: part.pendingExits,
    openTradeIds: part.openTradeIds,
    pendingTradeIds: part.pendingTradeIds,
    configurationWarnings: warnings,
    marketSession: {
      isOpen: opts?.marketOpen ?? session.marketSession.isOpen,
      note: session.marketSession.note,
    },
    updatedAt: new Date().toISOString(),
  };
  session = applyProgressFields(
    session,
    cfg.dailyCompletedTradeTarget,
    cfg.maxTradesPerDay,
  );
  if (session.maxTradesReached) {
    session = {
      ...session,
      audit: [
        ...session.audit,
        {
          at: new Date().toISOString(),
          event: "max_trades_reached",
          detail: `Entry submission max ${cfg.maxTradesPerDay} reached`,
        },
      ],
    };
  }
  session.failureReasons = buildTargetFailureReasons(session, {
    ...opts?.failureContext,
    configConflict: warnings.length > 0,
    maxTradesReached: session.maxTradesReached,
    hasOpenV1: session.openV1Trades > 0,
    hasPendingEntry: session.pendingEntries > 0,
    hasPendingExit: session.pendingExits > 0,
    marketOpen: opts?.marketOpen,
  });
  return writeV1DailySession(session);
}

/** Full rebuild from lifecycle store for a trading date. */
export async function rebuildV1DailySession(
  tradingDate = todayMarketDayKey(),
  opts?: {
    marketOpen?: boolean | null;
    failureContext?: Parameters<typeof buildTargetFailureReasons>[1];
  },
): Promise<V1DailySession> {
  const [trades, existing, entries] = await Promise.all([
    allLifecycleTrades(),
    readV1DailySession(tradingDate),
    loadEntryAttemptsToday(tradingDate),
  ]);
  // Also merge completed history if active store pruned — listCompleted covers store
  const completed = await listCompletedV1Trades();
  const byId = new Map<string, V1LifecycleTrade>();
  for (const t of [...trades, ...completed]) byId.set(t.tradeId, t);

  const rebuilt = rebuildV1DailySessionFromTrades({
    tradingDate,
    lifecycleTrades: [...byId.values()],
    entryAttemptsToday: entries,
    existing,
    marketOpen: opts?.marketOpen,
    failureContext: opts?.failureContext,
  });
  return writeV1DailySession(rebuilt);
}

export async function finalizeV1DailySession(
  tradingDate: string,
  note?: string,
): Promise<V1DailySession> {
  let session = await rebuildV1DailySession(tradingDate);
  const now = new Date().toISOString();
  session = {
    ...session,
    status: "final",
    finalizedAt: now,
    audit: [
      ...session.audit,
      {
        at: now,
        event: "session_finalized",
        detail: note ?? "Daily session marked final",
      },
    ],
  };
  return writeV1DailySession(session);
}

/**
 * On a new market day, ensure today's session exists without mutating yesterday.
 * Optionally finalize the prior date when market is closed and no open V1 trades.
 */
export async function ensureCurrentV1DailySession(input?: {
  marketOpen?: boolean | null;
}): Promise<{
  current: V1DailySession;
  priorFinalized: string | null;
}> {
  const today = todayMarketDayKey();
  const dates = await listV1DailySessionDates();
  let priorFinalized: string | null = null;

  for (const d of dates) {
    if (d >= today) continue;
    const prior = await readV1DailySession(d);
    if (!prior || prior.status === "final") continue;
    const active = await listActiveV1Trades();
    const stillOpen = active.some(
      (t) =>
        t.ownership === "v1_managed" &&
        t.lifecycleState !== "COMPLETED" &&
        t.lifecycleState !== "ENTRY_REJECTED",
    );
    if (!stillOpen && input?.marketOpen === false) {
      await finalizeV1DailySession(d, "Auto-finalized on later market date");
      priorFinalized = d;
    }
  }

  const current = await rebuildV1DailySession(today, {
    marketOpen: input?.marketOpen,
  });
  return { current, priorFinalized };
}

export async function getV1DailyStatusSnapshot(): Promise<{
  session: V1DailySession;
  configWarnings: string[];
  targetLabel: string;
}> {
  const { current } = await ensureCurrentV1DailySession();
  const session = await refreshV1DailySessionLiveState(current.tradingDate);
  return {
    session,
    configWarnings: session.configurationWarnings,
    targetLabel: `Daily goal: ${session.completedTradesToday} of ${session.dailyCompletedTradeTarget} completed trades`,
  };
}
