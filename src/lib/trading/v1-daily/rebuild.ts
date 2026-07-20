/**
 * Rebuild a daily session from Version 1 lifecycle records.
 * Deduplicates by tradeId. Performs no broker mutations.
 */

import { countDailyPaperTrades } from "@/lib/trades/daily-limit";
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
import type {
  V1CountedTradeSummary,
  V1DailySession,
  V1DailySessionAuditEvent,
} from "@/lib/trading/v1-daily/types";
import type { V1LifecycleTrade } from "@/lib/trading/v1-lifecycle/types";

export function emptyV1DailySession(input: {
  tradingDate: string;
  nowIso?: string;
  entryAttemptsToday?: number;
}): V1DailySession {
  const cfg = getV1DailyConfig();
  const now = input.nowIso ?? new Date().toISOString();
  const warnings = getV1DailyConfigWarnings(cfg).map((w) => w.message);
  const base: V1DailySession = {
    paperOnly: true,
    sessionId: input.tradingDate,
    tradingDate: input.tradingDate,
    timezone: cfg.timezone,
    marketSession: { isOpen: null, note: null },
    dailyCompletedTradeTarget: cfg.dailyCompletedTradeTarget,
    maxTradesPerDay: cfg.maxTradesPerDay,
    entryAttemptsToday: input.entryAttemptsToday ?? 0,
    filledEntriesToday: 0,
    completedTradesToday: 0,
    remainingToTarget: cfg.dailyCompletedTradeTarget,
    targetReached: false,
    maxTradesReached: false,
    openV1Trades: 0,
    pendingEntries: 0,
    pendingExits: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    grossRealizedPnL: 0,
    fees: null,
    netRealizedPnL: 0,
    averageProfitPerCompletedTrade: null,
    averageLossPerLosingTrade: null,
    largestWinningTrade: null,
    largestLosingTrade: null,
    consecutiveWins: 0,
    consecutiveLosses: 0,
    dailyLossLimitReached: false,
    tradingPaused: false,
    pauseReason: null,
    lastCompletedTradeAt: null,
    countedTradeIds: [],
    countedTrades: [],
    openTradeIds: [],
    pendingTradeIds: [],
    failureReasons: [],
    configurationWarnings: warnings,
    status: "preliminary",
    createdAt: now,
    updatedAt: now,
    finalizedAt: null,
    audit: [
      {
        at: now,
        event: "session_created",
        detail: `Daily session ${input.tradingDate} created`,
      },
    ],
  };
  return applyProgressFields(
    base,
    cfg.dailyCompletedTradeTarget,
    cfg.maxTradesPerDay,
  );
}

