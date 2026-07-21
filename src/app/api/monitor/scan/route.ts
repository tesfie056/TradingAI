import { NextResponse } from "next/server";
import { scanMonitorNow } from "@/lib/monitor/service";
import { monitorSafetyFlags } from "@/lib/monitor/safety";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";

export const dynamic = "force-dynamic";

/** Run one monitor scan now. Order submission is owned by Auto Trading, not this route. */
export async function POST() {
  try {
    const { status, scan } = await scanMonitorNow();
    const submitted = scan.autoTrade?.submitted ?? 0;
    return NextResponse.json({
      ok: !scan.error || Boolean(scan.rateLimited),
      message: scan.error
        ? scan.error
        : submitted > 0
          ? `Scan complete: ${scan.opportunitiesFound} opportunities · Auto Trading submitted ${submitted} paper order${submitted === 1 ? "" : "s"}`
          : `Scan complete: ${scan.opportunitiesFound} opportunities · Auto Trading evaluated setups`,
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
