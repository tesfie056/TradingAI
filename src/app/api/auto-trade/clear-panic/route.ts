import { NextResponse } from "next/server";
import { getAutoTradeStatus } from "@/lib/auto-trade/status";
import { clearEmergencyStop } from "@/lib/trading/emergency";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

/** POST — clear panic / emergency stop after deliberate action. */
export async function POST() {
  await clearEmergencyStop();
  const status = await getAutoTradeStatus();
  return NextResponse.json({
    ok: true,
    message: "Emergency stop cleared",
    ...status,
    ...monitorSafetyFlags(),
  });
}
