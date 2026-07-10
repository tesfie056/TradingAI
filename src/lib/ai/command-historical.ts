import { getRecentBars } from "@/lib/alpaca/client";
import type { AlpacaBar } from "@/lib/alpaca/types";
import { filterUsStockSymbols } from "@/lib/stocks/universe";
import type { HistoricalField } from "@/lib/ai/command-intent";

export type DailySessionSummary = {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function etDateKey(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function todayEtKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Pick the most recent completed U.S. session (prefer prior day over today). */
export function pickYesterdayBar(bars: AlpacaBar[]): AlpacaBar | null {
  if (!bars.length) return null;
  const today = todayEtKey();
  const sorted = [...bars].sort(
    (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime(),
  );
  const prior = [...sorted].reverse().find((b) => etDateKey(b.t) < today);
  if (prior) return prior;
  // Fallback: latest available daily bar (e.g. weekend / holiday edge cases).
  return sorted[sorted.length - 1] ?? null;
}

export function toSessionSummary(
  symbol: string,
  bar: AlpacaBar,
): DailySessionSummary {
  return {
    symbol: symbol.toUpperCase(),
    date: etDateKey(bar.t),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  };
}

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatYesterdaySessionAnswer(
  session: DailySessionSummary,
  field: HistoricalField,
): string {
  const vol =
    session.volume > 0
      ? ` Volume: ${session.volume.toLocaleString("en-US")}.`
      : "";

  if (field === "high") {
    return `${session.symbol} high on ${session.date} was ${money(session.high)}. (Open ${money(session.open)}, low ${money(session.low)}, close ${money(session.close)}.${vol})`;
  }
  if (field === "low") {
    return `${session.symbol} low on ${session.date} was ${money(session.low)}. (Open ${money(session.open)}, high ${money(session.high)}, close ${money(session.close)}.${vol})`;
  }
  if (field === "open") {
    return `${session.symbol} open on ${session.date} was ${money(session.open)}. (High ${money(session.high)}, low ${money(session.low)}, close ${money(session.close)}.${vol})`;
  }
  if (field === "close") {
    return `${session.symbol} close on ${session.date} was ${money(session.close)}. (Open ${money(session.open)}, high ${money(session.high)}, low ${money(session.low)}.${vol})`;
  }
  return `${session.symbol} on ${session.date}: open ${money(session.open)}, high ${money(session.high)}, low ${money(session.low)}, close ${money(session.close)}.${vol}`;
}

/**
 * Fetch recent daily bars (IEX) and return the prior U.S. session summary.
 * Stocks only. Never places orders.
 */
export async function fetchYesterdaySession(
  symbol: string,
): Promise<DailySessionSummary | null> {
  const stocks = filterUsStockSymbols([symbol.toUpperCase()]);
  if (stocks.length === 0) return null;

  // Alpaca daily bars are more reliable with an explicit start/end window.
  const end = new Date();
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000);
  const barsBySymbol = await getRecentBars(stocks, "1Day", 15, {
    start: start.toISOString(),
    end: end.toISOString(),
  });
  const bars = barsBySymbol[stocks[0]] ?? [];
  const bar = pickYesterdayBar(bars);
  if (!bar) return null;
  return toSessionSummary(stocks[0], bar);
}
