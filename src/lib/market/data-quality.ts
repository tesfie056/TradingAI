import type {
  AlpacaBar,
  AlpacaQuote,
  DataQuality,
  MarketClockStatus,
} from "@/lib/alpaca/types";

/** Quote older than this (while market open) is stale. */
export const STALE_QUOTE_MS_WHEN_OPEN = 5 * 60 * 1000;

/** Bars older than this are not "recent". */
export const RECENT_BAR_MS = 30 * 60 * 1000;

/** Spread at or above this forces HOLD (1%). */
export const WIDE_SPREAD_HOLD_PCT = 0.01;

/** Spread above this adds a wide-spread warning (0.5%). */
export const WIDE_SPREAD_WARN_PCT = 0.005;

export function isQuoteStale(
  quoteTimestamp: string | null | undefined,
  isMarketOpen: boolean,
  nowMs: number = Date.now(),
): boolean {
  if (!quoteTimestamp) return true;
  const t = Date.parse(quoteTimestamp);
  if (Number.isNaN(t)) return true;

  const age = nowMs - t;
  if (age < 0) return false;

  // During RTH, quotes should be fresh.
  if (isMarketOpen) {
    return age > STALE_QUOTE_MS_WHEN_OPEN;
  }

  // When closed, any quote is effectively stale vs live session —
  // treat as stale for decision aggressiveness.
  return true;
}

export function hasRecentBars(
  bars: AlpacaBar[],
  nowMs: number = Date.now(),
): boolean {
  if (bars.length === 0) return false;
  const last = bars[bars.length - 1];
  const t = Date.parse(last.t);
  if (Number.isNaN(t)) return false;
  return nowMs - t <= RECENT_BAR_MS;
}

export function computeSpreadPercent(
  bid: number | null | undefined,
  ask: number | null | undefined,
): number | null {
  if (bid == null || ask == null) return null;
  if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
  const mid = (bid + ask) / 2;
  if (!(mid > 0)) return null;
  return (ask - bid) / mid;
}

/**
 * Build data-quality assessment for one symbol.
 * Pure function — safe to unit-test without network.
 */
export function assessDataQuality(input: {
  isMarketOpen: boolean;
  quote: AlpacaQuote | undefined;
  bars: AlpacaBar[];
  nowMs?: number;
}): DataQuality {
  const nowMs = input.nowMs ?? Date.now();
  const spreadPercent = computeSpreadPercent(
    input.quote?.bid,
    input.quote?.ask,
  );
  const quoteStale = isQuoteStale(
    input.quote?.timestamp,
    input.isMarketOpen,
    nowMs,
  );
  const recentBars = hasRecentBars(input.bars, nowMs);
  const warningMessages: string[] = [];

  if (!input.isMarketOpen) {
    warningMessages.push(
      "US equity market is closed — quotes may be after-hours or last regular session.",
    );
  }

  if (quoteStale) {
    if (input.isMarketOpen) {
      warningMessages.push(
        `Quote is stale (>${STALE_QUOTE_MS_WHEN_OPEN / 60_000}m old during open session).`,
      );
    } else {
      warningMessages.push(
        "Quote freshness not reliable while market is closed.",
      );
    }
  }

  if (!input.quote?.timestamp) {
    warningMessages.push("Missing quote timestamp.");
  }

  if (spreadPercent == null) {
    warningMessages.push("Incomplete bid/ask — cannot measure spread.");
  } else if (spreadPercent >= WIDE_SPREAD_HOLD_PCT) {
    warningMessages.push(
      `Spread unusually wide (${(spreadPercent * 100).toFixed(2)}%) — forcing HOLD.`,
    );
  } else if (spreadPercent >= WIDE_SPREAD_WARN_PCT) {
    warningMessages.push(
      `Spread elevated (${(spreadPercent * 100).toFixed(2)}%).`,
    );
  }

  if (!recentBars) {
    warningMessages.push("No recent bars available for trend confirmation.");
  }

  return {
    isMarketOpen: input.isMarketOpen,
    isQuoteStale: quoteStale,
    spreadPercent,
    hasRecentBars: recentBars,
    warningMessages,
  };
}

export function normalizeClock(raw: {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
}): MarketClockStatus {
  return {
    isOpen: Boolean(raw.is_open),
    timestamp: raw.timestamp,
    nextOpen: raw.next_open,
    nextClose: raw.next_close,
    paperOnly: true,
  };
}
