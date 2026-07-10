import { NextResponse } from "next/server";
import { readAutoTradeLogs } from "@/lib/auto-trade/logs";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const logs = await readAutoTradeLogs(limit);
  return NextResponse.json({
    ok: true,
    logs,
    ...monitorSafetyFlags(),
  });
}
