import { NextResponse } from "next/server";
import { getAutoTradePolicy } from "@/lib/auto-trade/policy";
import { getAutoTradeStatus } from "@/lib/auto-trade/status";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

/** GET auto paper trading status — paper only, never live. */
export async function GET() {
  try {
    const status = await getAutoTradeStatus();
    const policy = getAutoTradePolicy();
    return NextResponse.json({
      ok: true,
      ...status,
      policy,
      ...monitorSafetyFlags(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load auto trade status";
    const code = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json(
      { ok: false, error: message, ...monitorSafetyFlags() },
      { status: code },
    );
  }
}
