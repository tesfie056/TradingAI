import { NextResponse } from "next/server";
import { appendAutoTradeLog } from "@/lib/auto-trade/logs";
import { getAutoTradeStatus } from "@/lib/auto-trade/status";
import { activateEmergencyStop } from "@/lib/trading/emergency";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

/**
 * POST — panic / emergency stop.
 * Cancels pending entries; preserves open positions.
 */
export async function POST() {
  const emergency = await activateEmergencyStop();
  await appendAutoTradeLog({
    event: "auto_trading_stopped",
    level: "error",
    message: "Auto trading stopped by panic / emergency stop",
  });
  const status = await getAutoTradeStatus();
  return NextResponse.json({
    ok: true,
    message: emergency.message,
    emergency,
    ...status,
    ...monitorSafetyFlags(),
  });
}
