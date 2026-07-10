import { NextResponse } from "next/server";
import { getWatchlist, parseWatchlist } from "@/lib/config";
import { runSimpleBacktest } from "@/lib/performance/backtest";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";
import { filterUsStockSymbols } from "@/lib/stocks/universe";

export const dynamic = "force-dynamic";

function parseSymbols(raw: string | null): string[] {
  if (!raw || !raw.trim()) return getWatchlist();
  return filterUsStockSymbols(parseWatchlist(raw));
}

/**
 * Historical decision simulation only — never places orders.
 * GET ?symbol=AAPL&start=YYYY-MM-DD&end=YYYY-MM-DD&lookbackBars=120
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolParam = searchParams.get("symbol");
    const symbols = symbolParam
      ? filterUsStockSymbols([symbolParam.trim().toUpperCase()])
      : parseSymbols(searchParams.get("symbols"));

    if (symbols.length === 0) {
      return NextResponse.json(
        {
          error: "No valid U.S. stock symbols provided.",
          paperOnly: true,
          orderExecutionEnabled: false,
          liveTradingAllowed: false,
        },
        { status: 400 },
      );
    }

    const startDate = searchParams.get("start");
    const endDate = searchParams.get("end");
    const lookbackRaw = searchParams.get("lookbackBars");
    const lookbackBars =
      lookbackRaw != null && lookbackRaw.trim() !== ""
        ? Math.min(500, Math.max(40, Number(lookbackRaw) || 120))
        : startDate || endDate
          ? 200
          : 80;

    const result = await runSimpleBacktest({
      symbols,
      lookbackBars,
      step: 6,
      forwardBars: 6,
      startDate,
      endDate,
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
