/**
 * List Version 1 daily session dates (historical).
 */

import { NextResponse } from "next/server";
import {
  listV1DailySessionDates,
  readV1DailySession,
} from "@/lib/trading/v1-daily";

export const dynamic = "force-dynamic";

export async function GET() {
  const dates = await listV1DailySessionDates();
  const summaries = [];
  for (const d of dates.slice(-30)) {
    const s = await readV1DailySession(d);
    if (!s) continue;
    summaries.push({
      tradingDate: s.tradingDate,
      status: s.status,
      completed: s.completedTradesToday,
      target: s.dailyCompletedTradeTarget,
      targetReached: s.targetReached,
      netRealizedPnL: s.netRealizedPnL,
      wins: s.wins,
      losses: s.losses,
    });
  }

  return NextResponse.json({
    ok: true,
    paperOnly: true,
    dates,
    sessions: summaries,
  });
}
