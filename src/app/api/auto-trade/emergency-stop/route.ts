import { NextResponse } from "next/server";
import { getAutoTradeStatus } from "@/lib/auto-trade/status";
import { activateEmergencyStop } from "@/lib/trading/emergency";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

/**
 * POST — Emergency Stop:
 * blocks new orders, cancels pending entries, preserves open positions.
 * Does NOT liquidate positions.
 */
export async function POST() {
  const result = await activateEmergencyStop();
  const status = await getAutoTradeStatus();
  return NextResponse.json({
    ok: true,
    ...result,
    ...status,
    ...monitorSafetyFlags(),
  });
}
