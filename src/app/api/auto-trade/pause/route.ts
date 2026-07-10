import { NextResponse } from "next/server";
import { pauseEngine } from "@/lib/auto-trade/runtime";
import { getAutoTradeStatus } from "@/lib/auto-trade/status";
import { appendAutoTradeLog } from "@/lib/auto-trade/logs";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

/** POST — pause engine (stop new scans/proposals). Does not activate kill switch. */
export async function POST() {
  await pauseEngine();
  await appendAutoTradeLog({
    event: "kill_switch_activated",
    level: "warn",
    message: "Engine paused via /pause — scanning stopped; kill switch not set",
  });
  const status = await getAutoTradeStatus();
  return NextResponse.json({
    ok: true,
    message:
      "Engine paused. Resume Engine to restart scanning. Execution and Auto Trading were not changed.",
    engine: status.engine,
    status,
    ...monitorSafetyFlags(),
  });
}
