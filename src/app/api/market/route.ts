import { NextResponse } from "next/server";
import {
  getLatestBars,
  getLatestQuotes,
  getMarketClock,
  getRecentBars,
} from "@/lib/alpaca/client";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";
import { getWatchlist } from "@/lib/config";
import { assessDataQuality } from "@/lib/market/data-quality";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const symbols = getWatchlist();
    const [clock, quotes, bars, recentBars] = await Promise.all([
      getMarketClock(),
      getLatestQuotes(symbols),
      getLatestBars(symbols),
      getRecentBars(symbols, "5Min", 24),
    ]);

    const market = symbols.map((symbol) => {
      const quote = quotes.find((q) => q.symbol === symbol);
      const bar = bars[symbol];
      const symbolBars = recentBars[symbol] ?? [];
      const mid =
        quote?.bid != null && quote?.ask != null
          ? (quote.bid + quote.ask) / 2
          : (quote?.bid ?? quote?.ask ?? bar?.close ?? null);
      const dataQuality = assessDataQuality({
        isMarketOpen: clock.isOpen,
        quote,
        bars: symbolBars,
      });

      return {
        symbol,
        bid: quote?.bid ?? null,
        ask: quote?.ask ?? null,
        mid,
        last: bar?.close ?? null,
        timestamp: quote?.timestamp ?? bar?.timestamp ?? null,
        dataQuality,
      };
    });

    return NextResponse.json({
      paperOnly: true,
      watchlist: symbols,
      clock,
      market,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load market data";
    const status = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json({ error: message, paperOnly: true }, { status });
  }
}
