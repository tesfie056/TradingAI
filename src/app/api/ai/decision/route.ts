import { NextResponse } from "next/server";
import { generateWatchlistDecisions } from "@/lib/ai/decision";
import {
  appendDecisionHistory,
  pruneDecisionHistory,
} from "@/lib/ai/history";
import {
  getLatestQuotes,
  getMarketClock,
  getRecentBars,
} from "@/lib/alpaca/client";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";
import { getWatchlist } from "@/lib/config";
import { analyzeWatchlistNews } from "@/lib/news/analyze";
import { fetchWatchlistNews } from "@/lib/news";

export const dynamic = "force-dynamic";

const BAR_TIMEFRAME = "5Min" as const;

export async function GET() {
  try {
    const symbols = getWatchlist();
    const [clock, quotes, recentBars, newsResult] = await Promise.all([
      getMarketClock(),
      getLatestQuotes(symbols),
      getRecentBars(symbols, BAR_TIMEFRAME, 24),
      fetchWatchlistNews(symbols),
    ]);

    const { bySymbol: newsBySymbol, aiStatus } = await analyzeWatchlistNews(
      symbols,
      [...newsResult.items],
    );

    const decisions = generateWatchlistDecisions({
      symbols,
      quotes,
      barsBySymbol: recentBars,
      timeframe: BAR_TIMEFRAME,
      isMarketOpen: clock.isOpen,
      newsBySymbol,
    });

    await appendDecisionHistory(decisions, {
      aiProvider: aiStatus.activeProvider,
    });
    await pruneDecisionHistory();

    return NextResponse.json({
      paperOnly: true,
      watchlist: symbols,
      decisions,
      clock,
      news: {
        provider: newsResult.provider,
        bySymbol: newsBySymbol,
        status: newsResult.status,
        aiStatus,
      },
      orderExecutionEnabled: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate AI decisions";
    const status = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json({ error: message, paperOnly: true }, { status });
  }
}
