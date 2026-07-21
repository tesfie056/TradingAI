/**
 * Broker market clock — Alpaca paper /v2/clock is the source of truth.
 * Local America/New_York math is only a consistency helper / test aid.
 */

import { getMarketClock } from "@/lib/alpaca/client";
import type { MarketClockStatus } from "@/lib/alpaca/types";
import { MARKET_TIMEZONE } from "@/lib/market/time";

export type MarketSessionStatus = "open" | "closed" | "unavailable";

export type BrokerClockSnapshot = {
  status: MarketSessionStatus;
  /** true/false when known; null when unavailable */
  isOpen: boolean | null;
  timestamp: string | null;
  nextOpen: string | null;
  nextClose: string | null;
  source: "alpaca" | "unavailable";
  fetchedAt: string;
  error: string | null;
};

const FRESH_MS = 30_000;

type CacheEntry = {
  snap: BrokerClockSnapshot;
  atMs: number;
};

type ClockFetcher = () => Promise<MarketClockStatus>;

const globalKey = "__tradingai_broker_clock_cache__";
const fetcherKey = "__tradingai_broker_clock_fetcher__";

function getCache(): CacheEntry | null {
  const g = globalThis as typeof globalThis & { [globalKey]?: CacheEntry };
  return g[globalKey] ?? null;
}

function setCache(entry: CacheEntry): void {
  const g = globalThis as typeof globalThis & { [globalKey]?: CacheEntry };
  g[globalKey] = entry;
}

function getTestFetcher(): ClockFetcher | null {
  const g = globalThis as typeof globalThis & {
    [fetcherKey]?: ClockFetcher | null;
  };
  return g[fetcherKey] ?? null;
}

/** Test-only: inject Alpaca clock responses without hitting the network. */
export function setBrokerClockFetcherForTests(
  fetcher: ClockFetcher | null,
): void {
  const g = globalThis as typeof globalThis & {
    [fetcherKey]?: ClockFetcher | null;
  };
  if (fetcher == null) delete g[fetcherKey];
  else g[fetcherKey] = fetcher;
}

export function resetBrokerClockCacheForTests(): void {
  const g = globalThis as typeof globalThis & { [globalKey]?: CacheEntry };
  delete g[globalKey];
}

function fromAlpaca(clock: MarketClockStatus): BrokerClockSnapshot {
  return {
    status: clock.isOpen ? "open" : "closed",
    isOpen: clock.isOpen,
    timestamp: clock.timestamp,
    nextOpen: clock.nextOpen,
    nextClose: clock.nextClose,
    source: "alpaca",
    fetchedAt: new Date().toISOString(),
    error: null,
  };
}

function unavailable(error: string): BrokerClockSnapshot {
  return {
    status: "unavailable",
    isOpen: null,
    timestamp: null,
    nextOpen: null,
    nextClose: null,
    source: "unavailable",
    fetchedAt: new Date().toISOString(),
    error,
  };
}

/**
 * Fresh Alpaca paper clock. Short TTL cache; force=true bypasses cache.
 * On failure: status=unavailable (never silently "closed").
 */
export async function getFreshBrokerClock(options?: {
  force?: boolean;
  nowMs?: number;
}): Promise<BrokerClockSnapshot> {
  const nowMs = options?.nowMs ?? Date.now();
  const cached = getCache();
  if (
    !options?.force &&
    cached &&
    nowMs - cached.atMs < FRESH_MS &&
    cached.snap.source === "alpaca"
  ) {
    return cached.snap;
  }

  try {
    const fetchClock = getTestFetcher() ?? getMarketClock;
    const clock = await fetchClock();
    const snap = fromAlpaca(clock);
    setCache({ snap, atMs: nowMs });
    return snap;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Broker clock request failed";
    const snap = unavailable(message);
    setCache({ snap, atMs: nowMs });
    return snap;
  }
}

/** Parts of an instant in America/New_York (for tests / consistency checks). */
export function easternWallTime(nowMs: number = Date.now()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: String(parts.weekday),
  };
}

/**
 * Local regular-session estimate (Mon–Fri 09:30–16:00 America/New_York).
 * Not used to override Alpaca. Holidays are not fully modeled here —
 * Alpaca clock remains authoritative in production.
 */
export function localRegularSessionOpen(nowMs: number = Date.now()): boolean {
  const et = easternWallTime(nowMs);
  if (["Sat", "Sun"].includes(et.weekday)) return false;
  const mins = et.hour * 60 + et.minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return mins >= open && mins < close;
}

export function marketStatusLabel(status: MarketSessionStatus): string {
  if (status === "open") return "Market open";
  if (status === "closed") return "Market closed";
  return "Market status unavailable";
}
