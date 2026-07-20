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
  AlpacaPosition,
  AlpacaQuote,
  MarketClockStatus,
} from "@/lib/alpaca/types";
import { isPaperOrderExecutionEnabled } from "@/lib/config";
import { normalizeClock } from "@/lib/market/data-quality";
import { buildBracketOrderBody } from "@/lib/trading/brackets";

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

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Market-data GET with retry/backoff on 429 and transient 5xx.
 * Does not place orders.
 */
async function dataFetch<T>(path: string, attempt = 0): Promise<T> {
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
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 5) {
      const retryAfter = Number(res.headers.get("retry-after") || 0);
      const backoff = Math.max(retryAfter * 1000, 400 * 2 ** attempt);
      await sleep(backoff);
      return dataFetch<T>(path, attempt + 1);
    }
    throw new Error(
      `Alpaca data API ${res.status}: ${detail || res.statusText}`,
    );
  }

  return (await res.json()) as T;
}

export async function getAccount(): Promise<AlpacaAccount> {
  return tradingFetch<AlpacaAccount>("/v2/account");
}

export async function getPositions(): Promise<AlpacaPosition[]> {
  return tradingFetch<AlpacaPosition[]>("/v2/positions");
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

/** Find an order by Alpaca client_order_id among recent orders (paper only). */
export async function findOrderByClientOrderId(
  clientOrderId: string,
  limit = 100,
): Promise<AlpacaOrder | null> {
  const orders = await getOrders(limit);
  return (
    orders.find((o) => o.client_order_id === clientOrderId) ?? null
  );
}

/** Open / pending orders only. */
export async function getOpenOrders(limit = 50): Promise<AlpacaOrder[]> {
  const params = new URLSearchParams({
    status: "open",
    limit: String(limit),
    direction: "desc",
  });
  return tradingFetch<AlpacaOrder[]>(`/v2/orders?${params}`);
}

/** Cancel a single open order by id. Paper only. */
export async function cancelOrder(orderId: string): Promise<void> {
  await tradingFetch<void>(`/v2/orders/${encodeURIComponent(orderId)}`, {
    method: "DELETE",
  });
}

/** Cancel all open orders. Paper only. Does not close positions. */
export async function cancelAllOrders(): Promise<void> {
  await tradingFetch<void>("/v2/orders", { method: "DELETE" });
}

/**
 * Close all open positions (market). Paper only.
 * Separate from emergency stop — requires deliberate call.
 */
export async function closeAllPositions(): Promise<unknown> {
  return tradingFetch<unknown>("/v2/positions", {
    method: "DELETE",
    body: JSON.stringify({ cancel_orders: false }),
  });
}

/**
 * Close a single position by symbol. Paper only.
 */
export async function closePosition(symbol: string): Promise<unknown> {
  return tradingFetch<unknown>(
    `/v2/positions/${encodeURIComponent(symbol.toUpperCase())}`,
    { method: "DELETE" },
  );
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

export type BarAdjustment = "raw" | "split" | "dividend" | "all";

/**
 * Recent historical bars for trend / volatility / daily session questions.
 * Uses IEX feed (paper-friendly). Does not place orders.
 * Single page — prefer getHistoricalBarsPaged for multi-month ranges.
 */
export async function getRecentBars(
  symbols: string[],
  timeframe: BarTimeframe = "5Min",
  limit = 24,
  range?: { start?: string; end?: string },
  options?: { adjustment?: BarAdjustment; feed?: "iex" | "sip" },
): Promise<Record<string, AlpacaBar[]>> {
  if (symbols.length === 0) return {};

  const params = new URLSearchParams({
    symbols: symbols.join(","),
    timeframe,
    limit: String(limit),
    adjustment: options?.adjustment ?? "raw",
    feed: options?.feed ?? "iex",
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

/**
 * Paginated historical bars for one symbol (Alpaca next_page_token).
 * Deduplicates by timestamp. IEX by default. Never places orders.
 */
export async function getHistoricalBarsPaged(input: {
  symbol: string;
  timeframe: BarTimeframe;
  start: string;
  end: string;
  pageLimit?: number;
  maxPages?: number;
  adjustment?: BarAdjustment;
  feed?: "iex" | "sip";
  onPage?: (info: {
    page: number;
    barsThisPage: number;
    totalSoFar: number;
    pageToken: string | null;
  }) => void;
}): Promise<{ bars: AlpacaBar[]; pages: number; nextPageToken: string | null }> {
  const symbol = input.symbol.toUpperCase();
  const pageLimit = Math.min(input.pageLimit ?? 10000, 10000);
  const maxPages = input.maxPages ?? 200;
  const all: AlpacaBar[] = [];
  const seen = new Set<string>();
  let pageToken: string | null = null;
  let pages = 0;

  do {
    const params = new URLSearchParams({
      symbols: symbol,
      timeframe: input.timeframe,
      start: input.start,
      end: input.end,
      limit: String(pageLimit),
      adjustment: input.adjustment ?? "raw",
      feed: input.feed ?? "iex",
      sort: "asc",
    });
    if (pageToken) params.set("page_token", pageToken);

    const data = await dataFetch<{
      bars?: Record<string, AlpacaBar[]>;
      next_page_token?: string | null;
    }>(`/v2/stocks/bars?${params}`);

    const pageBars = data.bars?.[symbol] ?? [];
    let added = 0;
    for (const b of pageBars) {
      if (seen.has(b.t)) continue;
      seen.add(b.t);
      all.push(b);
      added += 1;
    }
    pages += 1;
    pageToken = data.next_page_token ?? null;
    input.onPage?.({
      page: pages,
      barsThisPage: added,
      totalSoFar: all.length,
      pageToken,
    });
    if (pages >= maxPages) break;
  } while (pageToken);

  return { bars: all, pages, nextPageToken: pageToken };
}

export type AlpacaAssetLookup = {
  symbol: string;
  name: string;
  status: string;
  tradable: boolean;
  class: string;
  exchange: string;
  shortable: boolean;
  fractionable: boolean;
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
      shortable?: boolean;
      fractionable?: boolean;
    }>(`/v2/assets/${encodeURIComponent(sym)}`);

    if (!asset?.symbol) return null;
    return {
      symbol: String(asset.symbol).toUpperCase(),
      name: String(asset.name ?? asset.symbol),
      status: String(asset.status ?? ""),
      tradable: Boolean(asset.tradable),
      class: String(asset.class ?? ""),
      exchange: String(asset.exchange ?? ""),
      shortable: Boolean(asset.shortable),
      fractionable: Boolean(asset.fractionable),
    };
  } catch {
    return null;
  }
}

export type PlaceOrderInput =
  | {
      symbol: string;
      qty: number;
      side: "buy" | "sell";
      type?: "market" | "limit";
      time_in_force?: "day" | "gtc";
      limit_price?: number;
      client_order_id?: string;
      notional?: never;
      order_class?: never;
      take_profit?: never;
      stop_loss?: never;
    }
  | {
      symbol: string;
      notional: number;
      side: "buy" | "sell";
      type?: "market" | "limit";
      time_in_force?: "day" | "gtc";
      limit_price?: number;
      client_order_id?: string;
      qty?: never;
      order_class?: never;
      take_profit?: never;
      stop_loss?: never;
    }
  | {
      symbol: string;
      qty: number;
      side: "buy" | "sell";
      type?: "market";
      time_in_force?: "day" | "gtc";
      order_class: "bracket";
      take_profit: { limit_price: number };
      stop_loss: { stop_price: number };
      client_order_id?: string;
      notional?: never;
      limit_price?: never;
    };

/** Build Alpaca order JSON — qty XOR notional, never both. Supports brackets. */
export function buildAlpacaOrderBody(input: PlaceOrderInput): JsonRecord {
  if ("order_class" in input && input.order_class === "bracket") {
    return buildBracketOrderBody({
      symbol: input.symbol,
      qty: input.qty,
      side: input.side,
      takeProfitLimitPrice: input.take_profit.limit_price,
      stopLossStopPrice: input.stop_loss.stop_price,
      time_in_force: input.time_in_force,
      client_order_id: input.client_order_id,
    }) as unknown as JsonRecord;
  }

  const hasQty = "qty" in input && input.qty != null;
  const hasNotional = "notional" in input && input.notional != null;
  if (hasQty && hasNotional) {
    throw new Error("Alpaca order cannot include both qty and notional");
  }

  const body: JsonRecord = {
    symbol: input.symbol.toUpperCase(),
    side: input.side,
    type: input.type ?? "market",
    time_in_force: input.time_in_force ?? "day",
  };
  if (input.client_order_id) {
    body.client_order_id = input.client_order_id.slice(0, 48);
  }

  if ("notional" in input && input.notional != null) {
    body.notional = String(input.notional);
  } else if ("qty" in input && input.qty != null) {
    body.qty = String(input.qty);
  }

  if ("limit_price" in input && input.limit_price != null) {
    body.limit_price = String(input.limit_price);
  }

  if (body.qty != null && body.notional != null) {
    throw new Error("Alpaca order cannot include both qty and notional");
  }
  if (body.qty == null && body.notional == null) {
    throw new Error("Alpaca order requires qty or notional");
  }

  return body;
}

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

  const body = buildAlpacaOrderBody(input);

  return tradingFetch<AlpacaOrder>("/v2/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
