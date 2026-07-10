import { NextResponse } from "next/server";
import { getOrders } from "@/lib/alpaca/client";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const orders = await getOrders(50);
    return NextResponse.json({
      paperOnly: true,
      trades: orders.map((o) => ({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        qty: o.qty,
        filledQty: o.filled_qty,
        filledAvgPrice: o.filled_avg_price,
        status: o.status,
        submittedAt: o.submitted_at,
        filledAt: o.filled_at,
        limitPrice: o.limit_price,
      })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load trade history";
    const status = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json({ error: message, paperOnly: true }, { status });
  }
}
