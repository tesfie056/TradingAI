import { NextResponse } from "next/server";
import { stopMonitor } from "@/lib/monitor/service";
import { monitorSafetyFlags } from "@/lib/monitor/safety";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";

export const dynamic = "force-dynamic";

/** Stop background monitoring. */
export async function POST() {
  try {
    const status = await stopMonitor();
    return NextResponse.json({
      ok: true,
      message: "Monitoring stopped",
      ...status,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to stop monitor";
    const code = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json(
      { ok: false, error: message, ...monitorSafetyFlags() },
      { status: code },
    );
  }
}
