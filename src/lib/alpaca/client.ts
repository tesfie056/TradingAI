import {
  getAlpacaCredentials,
  MARKET_DATA_BASE_URL,
} from "@/lib/config";
import {
  assertPaperTradingOnly,
  assertSafeTradingRequestUrl,
} from "@/lib/alpaca/safety";
import type {
  AlpacaAccount,
  AlpacaBar,
  AlpacaClock,
  AlpacaOrder,
  AlpacaQuote,
  MarketClockStatus,
} from "@/lib/alpaca/types";
import { isPaperOrderExecutionEnabled } from "@/lib/config";
import { normalizeClock } from "@/lib/market/data-quality";

type JsonRecord = Record<string, unknown>;

function authHeaders(apiKey: string, secretKey: string): HeadersInit {
  return {
    "APCA-API-KEY-ID": apiKey,
    "APCA-API-SECRET-KEY": secretKey,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function tradingFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const { apiKey, secretKey, baseUrl } = getAlpacaCredentials();
  assertPaperTradingOnly(baseUrl);

  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  assertSafeTradingRequestUrl(url);

  const res = await fetch(url, {
    ...init,
    headers: {
      ...authHeaders(apiKey, secretKey),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    // Do not log credentials; forward a truncated status message only.
    const body = await res.text();
    const detail = body.slice(0, 300).replace(/APCA-[A-Z-]+/gi, "[redacted]");
    throw new Error(
      `Alpaca paper API ${res.status}: ${detail || res.statusText}`,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

async function dataFetch<T>(path: string): Promise<T> {
  const { apiKey, secretKey } = getAlpacaCredentials();
  // Market data uses data.alpaca.markets (not a trading endpoint).
  const url = `${MARKET_DATA_BASE_URL.replace(/\/$/, "")}${path}`;

  const res = await fetch(url, {
    headers: authHeaders(apiKey, secretKey),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    const detail = body.slice(0, 300).replace(/APCA-[A-Z-]+/gi, "[redacted]");
    throw new Error(
      `Alpaca data API ${res.status}: ${detail || res.statusText}`,
    );
  }

  return (await res.json()) as T;
}

export async function getAccount(): Promise<AlpacaAccount> {
  return tradingFetch<AlpacaAccount>("/v2/account");
}

/** US equity market clock from Alpaca paper trading API. */
export async function getMarketClock(): Promise<MarketClockStatus> {
  const raw = await tradingFetch<AlpacaClock>("/v2/clock");
  return normalizeClock(raw);
}

export async function getOrders(limit = 50): Promise<AlpacaOrder[]> {
  const params = new URLSearchParams({
    status: "all",
    limit: String(limit),
    direction: "desc",
  });
  return tradingFetch<AlpacaOrder[]>(`/v2/orders?${params}`);
}

export async function getLatestQuotes(
  symbols: string[],
): Promise<AlpacaQuote[]> {
  if (symbols.length === 0) return [];

  const params = new URLSearchParams({
    symbols: symbols.join(","),
    feed: "iex",
  });

  const data = await dataFetch<{
    quotes?: Record<
      string,
      {
        bp?: number;
        ap?: number;
        bs?: number;
        as?: number;
        t?: string;
      }
    >;
  }>(`/v2/stocks/quotes/latest?${params}`);

  return symbols.map((symbol) => {
    const q = data.quotes?.[symbol];
    return {
      symbol,
      bid: q?.bp ?? null,
      ask: q?.ap ?? null,
      bidSize: q?.bs ?? null,
      askSize: q?.as ?? null,
      timestamp: q?.t ?? null,
    };
  });
}

export async function getLatestBars(
  symbols: string[],
): Promise<Record<string, { close: number; timestamp: string } | null>> {
  if (symbols.length === 0) return {};

  const params = new URLSearchParams({
    symbols: symbols.join(","),
    feed: "iex",
  });

  const data = await dataFetch<{
    bars?: Record<string, { c: number; t: string }>;
  }>(`/v2/stocks/bars/latest?${params}`);

  const result: Record<string, { close: number; timestamp: string } | null> =
    {};

  for (const symbol of symbols) {
    const bar = data.bars?.[symbol];
    result[symbol] = bar
      ? { close: bar.c, timestamp: bar.t }
      : null;
  }

  return result;
}

export type BarTimeframe = "1Min" | "5Min" | "15Min" | "1Day";

/**
 * Recent historical bars for trend / volatility / daily session questions.
 * Uses IEX feed (paper-friendly). Does not place orders.
 */
export async function getRecentBars(
  symbols: string[],
  timeframe: BarTimeframe = "5Min",
  limit = 24,
  range?: { start?: string; end?: string },
): Promise<Record<string, AlpacaBar[]>> {
  if (symbols.length === 0) return {};

  const params = new URLSearchParams({
    symbols: symbols.join(","),
    timeframe,
    limit: String(limit),
    adjustment: "raw",
    feed: "iex",
    sort: "asc",
  });
  if (range?.start) params.set("start", range.start);
  if (range?.end) params.set("end", range.end);

  const data = await dataFetch<{
    bars?: Record<string, AlpacaBar[]>;
  }>(`/v2/stocks/bars?${params}`);

  const result: Record<string, AlpacaBar[]> = {};
  for (const symbol of symbols) {
    result[symbol] = data.bars?.[symbol] ?? [];
  }
  return result;
}

export type AlpacaAssetLookup = {
  symbol: string;
  name: string;
  status: string;
  tradable: boolean;
  class: string;
  exchange: string;
};

/**
 * Look up a single symbol on the paper trading API.
 * Stocks only — rejects non us_equity / non-tradable assets.
 * Does not place orders and does not list the full universe.
 */
export async function lookupUsEquityAsset(
  symbol: string,
): Promise<AlpacaAssetLookup | null> {
  const sym = symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) return null;

  try {
    const asset = await tradingFetch<{
      symbol?: string;
      name?: string;
      status?: string;
      tradable?: boolean;
      class?: string;
      exchange?: string;
    }>(`/v2/assets/${encodeURIComponent(sym)}`);

    if (!asset?.symbol) return null;
    return {
      symbol: String(asset.symbol).toUpperCase(),
      name: String(asset.name ?? asset.symbol),
      status: String(asset.status ?? ""),
      tradable: Boolean(asset.tradable),
      class: String(asset.class ?? ""),
      exchange: String(asset.exchange ?? ""),
    };
  } catch {
    return null;
  }
}

export type PlaceOrderInput = {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  type?: "market" | "limit";
  time_in_force?: "day" | "gtc";
  limit_price?: number;
};

/**
 * Paper order placement — DISABLED by default.
 * Only called from the manual approval submit path after all gates pass.
 * Requires ENABLE_PAPER_ORDER_EXECUTION=true. Live trading remains blocked.
 */
export async function placePaperOrder(
  input: PlaceOrderInput,
): Promise<AlpacaOrder> {
  if (!isPaperOrderExecutionEnabled()) {
    throw new Error(
      "Paper order execution is disabled. Set ENABLE_PAPER_ORDER_EXECUTION=true only when intentionally enabling trades in a later phase.",
    );
  }

  const body: JsonRecord = {
    symbol: input.symbol.toUpperCase(),
    qty: String(input.qty),
    side: input.side,
    type: input.type ?? "market",
    time_in_force: input.time_in_force ?? "day",
  };

  if (input.limit_price != null) {
    body.limit_price = String(input.limit_price);
  }

  return tradingFetch<AlpacaOrder>("/v2/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
