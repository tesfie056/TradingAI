import { NextResponse } from "next/server";
import { analyzeWatchlistNews } from "@/lib/news/analyze";
import { fetchWatchlistNews } from "@/lib/news";
import { getWatchlist } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const symbols = getWatchlist();
    const { provider, items, status } = await fetchWatchlistNews(symbols);
    const { bySymbol, aiStatus } = await analyzeWatchlistNews(symbols, [
      ...items,
    ]);

    return NextResponse.json({
      paperOnly: true,
      provider,
      watchlist: symbols,
      bySymbol,
      status,
      aiStatus,
      orderExecutionEnabled: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load news";
    return NextResponse.json(
      {
        error: message,
        paperOnly: true,
        provider: "mock",
        watchlist: [],
        bySymbol: {},
        status: {
          requestedProvider: "mock",
          activeProvider: "mock",
          usedFallback: true,
          fallbackReason: message,
          ok: false,
        },
        aiStatus: {
          requestedProvider: "heuristic",
          activeProvider: "heuristic",
          usedFallback: true,
          fallbackReason: message,
          model: null,
          ok: false,
        },
        orderExecutionEnabled: false,
      },
      { status: 500 },
    );
  }
}
