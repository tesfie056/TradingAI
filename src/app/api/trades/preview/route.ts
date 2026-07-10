import { NextResponse } from "next/server";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";
import { isPaperOrderExecutionEnabled } from "@/lib/config";
import { parsePaperOrderBody } from "@/lib/trades/parse-order-body";
import { buildPaperOrderPreview } from "@/lib/trades/paper-order";

export const dynamic = "force-dynamic";

/** Build a paper order preview — never places an order. */
export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = parsePaperOrderBody(raw);
    const preview = await buildPaperOrderPreview(parsed);

    return NextResponse.json({
      ...preview,
      orderExecutionEnabled: isPaperOrderExecutionEnabled(),
      liveTradingAllowed: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to preview paper order";
    const status = error instanceof PaperTradingSafetyError ? 403 : 400;
    return NextResponse.json(
      {
        error: message,
        paperOnly: true,
        warning: "PAPER TRADE ONLY",
        orderExecutionEnabled: isPaperOrderExecutionEnabled(),
        liveTradingAllowed: false,
      },
      { status },
    );
  }
}
