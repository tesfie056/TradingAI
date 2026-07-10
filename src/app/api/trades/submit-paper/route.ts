import { NextResponse } from "next/server";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";
import { isPaperOrderExecutionEnabled } from "@/lib/config";
import { parsePaperOrderBody } from "@/lib/trades/parse-order-body";
import { submitManualPaperOrder } from "@/lib/trades/paper-order";

export const dynamic = "force-dynamic";

/**
 * Submit a manually approved paper market order.
 * Never auto-trades. Blocked unless ENABLE_PAPER_ORDER_EXECUTION=true
 * and all safety gates pass.
 */
export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = parsePaperOrderBody(raw);
    const result = await submitManualPaperOrder({
      ...parsed,
      confirmed: true,
      manualApproval: true,
    });

    const status = result.submitted ? 200 : 403;
    return NextResponse.json(
      {
        ...result,
        orderExecutionEnabled: isPaperOrderExecutionEnabled(),
        liveTradingAllowed: false,
      },
      { status },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to submit paper order";
    const status = error instanceof PaperTradingSafetyError ? 403 : 400;
    return NextResponse.json(
      {
        error: message,
        paperOnly: true,
        warning: "PAPER TRADE ONLY",
        submitted: false,
        orderExecutionEnabled: isPaperOrderExecutionEnabled(),
        liveTradingAllowed: false,
      },
      { status },
    );
  }
}
