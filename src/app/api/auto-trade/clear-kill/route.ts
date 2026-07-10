import { NextResponse } from "next/server";
import { appendAutoTradeLog } from "@/lib/auto-trade/logs";
import { clearKillSwitchKeepPaused } from "@/lib/auto-trade/runtime";
import { getAutoTradeStatus } from "@/lib/auto-trade/status";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

/**
 * POST — clear kill switch without enabling execution/auto or resuming the engine.
 * Engine remains paused until Resume Engine.
 */
export async function POST() {
  await clearKillSwitchKeepPaused();
  await appendAutoTradeLog({
    event: "auto_trading_resumed",
    level: "info",
    message:
      "Kill switch cleared — engine remains paused; execution/auto unchanged",
  });
  const status = await getAutoTradeStatus();
  return NextResponse.json({
    ok: true,
    message:
      "Kill switch cleared. Engine stays paused. Execution and Auto Trading were not enabled.",
    ...status,
    ...monitorSafetyFlags(),
  });
}
