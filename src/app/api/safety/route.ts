import { NextResponse } from "next/server";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "@/lib/alpaca/safety";
import { getAlpacaCredentials, PAPER_TRADING_BASE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Confirms the configured trading endpoint is paper-only. */
export async function GET() {
  try {
    const { baseUrl } = getAlpacaCredentials();
    assertPaperTradingOnly(baseUrl);
    return NextResponse.json({
      ok: true,
      paperOnly: true,
      tradingEndpoint: baseUrl,
      expected: PAPER_TRADING_BASE_URL,
      liveTradingAllowed: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Safety check failed";
    const status = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        paperOnly: true,
        liveTradingAllowed: false,
        error: message,
      },
      { status },
    );
  }
}
