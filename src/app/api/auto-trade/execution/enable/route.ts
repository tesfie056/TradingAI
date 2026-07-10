import { NextResponse } from "next/server";
import { getAutoTradeStatus } from "@/lib/auto-trade/status";
import { setExecutionEnabled } from "@/lib/auto-trade/runtime-settings/service";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await setExecutionEnabled(true, "ui");
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errors: result.errors, ...monitorSafetyFlags() },
      { status: 400 },
    );
  }
  const status = await getAutoTradeStatus();
  return NextResponse.json({
    ok: true,
    settings: result.settings,
    engine: status.engine,
    status,
    ...monitorSafetyFlags(),
  });
}
