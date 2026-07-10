import { NextResponse } from "next/server";
import { getOrders } from "@/lib/alpaca/client";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";
import { isPaperOrderExecutionEnabled } from "@/lib/config";
import { mapAlpacaOrderToTradeRow } from "@/lib/trades/trade-display";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const orders = await getOrders(50);
    return NextResponse.json({
      paperOnly: true,
      orderExecutionEnabled: isPaperOrderExecutionEnabled(),
      liveTradingAllowed: false,
      trades: orders.map(mapAlpacaOrderToTradeRow),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load trade history";
    const status = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json(
      {
        error: message,
        paperOnly: true,
        orderExecutionEnabled: isPaperOrderExecutionEnabled(),
        liveTradingAllowed: false,
      },
      { status },
    );
  }
}
