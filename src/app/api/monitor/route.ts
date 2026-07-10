import { NextResponse } from "next/server";
import { getMonitorStatus } from "@/lib/monitor/service";
import { monitorSafetyFlags } from "@/lib/monitor/safety";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";

export const dynamic = "force-dynamic";

/** GET monitor agent status — never places orders. */
export async function GET() {
  try {
    const status = await getMonitorStatus();
    return NextResponse.json(status);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load monitor status";
    const code = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json(
      { error: message, ...monitorSafetyFlags() },
      { status: code },
    );
  }
}