export function rebuildV1DailySessionFromTrades(input: {
  tradingDate: string;
  lifecycleTrades: V1LifecycleTrade[];
  entryAttemptsToday?: number;
  existing?: V1DailySession | null;
  marketOpen?: boolean | null;
  failureContext?: Parameters<typeof buildTargetFailureReasons>[1];
  nowIso?: string;
}): V1DailySession {
  const cfg = getV1DailyConfig();
  const now = input.nowIso ?? new Date().toISOString();
  const byId = new Map<string, V1LifecycleTrade>();
  for (const t of input.lifecycleTrades) {
    // Prefer COMPLETED / newer updatedAt when duplicates appear
    const prev = byId.get(t.tradeId);
    if (!prev) {
      byId.set(t.tradeId, t);
      continue;
    }
    if (
      t.lifecycleState === "COMPLETED" &&
      prev.lifecycleState !== "COMPLETED"
    ) {
      byId.set(t.tradeId, t);
      continue;
    }
    if (Date.parse(t.updatedAt) >= Date.parse(prev.updatedAt)) {
      byId.set(t.tradeId, t);
    }
  }
  const unique = [...byId.values()];

  const counted: V1CountedTradeSummary[] = [];
  for (const t of unique) {
    if (!isCountableCompletedTrade(t)) continue;
    if (tradingDateForCompletedTrade(t) !== input.tradingDate) continue;
    const { pnlClass } = classifyRealizedPnL({
      realizedNetPnL: t.realizedNetPnL,
      realizedGrossPnL: t.realizedGrossPnL,
    });
    counted.push({
      tradeId: t.tradeId,
      symbol: t.symbol,
      strategyVersion: t.strategyVersion,
      exitReason: t.exitReason,
      pnlClass,
      realizedGrossPnL: t.realizedGrossPnL,
      realizedNetPnL: t.realizedNetPnL,
      fees: t.fees,
      entryFilledAt: t.entryFilledAt!,
      exitFilledAt: t.exitFilledAt!,
      countedAt: now,
    });
  }
  counted.sort(
    (a, b) => Date.parse(a.exitFilledAt) - Date.parse(b.exitFilledAt),
  );

  const metrics = summarizeCountedTrades(counted);
  const active = partitionActiveTrades(unique);
  const warnings = getV1DailyConfigWarnings(cfg).map((w) => w.message);

  const priorAudit: V1DailySessionAuditEvent[] = input.existing?.audit ?? [];
  const audit: V1DailySessionAuditEvent[] = [
    ...priorAudit,
    {
      at: now,
      event: "session_rebuilt",
      detail: `Rebuilt from ${unique.length} lifecycle records; counted ${counted.length}`,
    },
  ];

  let session: V1DailySession = {
    ...(input.existing ?? emptyV1DailySession({ tradingDate: input.tradingDate, nowIso: now })),
    paperOnly: true,
    sessionId: input.tradingDate,
    tradingDate: input.tradingDate,
    timezone: cfg.timezone,
    marketSession: {
      isOpen: input.marketOpen ?? input.existing?.marketSession.isOpen ?? null,
      note: input.existing?.marketSession.note ?? null,
    },
    dailyCompletedTradeTarget: cfg.dailyCompletedTradeTarget,
    maxTradesPerDay: cfg.maxTradesPerDay,
    entryAttemptsToday:
      input.entryAttemptsToday ?? input.existing?.entryAttemptsToday ?? 0,
    filledEntriesToday: active.filledEntriesToday,
    completedTradesToday: counted.length,
    openV1Trades: active.openV1Trades,
    pendingEntries: active.pendingEntries,
    pendingExits: active.pendingExits,
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
    countedTradeIds: counted.map((t) => t.tradeId),
    countedTrades: counted,
    openTradeIds: active.openTradeIds,
    pendingTradeIds: active.pendingTradeIds,
    configurationWarnings: warnings,
    status: input.existing?.status === "final" ? "final" : "preliminary",
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
    finalizedAt: input.existing?.finalizedAt ?? null,
    audit,
    dailyLossLimitReached: input.existing?.dailyLossLimitReached ?? false,
    tradingPaused: input.existing?.tradingPaused ?? false,
    pauseReason: input.existing?.pauseReason ?? null,
    failureReasons: [],
    remainingToTarget: 0,
    targetReached: false,
    maxTradesReached: false,
  };

  session = applyProgressFields(
    session,
    cfg.dailyCompletedTradeTarget,
    cfg.maxTradesPerDay,
  );
  session.failureReasons = buildTargetFailureReasons(session, {
    ...input.failureContext,
    configConflict: warnings.length > 0,
    maxTradesReached: session.maxTradesReached,
    hasOpenV1: session.openV1Trades > 0,
    hasPendingEntry: session.pendingEntries > 0,
    hasPendingExit: session.pendingExits > 0,
  });

  return session;
}

export async function loadEntryAttemptsToday(
  tradingDate: string,
): Promise<number> {
  // paper-trade-log counts submissions for "today" relative to now; when
  // rebuilding a historical date we only use it if tradingDate is today.
  const { todayMarketDayKey } = await import("@/lib/market/time");
  if (tradingDate !== todayMarketDayKey()) {
    return 0;
  }
  return countDailyPaperTrades();
}
