import { NextResponse } from "next/server";
import { startMonitor } from "@/lib/monitor/service";
import { monitorSafetyFlags } from "@/lib/monitor/safety";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";

export const dynamic = "force-dynamic";

/** Start background monitoring interval — detection only, no orders. */
export async function POST() {
  try {
    const status = await startMonitor();
    return NextResponse.json({
      ok: true,
      message: "Monitoring started (paper-only, no automatic trading)",
      ...status,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start monitor";
    const code = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json(
      { ok: false, error: message, ...monitorSafetyFlags() },
      { status: code },
    );
  }
}
