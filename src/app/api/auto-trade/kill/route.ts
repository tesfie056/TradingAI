import { NextResponse } from "next/server";
import { activateKillSwitch } from "@/lib/auto-trade/runtime";
import { appendAutoTradeLog } from "@/lib/auto-trade/logs";
import { getAutoTradeStatus } from "@/lib/auto-trade/status";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

/** POST — stop auto trading now (kill switch). */
export async function POST() {
  await activateKillSwitch();
  await appendAutoTradeLog({
    event: "kill_switch_activated",
    level: "warn",
    message: "Kill switch activated — auto paper trading stopped",
  });
  await appendAutoTradeLog({
    event: "auto_trading_stopped",
    level: "warn",
    message: "Auto trading stopped by user (kill switch)",
  });
  const status = await getAutoTradeStatus();
  return NextResponse.json({
    ok: true,
    message: "Auto paper trading stopped (kill switch active)",
    ...status,
    ...monitorSafetyFlags(),
  });
}
