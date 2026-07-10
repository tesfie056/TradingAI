import { NextResponse } from "next/server";
import { getAutoTradeAnalytics } from "@/lib/performance/auto-trade-analytics";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

/** GET auto-trade performance analytics — paper only. */
export async function GET() {
  try {
    const analytics = await getAutoTradeAnalytics();
    return NextResponse.json({
      ok: true,
      ...analytics,
      ...monitorSafetyFlags(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load analytics";
    return NextResponse.json(
      { ok: false, error: message, ...monitorSafetyFlags() },
      { status: 500 },
    );
  }
}
