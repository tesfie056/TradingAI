import { NextResponse } from "next/server";
import { getMarketClock } from "@/lib/alpaca/client";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const clock = await getMarketClock();
    return NextResponse.json({
      paperOnly: true,
      orderExecutionEnabled: false,
      clock,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load market clock";
    const status = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json({ error: message, paperOnly: true }, { status });
  }
}
