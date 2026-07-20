/**
 * Deterministic fixtures for Version 1 strategy unit tests.
 * Synthetic bars — no live Alpaca calls.
 *
 * Strong-setup bars are tuned so overall rangePct stays within 0.4%–4%
 * and 5Min trendPct stays within ~0.15%–3% (strategy momentum/vol bands).
 */

import type { AlpacaBar, AlpacaQuote, DataQuality } from "@/lib/alpaca/types";
import type { V1StrategyContext } from "@/lib/strategy/v1-simple-long/types";

function bar(
  i: number,
  close: number,
  volume = 100_000,
  opts?: { open?: number; high?: number; low?: number },
): AlpacaBar {
  const o = opts?.open ?? close * 0.9995;
  const h = opts?.high ?? close * 1.0015;
  const l = opts?.low ?? close * 0.9985;
  return {
    t: new Date(Date.UTC(2026, 6, 15, 14, 0, 0) + i * 60_000).toISOString(),
    o,
    h,
    l,
    c: close,
    v: volume,
  };
}

/**
 * Gentle rising closes for valid MA alignment without extreme range/momentum.
 * Default: ~2% total rise over `count` bars from `start`.
 */
export function makeUptrendBars(
  count: number,
  start = 20,
  step = 0.014,
  volume = 120_000,
): AlpacaBar[] {
  const bars: AlpacaBar[] = [];
  for (let i = 0; i < count; i++) {
    const c = start + i * step;
    bars.push(
      bar(i, c, volume + (i % 3) * 10_000, {
        open: c * 0.9995,
        high: c * 1.0015,
        low: c * 0.9985,
      }),
    );
  }
  // Boost last few volumes for confirmation
  for (let i = Math.max(0, count - 3); i < count; i++) {
    bars[i] = { ...bars[i], v: volume * 2.2 };
  }
  return bars;
}

/** Bars tuned for a strong BUY-capable setup (range + momentum inside bands). */
export function makeStrongSetupBars(): {
  bars5: AlpacaBar[];
  bars15: AlpacaBar[];
  price: number;
} {
  // ~2.0% rise over 30×5Min bars; tight intrabar → rangePct ≈ 2–3%
  const bars5 = makeUptrendBars(30, 20, 0.014, 150_000);
  const bars15 = makeUptrendBars(20, 20, 0.02, 200_000);
  return { bars5, bars15, price: bars5[bars5.length - 1].c };
}

export function makeFlatBars(count: number, price = 20): AlpacaBar[] {
  return Array.from({ length: count }, (_, i) => bar(i, price, 80_000));
}

export function makeDowntrendBars(count: number, start = 25): AlpacaBar[] {
  return Array.from({ length: count }, (_, i) =>
    bar(i, start - i * 0.08, 90_000),
  );
}

/** Ends with a sharp spike so momentum_not_overextended fails. */
export function makeSpikeBars(count: number): AlpacaBar[] {
  const bars = makeUptrendBars(count, 20, 0.01);
  const last = bars[bars.length - 1];
  bars[bars.length - 1] = {
    ...last,
    c: last.c * 1.05,
    h: last.c * 1.06,
    o: last.c,
  };
  return bars;
}

export function freshQuote(symbol: string, price: number): AlpacaQuote {
  return {
    symbol,
    bid: price - 0.01,
    ask: price + 0.01,
    bidSize: 100,
    askSize: 100,
    timestamp: new Date().toISOString(),
  };
}

export function staleQuote(symbol: string, price: number): AlpacaQuote {
  return {
    symbol,
    bid: price - 0.01,
    ask: price + 0.01,
    bidSize: 100,
    askSize: 100,
    timestamp: new Date(Date.now() - 20 * 60_000).toISOString(),
  };
}

export function wideQuote(symbol: string, price: number): AlpacaQuote {
  return {
    symbol,
    bid: price * 0.99,
    ask: price * 1.01,
    bidSize: 10,
    askSize: 10,
    timestamp: new Date().toISOString(),
  };
}

export function goodDq(spreadPercent = 0.001): DataQuality {
  return {
    isMarketOpen: true,
    isQuoteStale: false,
    spreadPercent,
    hasRecentBars: true,
    warningMessages: [],
  };
}

export function baseContext(
  overrides: Partial<V1StrategyContext> = {},
): V1StrategyContext {
  return {
    isMarketOpen: true,
    minutesSinceOpen: 60,
    minutesToClose: 120,
    hasOpenPosition: false,
    hasPendingEntry: false,
    hasPendingExit: false,
    reconciliationComplete: true,
    universeEligible: true,
    openEntryDelayMinutes: 0,
    eodEntryCutoffMinutes: 30,
    minPrice: 5,
    maxPrice: 50,
    maxSpreadPercent: 0.5,
    stopLossPct: 1.5,
    takeProfitPct: 3,
    nowMs: Date.now(),
    ...overrides,
  };
}
