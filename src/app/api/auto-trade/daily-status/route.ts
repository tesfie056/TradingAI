/**
 * Current Version 1 daily completed-trade target status.
 * Read-only. Paper only.
 */

import { NextResponse } from "next/server";
import {
  buildV1DailyReport,
  getV1DailyConfig,
  getV1DailyConfigWarnings,
  getV1DailyStatusSnapshot,
} from "@/lib/trading/v1-daily";

export const dynamic = "force-dynamic";

export async function GET() {
  const snap = await getV1DailyStatusSnapshot();
  const cfg = getV1DailyConfig();
  const report = buildV1DailyReport(snap.session);

  return NextResponse.json({
    ok: true,
    paperOnly: true,
    aaplShortExcluded: true,
    targetLabel: snap.targetLabel,
    explanation:
      "The daily target never overrides safety rules. The system may finish with fewer than three trades when no qualified setup is available.",
    config: {
      dailyCompletedTradeTarget: cfg.dailyCompletedTradeTarget,
      maxTradesPerDay: cfg.maxTradesPerDay,
      timezone: cfg.timezone,
      warnings: getV1DailyConfigWarnings(cfg),
    },
    session: {
      tradingDate: snap.session.tradingDate,
      status: snap.session.status,
      completed: snap.session.completedTradesToday,
      remaining: snap.session.remainingToTarget,
      target: snap.session.dailyCompletedTradeTarget,
      targetReached: snap.session.targetReached,
      wins: snap.session.wins,
      losses: snap.session.losses,
      breakeven: snap.session.breakeven,
      realizedNetPnL: snap.session.netRealizedPnL,
      realizedGrossPnL: snap.session.grossRealizedPnL,
      openTrades: snap.session.openV1Trades,
      pendingEntries: snap.session.pendingEntries,
      pendingExits: snap.session.pendingExits,
      entryAttemptsToday: snap.session.entryAttemptsToday,
      maxTradesReached: snap.session.maxTradesReached,
      tradingPaused: snap.session.tradingPaused,
      pauseReason: snap.session.pauseReason,
      failureReasons: snap.session.failureReasons,
      configurationWarnings: snap.session.configurationWarnings,
      lastCompletedTradeAt: snap.session.lastCompletedTradeAt,
      updatedAt: snap.session.updatedAt,
    },
    report,
  });
}
