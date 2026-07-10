import { NextResponse } from "next/server";
import { getWatchlist } from "@/lib/config";
import { runSimpleBacktest } from "@/lib/performance/backtest";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";

export const dynamic = "force-dynamic";

/**
 * Historical decision simulation only — never places orders.
 */
export async function GET() {
  try {
    const symbols = getWatchlist();
    const result = await runSimpleBacktest({
      symbols,
      lookbackBars: 80,
      step: 6,
      forwardBars: 6,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Backtest failed";
    const status = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json(
      {
        error: message,
        paperOnly: true,
        orderExecutionEnabled: false,
        liveTradingAllowed: false,
      },
      { status },
    );
  }
}
