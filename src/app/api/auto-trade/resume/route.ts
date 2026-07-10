import { NextResponse } from "next/server";
import { appendAutoTradeLog } from "@/lib/auto-trade/logs";
import { getAutoTradeStatus } from "@/lib/auto-trade/status";
import { resumeAutoTrading } from "@/lib/auto-trade/runtime";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

/** POST — resume auto paper trading after kill switch (not after panic stop). */
export async function POST() {
  const result = await resumeAutoTrading();
  if (result.resumed && result.state.killSwitch === false) {
    await appendAutoTradeLog({
      event: "auto_trading_resumed",
      level: "info",
      message: "Auto paper trading resumed (kill switch cleared)",
    });
  }
  const status = await getAutoTradeStatus();
  return NextResponse.json({
    ok: result.resumed,
    message:
      result.reason ??
      (result.resumed
        ? "Auto paper trading resumed"
        : "Could not resume auto trading"),
    ...status,
    ...monitorSafetyFlags(),
  });
}
