import { NextResponse } from "next/server";
import { readMonitorLogs } from "@/lib/monitor/logs";
import { monitorSafetyFlags } from "@/lib/monitor/safety";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";

export const dynamic = "force-dynamic";

/** Monitor scan logs — no secrets. */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      200,
      Math.max(1, Number(searchParams.get("limit") ?? 60) || 60),
    );
    const logs = await readMonitorLogs(limit);
    return NextResponse.json({
      ...monitorSafetyFlags(),
      count: logs.length,
      logs,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load monitor logs";
    const code = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json(
      { error: message, ...monitorSafetyFlags() },
      { status: code },
    );
  }
}
