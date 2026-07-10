import { NextResponse } from "next/server";
import { generateWatchlistDecisions } from "@/lib/ai/decision";
import {
  appendDecisionHistory,
  pruneDecisionHistory,
} from "@/lib/ai/history";
import {
  getLatestQuotes,
  getMarketClock,
} from "@/lib/alpaca/client";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";
import { getWatchlist, isPaperOrderExecutionEnabled } from "@/lib/config";
import { analyzeWatchlistNews } from "@/lib/news/analyze";
import { fetchWatchlistNews } from "@/lib/news";
import {
  fetchMarketCondition,
  fetchMultiTimeframeBars,
} from "@/lib/stocks/fetch-context";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const symbols = getWatchlist();
    const [clock, quotes, multiBars, marketCondition, newsResult] =
      await Promise.all([
        getMarketClock(),
        getLatestQuotes(symbols),
        fetchMultiTimeframeBars(symbols),
        fetchMarketCondition(),
        fetchWatchlistNews(symbols),
      ]);

    const { bySymbol: newsBySymbol, aiStatus } = await analyzeWatchlistNews(
      symbols,
      [...newsResult.items],
    );

    const decisions = generateWatchlistDecisions({
      symbols,
      quotes,
      barsBySymbol: multiBars.bars5Min,
      bars1MinBySymbol: multiBars.bars1Min,
      bars5MinBySymbol: multiBars.bars5Min,
      bars15MinBySymbol: multiBars.bars15Min,
      timeframe: "5Min",
      isMarketOpen: clock.isOpen,
      newsBySymbol,
      marketCondition,
    });

    await appendDecisionHistory(decisions, {
      aiProvider: aiStatus.activeProvider,
    });
    await pruneDecisionHistory();

    return NextResponse.json({
      paperOnly: true,
      assetClass: "us_equity",
      watchlist: symbols,
      decisions,
      clock,
      marketCondition,
      news: {
        provider: newsResult.provider,
        bySymbol: newsBySymbol,
        status: newsResult.status,
        aiStatus,
      },
      orderExecutionEnabled: isPaperOrderExecutionEnabled(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate AI decisions";
    const status = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json(
      {
        error: message,
        paperOnly: true,
        orderExecutionEnabled: isPaperOrderExecutionEnabled(),
      },
      { status },
    );
  }
}
