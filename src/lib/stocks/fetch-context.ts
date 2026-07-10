import { getRecentBars } from "@/lib/alpaca/client";
import type { AlpacaBar } from "@/lib/alpaca/types";
import { assessMarketCondition } from "@/lib/stocks/market-condition";
import { MARKET_BENCHMARK_SYMBOLS } from "@/lib/stocks/universe";

export type MultiTimeframeBars = {
  bars1Min: Record<string, AlpacaBar[]>;
  bars5Min: Record<string, AlpacaBar[]>;
  bars15Min: Record<string, AlpacaBar[]>;
};

/**
 * Fetch 1m / 5m / 15m bars for U.S. stock symbols (IEX). No orders.
 */
export async function fetchMultiTimeframeBars(
  symbols: string[],
): Promise<MultiTimeframeBars> {
  if (symbols.length === 0) {
    return { bars1Min: {}, bars5Min: {}, bars15Min: {} };
  }
  const [bars1Min, bars5Min, bars15Min] = await Promise.all([
    getRecentBars(symbols, "1Min", 30),
    getRecentBars(symbols, "5Min", 36),
    getRecentBars(symbols, "15Min", 24),
  ]);
  return { bars1Min, bars5Min, bars15Min };
}

/**
 * SPY + QQQ market condition for U.S. equities.
 */
export async function fetchMarketCondition() {
  const benchmarks = [...MARKET_BENCHMARK_SYMBOLS];
  const [bars5, bars15] = await Promise.all([
    getRecentBars(benchmarks, "5Min", 36),
    getRecentBars(benchmarks, "15Min", 24),
  ]);
  return assessMarketCondition({
    spyBars5Min: bars5.SPY ?? [],
    qqqBars5Min: bars5.QQQ ?? [],
    spyBars15Min: bars15.SPY ?? [],
    qqqBars15Min: bars15.QQQ ?? [],
  });
}
