import { NextResponse } from "next/server";
import {
  readActiveOpportunities,
  readOpportunities,
} from "@/lib/monitor/queue";
import { monitorSafetyFlags } from "@/lib/monitor/safety";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";

export const dynamic = "force-dynamic";

/** List stored opportunities (paper-only detections). */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") === "1";
    const limit = Math.min(
      200,
      Math.max(1, Number(searchParams.get("limit") ?? 50) || 50),
    );
    const opportunities = activeOnly
      ? await readActiveOpportunities()
      : await readOpportunities(limit);

    return NextResponse.json({
      ...monitorSafetyFlags(),
      count: opportunities.length,
      opportunities: opportunities.slice(0, limit),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load opportunities";
    const code = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json(
      { error: message, ...monitorSafetyFlags() },
      { status: code },
    );
  }
}
