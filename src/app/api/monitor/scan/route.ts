import { NextResponse } from "next/server";
import { scanMonitorNow } from "@/lib/monitor/service";
import { monitorSafetyFlags } from "@/lib/monitor/safety";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";

export const dynamic = "force-dynamic";

/** Run one monitor scan now — never places orders. */
export async function POST() {
  try {
    const { status, scan } = await scanMonitorNow();
    return NextResponse.json({
      ok: !scan.error || Boolean(scan.rateLimited),
      message: scan.error
        ? scan.error
        : `Scan complete: ${scan.opportunitiesFound} opportunities (no orders placed)`,
      scan,
      ...status,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to run monitor scan";
    const code = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json(
      { ok: false, error: message, ...monitorSafetyFlags() },
      { status: code },
    );
  }
}
