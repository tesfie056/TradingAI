import { NextResponse } from "next/server";
import { readV1StrategyLatest } from "@/lib/strategy/v1-simple-long";

/**
 * GET — latest Version 1 strategy evaluation snapshot (planning only).
 * Never places orders.
 */
export async function GET() {
  const latest = await readV1StrategyLatest();
  return NextResponse.json({
    ok: true,
    paperOnly: true,
    planningOnly: true,
    liveTradingAllowed: false,
    latest,
  });
}
