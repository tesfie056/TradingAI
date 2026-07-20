/**
 * Simple Version 1 daily report (preliminary or final).
 */

import { safetyBlocksOnly } from "@/lib/trading/v1-daily/failure-reasons";
import type { V1DailyReport, V1DailySession } from "@/lib/trading/v1-daily/types";

export function buildV1DailyReport(session: V1DailySession): V1DailyReport {
  return {
    paperOnly: true,
    tradingDate: session.tradingDate,
    status: session.status,
    target: session.dailyCompletedTradeTarget,
    completed: session.completedTradesToday,
    remaining: session.remainingToTarget,
    targetReached: session.targetReached,
    wins: session.wins,
    losses: session.losses,
    breakeven: session.breakeven,
    realizedNetPnL: session.netRealizedPnL,
    realizedGrossPnL: session.grossRealizedPnL,
    openOrUnresolved: session.openV1Trades + session.pendingEntries + session.pendingExits,
    whyTargetNotReached: session.targetReached ? [] : session.failureReasons,
    safetyBlocks: safetyBlocksOnly(session.failureReasons),
    completedTrades: session.countedTrades,
    strategyNote:
      "Version 1 daily target never overrides safety. Fewer than three completed trades is acceptable when no qualified setup exists. This report is not performance proof.",
    aaplShortExcluded: true,
    generatedAt: new Date().toISOString(),
  };
}
