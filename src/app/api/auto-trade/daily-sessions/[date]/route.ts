/**
 * Version 1 daily session for a specific trading date (YYYY-MM-DD).
 */

import { NextResponse } from "next/server";
import {
  buildV1DailyReport,
  readV1DailySession,
  rebuildV1DailySession,
} from "@/lib/trading/v1-daily";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ date: string }> },
) {
  const { date } = await ctx.params;
  if (!DATE_RE.test(date)) {
    return NextResponse.json(
      { ok: false, error: "Invalid date. Use YYYY-MM-DD (U.S. market date)." },
      { status: 400 },
    );
  }

  let session = await readV1DailySession(date);
  if (!session) {
    // Rebuild dry from lifecycle if file missing
    session = await rebuildV1DailySession(date);
  }

  return NextResponse.json({
    ok: true,
    paperOnly: true,
    aaplShortExcluded: true,
    session,
    report: buildV1DailyReport(session),
    countedTrades: session.countedTrades,
  });
}
